import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  createMessageConnection,
  DiagnosticSeverity,
  ErrorCodes,
  StreamMessageReader,
  StreamMessageWriter,
  TextDocumentSyncKind,
} from "vscode-languageserver/node";

const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);
const serverPath = fileURLToPath(
  new URL(`../${packageJson.bin["sed-language-server"]}`, import.meta.url),
);
const requestTimeoutMilliseconds = 5_000;

function timeoutError(operation, stderr) {
  const details = stderr === "" ? "" : `\nServer stderr:\n${stderr}`;
  return new Error(`Timed out while waiting for ${operation}.${details}`);
}

class LspClient {
  constructor() {
    this.process = spawn(process.execPath, [serverPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.stderr = "";
    this.notificationWaiters = [];
    this.queuedNotifications = [];
    this.process.stderr.setEncoding("utf8");
    this.process.stderr.on("data", (chunk) => {
      this.stderr += chunk;
    });
    this.exit = new Promise((resolve) => {
      this.process.once("error", (error) => {
        resolve({ code: null, signal: null, error });
      });
      this.process.once("exit", (code, signal) => {
        resolve({ code, signal, error: undefined });
      });
    });

    this.connection = createMessageConnection(
      new StreamMessageReader(this.process.stdout),
      new StreamMessageWriter(this.process.stdin),
    );
    this.connection.onNotification((method, params) => {
      const waiterIndex = this.notificationWaiters.findIndex(
        (waiter) => waiter.method === method && waiter.predicate(params),
      );
      if (waiterIndex === -1) {
        this.queuedNotifications.push({ method, params });
        return;
      }

      const [waiter] = this.notificationWaiters.splice(waiterIndex, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(params);
    });
    this.connection.listen();
  }

  request(method, params) {
    return this.withTimeout(
      this.connection.sendRequest(method, params),
      `response to ${method}`,
    );
  }

  notify(method, params) {
    return this.withTimeout(
      this.connection.sendNotification(method, params),
      `delivery of ${method}`,
    );
  }

  waitForNotification(method, predicate = () => true) {
    const queuedIndex = this.queuedNotifications.findIndex(
      (message) => message.method === method && predicate(message.params),
    );
    if (queuedIndex !== -1) {
      const [message] = this.queuedNotifications.splice(queuedIndex, 1);
      return Promise.resolve(message.params);
    }

    return new Promise((resolve, reject) => {
      const waiter = {
        method,
        predicate,
        resolve,
        timer: undefined,
      };
      waiter.timer = setTimeout(() => {
        const index = this.notificationWaiters.indexOf(waiter);
        if (index !== -1) {
          this.notificationWaiters.splice(index, 1);
        }
        reject(timeoutError(`${method} notification`, this.stderr));
      }, requestTimeoutMilliseconds);
      this.notificationWaiters.push(waiter);
    });
  }

  waitForExit() {
    return this.withTimeout(this.exit, "language server to exit").then(
      ({ code, signal, error }) => {
        if (error !== undefined) {
          throw error;
        }
        return { code, signal };
      },
    );
  }

  withTimeout(promise, operation) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(timeoutError(operation, this.stderr));
      }, requestTimeoutMilliseconds);
      promise.then(
        (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }

  async dispose() {
    this.connection.dispose();
    for (const waiter of this.notificationWaiters) {
      clearTimeout(waiter.timer);
    }
    this.notificationWaiters = [];

    if (this.process.exitCode !== null || this.process.signalCode !== null) {
      return;
    }

    this.process.kill();
    try {
      await this.waitForExit();
    } catch {
      if (this.process.exitCode === null && this.process.signalCode === null) {
        this.process.kill("SIGKILL");
      }
    }
  }
}

async function initialize(client, initializationOptions) {
  const result = await client.request("initialize", {
    processId: process.pid,
    rootUri: null,
    capabilities: {},
    initializationOptions,
  });
  await client.notify("initialized", {});
  return result;
}

async function shutdown(client) {
  assert.equal(await client.request("shutdown"), null);
  await client.notify("exit");
  assert.deepEqual(await client.waitForExit(), {
    code: 0,
    signal: null,
  });
}

test("serves diagnostics, definitions, and formatting through the LSP document lifecycle", async (t) => {
  const client = new LspClient();
  t.after(() => client.dispose());

  const initializeResult = await initialize(client);
  assert.deepEqual(initializeResult.capabilities, {
    textDocumentSync: TextDocumentSyncKind.Incremental,
    definitionProvider: true,
    documentFormattingProvider: true,
  });

  const uri = "file:///integration.sed";
  await client.notify("textDocument/didOpen", {
    textDocument: {
      uri,
      languageId: "sed",
      version: 1,
      text: ":loop\nb loop\n{p;d;}\nz\n",
    },
  });

  const openedDiagnostics = await client.waitForNotification(
    "textDocument/publishDiagnostics",
    ({ uri: diagnosticUri, version }) => diagnosticUri === uri && version === 1,
  );
  assert.deepEqual(openedDiagnostics.diagnostics, [
    {
      severity: DiagnosticSeverity.Error,
      range: {
        start: { line: 3, character: 0 },
        end: { line: 3, character: 1 },
      },
      message: "Unknown sed command: `z`.",
      code: "invalid-command",
      source: "sed-language-server",
    },
  ]);

  assert.deepEqual(
    await client.request("textDocument/definition", {
      textDocument: { uri },
      position: { line: 1, character: 4 },
    }),
    [
      {
        uri,
        range: {
          start: { line: 0, character: 1 },
          end: { line: 0, character: 5 },
        },
      },
    ],
  );

  await client.notify("textDocument/didChange", {
    textDocument: { uri, version: 2 },
    contentChanges: [
      {
        range: {
          start: { line: 3, character: 0 },
          end: { line: 3, character: 1 },
        },
        text: "p",
      },
    ],
  });

  const changedDiagnostics = await client.waitForNotification(
    "textDocument/publishDiagnostics",
    ({ uri: diagnosticUri, version }) => diagnosticUri === uri && version === 2,
  );
  assert.deepEqual(changedDiagnostics.diagnostics, []);

  assert.deepEqual(
    await client.request("textDocument/formatting", {
      textDocument: { uri },
      options: {
        tabSize: 2,
        insertSpaces: true,
      },
    }),
    [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 4, character: 0 },
        },
        newText: ":loop\nb loop\n{\n  p\n  d\n}\np\n",
      },
    ],
  );

  await client.notify("textDocument/didClose", {
    textDocument: { uri },
  });
  assert.deepEqual(
    await client.waitForNotification(
      "textDocument/publishDiagnostics",
      ({ uri: diagnosticUri, diagnostics }) =>
        diagnosticUri === uri && diagnostics.length === 0,
    ),
    {
      uri,
      diagnostics: [],
    },
  );

  await shutdown(client);
});

test("rejects invalid initialization options", async (t) => {
  const client = new LspClient();
  t.after(() => client.dispose());

  await assert.rejects(
    client.request("initialize", {
      processId: process.pid,
      rootUri: null,
      capabilities: {},
      initializationOptions: {
        dialect: "bsd",
      },
    }),
    (error) => {
      assert.equal(error.code, ErrorCodes.InvalidParams);
      assert.match(error.message, /dialect/);
      return true;
    },
  );
});

test("keeps the dialect fixed after initialization", async (t) => {
  const client = new LspClient();
  t.after(() => client.dispose());

  await initialize(client, { dialect: "gnu" });
  await client.notify("workspace/didChangeConfiguration", {
    settings: {
      sedLanguageServer: {
        dialect: "posix",
      },
    },
  });

  const uri = "file:///fixed-dialect.sed";
  await client.notify("textDocument/didOpen", {
    textDocument: {
      uri,
      languageId: "sed",
      version: 1,
      text: "z\n",
    },
  });
  const diagnostics = await client.waitForNotification(
    "textDocument/publishDiagnostics",
    ({ uri: diagnosticUri }) => diagnosticUri === uri,
  );
  assert.deepEqual(diagnostics.diagnostics, []);

  await shutdown(client);
});

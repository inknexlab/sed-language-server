import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-languageserver/node";

function startServer() {
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: new URL("..", import.meta.url),
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const connection = createMessageConnection(
    new StreamMessageReader(child.stdout),
    new StreamMessageWriter(child.stdin),
  );
  connection.listen();
  return { child, connection, stderr: () => stderr };
}

function notification(connection, method, predicate) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      disposable.dispose();
      reject(new Error(`Timed out waiting for ${method}.`));
    }, 10_000);
    const disposable = connection.onNotification(method, (params) => {
      if (!predicate(params)) {
        return;
      }
      clearTimeout(timeout);
      disposable.dispose();
      resolve(params);
    });
  });
}

async function initialize(connection, initializationOptions) {
  const result = await connection.sendRequest("initialize", {
    processId: null,
    rootUri: null,
    capabilities: {
      general: { positionEncodings: ["utf-16"] },
    },
    initializationOptions,
  });
  connection.sendNotification("initialized", {});
  return result;
}

async function stopServer(server) {
  const exited =
    server.child.exitCode === null
      ? new Promise((resolve) => server.child.once("exit", resolve))
      : Promise.resolve();
  if (server.child.exitCode === null) {
    try {
      await server.connection.sendRequest("shutdown");
      server.connection.sendNotification("exit");
    } catch {
      server.child.kill();
    }
  }
  let timeout;
  await Promise.race([
    exited,
    new Promise((resolve) => {
      timeout = setTimeout(() => {
        server.child.kill();
        resolve();
      }, 10_000);
    }),
  ]);
  clearTimeout(timeout);
  server.connection.dispose();
}

test("serves the complete document lifecycle over default stdio", async (t) => {
  const server = startServer();
  t.after(async () => stopServer(server));
  const initialized = await initialize(server.connection, {});
  assert.equal(initialized.capabilities.positionEncoding, "utf-16");
  assert.deepEqual(initialized.capabilities.textDocumentSync, {
    openClose: true,
    change: 2,
  });
  assert.deepEqual(initialized.capabilities.renameProvider, {
    prepareProvider: true,
  });
  assert.equal(initialized.capabilities.hoverProvider, true);

  assert.equal(
    await server.connection.sendRequest("textDocument/hover", {
      textDocument: { uri: "file:///unopened.sed" },
      position: { line: 0, character: 0 },
    }),
    null,
  );

  const defaultModeUri = "file:///default-mode.sed";
  const defaultModeDiagnostics = notification(
    server.connection,
    "textDocument/publishDiagnostics",
    ({ uri: received }) => received === defaultModeUri,
  );
  server.connection.sendNotification("textDocument/didOpen", {
    textDocument: {
      uri: defaultModeUri,
      languageId: "sed",
      version: 1,
      text: "/a\\?/p\n",
    },
  });
  assert.deepEqual(
    (await defaultModeDiagnostics).diagnostics.map(({ code }) => code),
    ["bre-question-mark-escape"],
  );
  server.connection.sendNotification("textDocument/didClose", {
    textDocument: { uri: defaultModeUri },
  });

  const uri = "file:///integration.sed";
  const source = "s//x/\n:target\nb target\np;p";
  const opened = notification(
    server.connection,
    "textDocument/publishDiagnostics",
    ({ uri: received, version }) => received === uri && version === 1,
  );
  server.connection.sendNotification("textDocument/didOpen", {
    textDocument: {
      uri,
      languageId: "sed",
      version: 1,
      text: source,
    },
  });
  const openDiagnostics = await opened;
  assert.deepEqual(
    openDiagnostics.diagnostics.map(({ code }) => code),
    ["empty-regular-expression-without-previous"],
  );

  assert.deepEqual(
    await server.connection.sendRequest("textDocument/hover", {
      textDocument: { uri },
      position: { line: 3, character: 0 },
    }),
    {
      contents: {
        kind: "markdown",
        value:
          "### `p` — Print\n\n```sed\n[address[,address]]p\n```\n\nWrites the pattern space to standard output.",
      },
      range: {
        start: { line: 3, character: 0 },
        end: { line: 3, character: 1 },
      },
    },
  );

  assert.deepEqual(
    await server.connection.sendRequest("textDocument/definition", {
      textDocument: { uri },
      position: { line: 2, character: 4 },
    }),
    [
      {
        uri,
        range: {
          start: { line: 1, character: 1 },
          end: { line: 1, character: 7 },
        },
      },
    ],
  );
  assert.deepEqual(
    (
      await server.connection.sendRequest("textDocument/references", {
        textDocument: { uri },
        position: { line: 1, character: 7 },
        context: { includeDeclaration: true },
      })
    ).map(({ range }) => range.start),
    [
      { line: 1, character: 1 },
      { line: 2, character: 2 },
    ],
  );
  assert.deepEqual(
    await server.connection.sendRequest("textDocument/prepareRename", {
      textDocument: { uri },
      position: { line: 2, character: 8 },
    }),
    {
      range: {
        start: { line: 2, character: 2 },
        end: { line: 2, character: 8 },
      },
      placeholder: "target",
    },
  );
  const renamed = await server.connection.sendRequest("textDocument/rename", {
    textDocument: { uri },
    position: { line: 2, character: 3 },
    newName: "next",
  });
  assert.deepEqual(
    renamed.changes[uri].map(({ newText, range }) => [newText, range.start]),
    [
      ["next", { line: 1, character: 1 }],
      ["next", { line: 2, character: 2 }],
    ],
  );

  const formatted = await server.connection.sendRequest(
    "textDocument/formatting",
    {
      textDocument: { uri },
      options: { tabSize: 2, insertSpaces: true },
    },
  );
  assert.equal(formatted[0].newText, "s//x/\n:target\nb target\np\np\n");

  const changed = notification(
    server.connection,
    "textDocument/publishDiagnostics",
    ({ uri: received, version }) => received === uri && version === 2,
  );
  server.connection.sendNotification("textDocument/didChange", {
    textDocument: { uri, version: 2 },
    contentChanges: [
      {
        range: {
          start: { line: 0, character: 2 },
          end: { line: 0, character: 2 },
        },
        text: "a",
      },
    ],
  });
  assert.deepEqual((await changed).diagnostics, []);

  const closed = notification(
    server.connection,
    "textDocument/publishDiagnostics",
    ({ uri: received, diagnostics: values }) =>
      received === uri && values.length === 0,
  );
  server.connection.sendNotification("textDocument/didClose", {
    textDocument: { uri },
  });
  assert.equal((await closed).version, 2);
  assert.equal(server.stderr(), "");
});

test("uses the fixed ERE grammar selected during initialization", async (t) => {
  const server = startServer();
  t.after(async () => stopServer(server));
  await initialize(server.connection, { regex: "ere" });
  const uri = "file:///ere.sed";
  const published = notification(
    server.connection,
    "textDocument/publishDiagnostics",
    ({ uri: received }) => received === uri,
  );
  server.connection.sendNotification("textDocument/didOpen", {
    textDocument: {
      uri,
      languageId: "sed",
      version: 1,
      text: "s/(a)/\\1/\n",
    },
  });
  assert.deepEqual((await published).diagnostics, []);
  assert.equal(server.stderr(), "");
});

test("rejects unknown initialization options", async (t) => {
  const server = startServer();
  t.after(async () => stopServer(server));
  await assert.rejects(
    server.connection.sendRequest("initialize", {
      processId: null,
      rootUri: null,
      capabilities: {},
      initializationOptions: { dialect: "other" },
    }),
    (error) =>
      error.code === -32602 &&
      /only supported initialization option/.test(error.message),
  );
});

test("rejects a non-string regular expression mode", async (t) => {
  const server = startServer();
  t.after(async () => stopServer(server));
  await assert.rejects(
    server.connection.sendRequest("initialize", {
      processId: null,
      rootUri: null,
      capabilities: {},
      initializationOptions: { regex: null },
    }),
    (error) =>
      error.code === -32602 &&
      /initializationOptions\.regex must be/.test(error.message),
  );
});

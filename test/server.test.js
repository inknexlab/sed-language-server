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

async function initialize(
  connection,
  initializationOptions,
  textDocumentCapabilities = {},
) {
  const result = await connection.sendRequest("initialize", {
    processId: null,
    rootUri: null,
    capabilities: {
      general: { positionEncodings: ["utf-16"] },
      textDocument: textDocumentCapabilities,
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

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

test("serves the complete document lifecycle over default stdio", async (t) => {
  const server = startServer();
  t.after(async () => stopServer(server));
  const initialized = await initialize(
    server.connection,
    {},
    {
      hover: { contentFormat: ["markdown", "plaintext"] },
    },
  );
  assert.deepEqual(initialized.capabilities, {
    positionEncoding: "utf-16",
    textDocumentSync: {
      openClose: true,
      change: 2,
    },
    definitionProvider: true,
    referencesProvider: true,
    hoverProvider: true,
    documentFormattingProvider: true,
  });

  assert.deepEqual(
    await server.connection.sendRequest("textDocument/definition", {
      textDocument: { uri: "file:///unopened.sed" },
      position: { line: 0, character: 0 },
    }),
    [],
  );

  assert.deepEqual(
    await server.connection.sendRequest("textDocument/references", {
      textDocument: { uri: "file:///unopened.sed" },
      position: { line: 0, character: 0 },
      context: { includeDeclaration: false },
    }),
    [],
  );

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

  const recoveryUri = "file:///recovery.sed";
  const recoveryDiagnostics = notification(
    server.connection,
    "textDocument/publishDiagnostics",
    ({ uri: received }) => received === recoveryUri,
  );
  server.connection.sendNotification("textDocument/didOpen", {
    textDocument: {
      uri: recoveryUri,
      languageId: "sed",
      version: 1,
      text: " }",
    },
  });
  assert.deepEqual(
    (await recoveryDiagnostics).diagnostics.map(({ code }) => code),
    ["unmatched-closing-brace"],
  );
  server.connection.sendNotification("textDocument/didClose", {
    textDocument: { uri: recoveryUri },
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

test("debounces changed diagnostics and cancels closed documents", async (t) => {
  const server = startServer();
  t.after(async () => stopServer(server));
  await initialize(server.connection, {});

  const uri = "file:///diagnostic-scheduling.sed";
  const observed = [];
  const waiters = new Map();
  const disposable = server.connection.onNotification(
    "textDocument/publishDiagnostics",
    (params) => {
      if (params.uri === uri) {
        observed.push(params);
        const waiter = waiters.get(params.version);
        if (waiter !== undefined) {
          waiters.delete(params.version);
          clearTimeout(waiter.timeout);
          waiter.resolve(params);
        }
      }
    },
  );
  t.after(() => {
    disposable.dispose();
    for (const { timeout } of waiters.values()) {
      clearTimeout(timeout);
    }
    waiters.clear();
  });
  const diagnosticsForVersion = (version) =>
    new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        waiters.delete(version);
        reject(
          new Error(`Timed out waiting for diagnostics version ${version}.`),
        );
      }, 10_000);
      waiters.set(version, { resolve, timeout });
    });

  const opened = diagnosticsForVersion(1);
  server.connection.sendNotification("textDocument/didOpen", {
    textDocument: {
      uri,
      languageId: "sed",
      version: 1,
      text: "p\n",
    },
  });
  await opened;

  const latest = diagnosticsForVersion(3);
  for (const [version, text] of [
    [2, "/a\\?/p\n"],
    [3, "p\n"],
  ]) {
    server.connection.sendNotification("textDocument/didChange", {
      textDocument: { uri, version },
      contentChanges: [{ text }],
    });
  }
  assert.deepEqual((await latest).diagnostics, []);
  await wait(100);
  assert.deepEqual(
    observed.map(({ version }) => version),
    [1, 3],
  );

  const closed = diagnosticsForVersion(4);
  server.connection.sendNotification("textDocument/didChange", {
    textDocument: { uri, version: 4 },
    contentChanges: [{ text: "/a\\?/p\n" }],
  });
  server.connection.sendNotification("textDocument/didClose", {
    textDocument: { uri },
  });
  assert.deepEqual((await closed).diagnostics, []);
  await wait(100);
  assert.deepEqual(
    observed.map(({ version }) => version),
    [1, 3, 4],
  );
  assert.equal(server.stderr(), "");
});

test("uses the client's preferred markup for hover", async (t) => {
  const server = startServer();
  t.after(async () => stopServer(server));
  await initialize(
    server.connection,
    {},
    {
      hover: { contentFormat: ["plaintext", "markdown"] },
    },
  );

  const uri = "file:///plaintext.sed";
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
      text: "D;",
    },
  });
  assert.deepEqual((await published).diagnostics, []);

  assert.deepEqual(
    await server.connection.sendRequest("textDocument/hover", {
      textDocument: { uri },
      position: { line: 0, character: 0 },
    }),
    {
      contents: {
        kind: "plaintext",
        value:
          "D — Delete First Line\n\n[address[,address]]D\n\nDeletes through the first newline and restarts the cycle without reading input, or acts like d when no newline exists.",
      },
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
    },
  );

  assert.equal(server.stderr(), "");
});

test("uses legacy strings when markup formats are not advertised", async (t) => {
  const cases = [
    { name: "unspecified", capabilities: {} },
    {
      name: "empty",
      capabilities: {
        hover: { contentFormat: [] },
      },
    },
    {
      name: "unsupported-only",
      capabilities: {
        hover: { contentFormat: ["html"] },
      },
    },
  ];

  for (const { name, capabilities } of cases) {
    await t.test(name, async (t) => {
      const server = startServer();
      t.after(async () => stopServer(server));
      await initialize(server.connection, {}, capabilities);

      const uri = `file:///legacy-markup-${name}.sed`;
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
          text: "D;",
        },
      });
      assert.deepEqual((await published).diagnostics, []);

      assert.deepEqual(
        await server.connection.sendRequest("textDocument/hover", {
          textDocument: { uri },
          position: { line: 0, character: 0 },
        }),
        {
          contents:
            "### `D` — Delete First Line\n\n```sed\n[address[,address]]D\n```\n\nDeletes through the first newline and restarts the cycle without reading input, or acts like d when no newline exists.",
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 },
          },
        },
      );

      assert.equal(server.stderr(), "");
    });
  }
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

test("uses BRE defaults for omitted and null initialization options", async (t) => {
  for (const [name, options] of [
    ["omitted", undefined],
    ["null", null],
  ]) {
    await t.test(name, async () => {
      const server = startServer();
      try {
        const initialized = await initialize(server.connection, options);
        assert.equal(initialized.capabilities.positionEncoding, "utf-16");
        const uri = `file:///default-${name}.sed`;
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
            text: "/a\\?/p\n",
          },
        });
        assert.deepEqual(
          (await published).diagnostics.map(({ code }) => code),
          ["bre-question-mark-escape"],
        );
        assert.equal(server.stderr(), "");
      } finally {
        await stopServer(server);
      }
    });
  }
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

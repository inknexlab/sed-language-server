import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";
import {
  CancellationTokenSource,
  createMessageConnection,
  LSPErrorCodes,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-languageserver/node";

function startServer() {
  const child = spawn(process.execPath, ["bin/sed-language-server.js"], {
    cwd: new URL("../..", import.meta.url),
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
  capabilities = {},
  processId = null,
) {
  const result = await connection.sendRequest("initialize", {
    processId,
    rootUri: null,
    capabilities: {
      ...capabilities,
      general: { positionEncodings: ["utf-16"] },
    },
    initializationOptions,
  });
  connection.sendNotification("initialized", {});
  return result;
}

function semanticTokenCapabilities(delta = false) {
  return {
    textDocument: {
      semanticTokens: {
        augmentsSyntaxTokens: true,
        formats: ["relative"],
        requests: { full: delta ? { delta: true } : true },
        tokenModifiers: [],
        tokenTypes: [],
      },
    },
  };
}

async function stopServer(server) {
  const running =
    server.child.exitCode === null && server.child.signalCode === null;
  const exited = running
    ? new Promise((resolve) => server.child.once("exit", resolve))
    : Promise.resolve();
  if (running) {
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

function writeNotification(child, method, params) {
  const body = JSON.stringify({ jsonrpc: "2.0", method, params });
  child.stdin.write(
    `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`,
  );
}

test("serves the complete document lifecycle over default stdio", async (t) => {
  const server = startServer();
  t.after(async () => stopServer(server));
  const initialized = await initialize(server.connection, {});
  assert.deepEqual(initialized.capabilities, {
    documentFormattingProvider: true,
    positionEncoding: "utf-16",
    textDocumentSync: {
      openClose: true,
      change: 2,
    },
  });

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

test("does not advertise Semantic Tokens without classifications", async (t) => {
  const server = startServer();
  t.after(async () => stopServer(server));
  const initialized = await initialize(
    server.connection,
    {},
    {
      textDocument: {
        semanticTokens: {
          augmentsSyntaxTokens: false,
          formats: ["relative"],
          requests: { full: { delta: true } },
          tokenModifiers: [],
          tokenTypes: [],
        },
      },
    },
  );
  assert.equal(
    Object.hasOwn(initialized.capabilities, "semanticTokensProvider"),
    false,
  );
  await assert.rejects(
    server.connection.sendRequest("textDocument/semanticTokens/full", {
      textDocument: { uri: "file:///tokens.sed" },
    }),
    {
      code: -32600,
      message: "Semantic Tokens were not negotiated.",
    },
  );
});

test("serves empty Semantic Tokens through changes and delta history", async (t) => {
  const server = startServer();
  t.after(async () => stopServer(server));
  const initialized = await initialize(
    server.connection,
    {},
    semanticTokenCapabilities(true),
  );
  assert.deepEqual(initialized.capabilities.semanticTokensProvider, {
    full: { delta: true },
    legend: { tokenModifiers: [], tokenTypes: [] },
  });

  const uri = "file:///semantic-token-delta.sed";
  server.connection.sendNotification("textDocument/didOpen", {
    textDocument: {
      languageId: "sed",
      text: "p\n",
      uri,
      version: 1,
    },
  });
  const pending = server.connection.sendRequest(
    "textDocument/semanticTokens/full",
    { textDocument: { uri } },
  );
  server.connection.sendNotification("textDocument/didChange", {
    contentChanges: [{ text: "q\n" }],
    textDocument: { uri, version: 2 },
  });
  const first = await pending;
  assert.deepEqual(first.data, []);
  assert.equal(typeof first.resultId, "string");

  const delta = await server.connection.sendRequest(
    "textDocument/semanticTokens/full/delta",
    {
      previousResultId: first.resultId,
      textDocument: { uri },
    },
  );
  assert.deepEqual(delta.edits, []);
  assert.notEqual(delta.resultId, first.resultId);

  const unopenedUri = "file:///unopened-semantic-tokens.sed";
  assert.deepEqual(
    await server.connection.sendRequest("textDocument/semanticTokens/full", {
      textDocument: { uri: unopenedUri },
    }),
    { data: [] },
  );
  assert.deepEqual(
    await server.connection.sendRequest(
      "textDocument/semanticTokens/full/delta",
      {
        previousResultId: delta.resultId,
        textDocument: { uri: unopenedUri },
      },
    ),
    { data: [] },
  );

  server.connection.sendNotification("textDocument/didClose", {
    textDocument: { uri },
  });
  server.connection.sendNotification("textDocument/didOpen", {
    textDocument: {
      languageId: "sed",
      text: "d\n",
      uri,
      version: 3,
    },
  });
  const reopened = await server.connection.sendRequest(
    "textDocument/semanticTokens/full/delta",
    {
      previousResultId: delta.resultId,
      textDocument: { uri },
    },
  );
  assert.deepEqual(reopened.data, []);
  assert.equal(typeof reopened.resultId, "string");
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

test("enforces the LSP request lifecycle", async (t) => {
  const server = startServer();
  t.after(async () => stopServer(server));
  const formattingRequest = {
    textDocument: { uri: "file:///lifecycle.sed" },
    options: { tabSize: 2, insertSpaces: true },
  };
  const semanticTokensRequest = {
    textDocument: { uri: "file:///lifecycle.sed" },
  };
  const semanticTokensDeltaRequest = {
    previousResultId: "previous",
    textDocument: { uri: "file:///lifecycle.sed" },
  };
  await assert.rejects(
    server.connection.sendRequest("textDocument/formatting", formattingRequest),
    { code: -32002 },
  );
  await assert.rejects(
    server.connection.sendRequest(
      "textDocument/semanticTokens/full",
      semanticTokensRequest,
    ),
    { code: -32002 },
  );
  await assert.rejects(
    server.connection.sendRequest(
      "textDocument/semanticTokens/full/delta",
      semanticTokensDeltaRequest,
    ),
    { code: -32002 },
  );
  await initialize(server.connection, {});
  await assert.rejects(
    server.connection.sendRequest("initialize", {
      processId: null,
      rootUri: null,
      capabilities: {},
      initializationOptions: { regex: "ere" },
    }),
    {
      code: -32600,
      message: "The initialize request may only be sent once.",
    },
  );

  await server.connection.sendRequest("shutdown");
  await assert.rejects(
    server.connection.sendRequest("textDocument/formatting", formattingRequest),
    { code: -32600 },
  );
  await assert.rejects(
    server.connection.sendRequest(
      "textDocument/semanticTokens/full",
      semanticTokensRequest,
    ),
    { code: -32600 },
  );
  await assert.rejects(
    server.connection.sendRequest(
      "textDocument/semanticTokens/full/delta",
      semanticTokensDeltaRequest,
    ),
    { code: -32600 },
  );
  const exited = new Promise((resolve) => server.child.once("exit", resolve));
  server.connection.sendNotification("exit");
  assert.equal(await exited, 0);
  assert.equal(server.stderr(), "");
});

test("validates formatting parameters and unopened documents", async (t) => {
  const server = startServer();
  t.after(async () => stopServer(server));
  await initialize(server.connection, {});
  const uri = "file:///formatting-parameters.sed";

  await assert.rejects(
    server.connection.sendRequest("textDocument/formatting", {
      textDocument: { uri: "file:///unopened.sed" },
      options: null,
    }),
    {
      code: -32602,
      message:
        "Formatting options must include a boolean insertSpaces and a uinteger tabSize.",
    },
  );
  assert.deepEqual(
    await server.connection.sendRequest("textDocument/formatting", {
      textDocument: { uri: "file:///unopened.sed" },
      options: { tabSize: 2, insertSpaces: true },
    }),
    [],
  );

  server.connection.sendNotification("textDocument/didOpen", {
    textDocument: {
      uri,
      languageId: "sed",
      version: 1,
      text: "p\n",
    },
  });
  await assert.rejects(
    server.connection.sendRequest("textDocument/formatting", {
      textDocument: { uri },
      options: null,
    }),
    {
      code: -32602,
      message:
        "Formatting options must include a boolean insertSpaces and a uinteger tabSize.",
    },
  );
  assert.deepEqual(
    await server.connection.sendRequest("textDocument/formatting", {
      textDocument: { uri },
      options: { tabSize: 0, insertSpaces: true },
    }),
    [],
  );
  await assert.rejects(
    server.connection.sendRequest("textDocument/formatting", {
      textDocument: { uri },
      options: { tabSize: null, insertSpaces: true },
    }),
    {
      code: -32602,
      message:
        "Formatting options must include a boolean insertSpaces and a uinteger tabSize.",
    },
  );
  await assert.rejects(
    server.connection.sendRequest("textDocument/formatting", {
      textDocument: { uri },
      options: { tabSize: -1, insertSpaces: true },
    }),
    {
      code: -32602,
      message:
        "Formatting options must include a boolean insertSpaces and a uinteger tabSize.",
    },
  );
  await assert.rejects(
    server.connection.sendRequest("textDocument/formatting", {
      textDocument: { uri },
      options: { tabSize: 2, insertSpaces: null },
    }),
    {
      code: -32602,
      message:
        "Formatting options must include a boolean insertSpaces and a uinteger tabSize.",
    },
  );
  await assert.rejects(
    server.connection.sendRequest("textDocument/formatting", {
      textDocument: { uri },
      options: {
        tabSize: 2,
        insertSpaces: true,
        trimFinalNewlines: null,
      },
    }),
    {
      code: -32602,
      message: "Formatting option trimFinalNewlines must be a boolean.",
    },
  );
  await assert.rejects(
    server.connection.sendRequest("textDocument/formatting", {
      textDocument: { uri },
      options: {},
    }),
    {
      code: -32602,
      message:
        "Formatting options must include a boolean insertSpaces and a uinteger tabSize.",
    },
  );
  await assert.rejects(
    server.connection.sendRequest("textDocument/formatting", {
      textDocument: { uri },
      options: { tabSize: 2 ** 31, insertSpaces: true },
    }),
    {
      code: -32602,
      message:
        "Formatting options must include a boolean insertSpaces and a uinteger tabSize.",
    },
  );
  assert.equal(server.stderr(), "");
});

test("validates Semantic Tokens request parameters", async (t) => {
  const server = startServer();
  t.after(async () => stopServer(server));
  await initialize(server.connection, {}, semanticTokenCapabilities());

  await assert.rejects(
    server.connection.sendRequest("textDocument/semanticTokens/full", null),
    { code: -32602 },
  );
  for (const parameters of [
    {},
    { textDocument: null },
    { textDocument: { uri: null } },
  ]) {
    await assert.rejects(
      server.connection.sendRequest(
        "textDocument/semanticTokens/full",
        parameters,
      ),
      {
        code: -32602,
        message: "Semantic Tokens parameters must include a text document URI.",
      },
    );
  }
  for (const previousResultId of [undefined, null, 1]) {
    await assert.rejects(
      server.connection.sendRequest("textDocument/semanticTokens/full/delta", {
        ...(previousResultId === undefined ? {} : { previousResultId }),
        textDocument: { uri: "file:///tokens.sed" },
      }),
      {
        code: -32602,
        message: "previousResultId must be a string.",
      },
    );
  }
  await assert.rejects(
    server.connection.sendRequest("textDocument/semanticTokens/full/delta", {
      previousResultId: "not-negotiated",
      textDocument: { uri: "file:///tokens.sed" },
    }),
    {
      code: -32600,
      message: "Semantic Tokens delta was not negotiated.",
    },
  );
  assert.equal(server.stderr(), "");
});

test("rejects formatting after a document change", async (t) => {
  const server = startServer();
  t.after(async () => stopServer(server));
  await initialize(server.connection, {});
  const uri = "file:///format-change.sed";
  server.connection.sendNotification("textDocument/didOpen", {
    textDocument: {
      uri,
      languageId: "sed",
      version: 1,
      text: "p;".repeat(20_000),
    },
  });

  const pending = server.connection.sendRequest("textDocument/formatting", {
    textDocument: { uri },
    options: { insertSpaces: true, tabSize: 2 },
  });
  server.connection.sendNotification("textDocument/didChange", {
    textDocument: { uri, version: 2 },
    contentChanges: [{ text: "q\n" }],
  });

  await assert.rejects(
    pending,
    (error) => error.code === LSPErrorCodes.ContentModified,
  );
  assert.equal(server.stderr(), "");
});

test("honors client cancellation for formatting", async (t) => {
  const server = startServer();
  t.after(async () => stopServer(server));
  await initialize(server.connection, {});
  const uri = "file:///format-cancel.sed";
  server.connection.sendNotification("textDocument/didOpen", {
    textDocument: {
      uri,
      languageId: "sed",
      version: 1,
      text: "p;".repeat(20_000),
    },
  });

  const cancellation = new CancellationTokenSource();
  const pending = server.connection.sendRequest(
    "textDocument/formatting",
    {
      textDocument: { uri },
      options: { insertSpaces: true, tabSize: 2 },
    },
    cancellation.token,
  );
  cancellation.cancel();

  await assert.rejects(
    pending,
    (error) => error.code === LSPErrorCodes.RequestCancelled,
  );
  assert.equal(server.stderr(), "");
});

test("does not update Semantic Tokens history after cancellation", async (t) => {
  const server = startServer();
  t.after(async () => stopServer(server));
  await initialize(server.connection, {}, semanticTokenCapabilities(true));
  const uri = "file:///semantic-tokens-cancel.sed";
  const opened = notification(
    server.connection,
    "textDocument/publishDiagnostics",
    ({ uri: received }) => received === uri,
  );
  server.connection.sendNotification("textDocument/didOpen", {
    textDocument: {
      uri,
      languageId: "sed",
      version: 1,
      text: "p\n",
    },
  });
  await opened;

  const baseline = await server.connection.sendRequest(
    "textDocument/semanticTokens/full",
    { textDocument: { uri } },
  );
  const cancellation = new CancellationTokenSource();
  const pending = server.connection.sendRequest(
    "textDocument/semanticTokens/full/delta",
    { previousResultId: baseline.resultId, textDocument: { uri } },
    cancellation.token,
  );
  cancellation.cancel();

  await assert.rejects(
    pending,
    (error) => error.code === LSPErrorCodes.RequestCancelled,
  );
  const afterCancellation = await server.connection.sendRequest(
    "textDocument/semanticTokens/full/delta",
    { previousResultId: baseline.resultId, textDocument: { uri } },
  );
  assert.deepEqual(afterCancellation.edits, []);
  assert.equal(server.stderr(), "");
});

test("disposes active work before preserving OS signal termination", async (t) => {
  const server = startServer();
  t.after(async () => stopServer(server));
  await initialize(server.connection, {});
  const uri = "file:///signal-disposal.sed";
  server.connection.sendNotification("textDocument/didOpen", {
    textDocument: {
      uri,
      languageId: "sed",
      version: 1,
      text: "p;".repeat(100_000),
    },
  });

  const pending = server.connection.sendRequest("textDocument/formatting", {
    textDocument: { uri },
    options: { insertSpaces: true, tabSize: 2 },
  });
  assert.deepEqual(
    await server.connection.sendRequest("textDocument/formatting", {
      textDocument: { uri: "file:///signal-barrier.sed" },
      options: { insertSpaces: true, tabSize: 2 },
    }),
    [],
  );

  const exited = new Promise((resolve) => {
    server.child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  assert.equal(server.child.kill("SIGTERM"), true);
  await assert.rejects(
    pending,
    (error) => error.code === LSPErrorCodes.RequestFailed,
  );
  assert.deepEqual(await exited, { code: null, signal: "SIGTERM" });
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

test("exits when the initialized client process is absent", async (t) => {
  const server = startServer();
  t.after(async () => stopServer(server));
  const exited = new Promise((resolve) => server.child.once("exit", resolve));
  await initialize(server.connection, {}, {}, 2_147_483_647);
  let timeout;
  const deadline = new Promise((_resolve, reject) => {
    timeout = setTimeout(
      () =>
        reject(new Error("The server did not exit after its client vanished.")),
      5_000,
    );
  });
  const exitCode = await Promise.race([exited, deadline]);
  clearTimeout(timeout);
  assert.equal(exitCode, 1);
  assert.equal(server.stderr(), "");
});

test("rejects unsafe client process identifiers", async (t) => {
  const server = startServer();
  t.after(async () => stopServer(server));
  await assert.rejects(
    server.connection.sendRequest("initialize", {
      processId: 0,
      rootUri: null,
      capabilities: {},
      initializationOptions: {},
    }),
    {
      code: -32602,
      message: "processId must be a positive LSP integer or null.",
    },
  );
  await initialize(server.connection, {});
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

test("stays initializable after invalid initialization options", async (t) => {
  const server = startServer();
  t.after(async () => stopServer(server));
  await assert.rejects(
    server.connection.sendRequest("initialize", {
      processId: null,
      rootUri: null,
      capabilities: {},
      initializationOptions: { regex: "posix" },
    }),
    (error) =>
      error.code === -32602 &&
      /initializationOptions\.regex must be/.test(error.message),
  );

  const initialized = await initialize(server.connection, { regex: "ere" });
  assert.equal(initialized.serverInfo.name, "sed-language-server");
  const uri = "file:///retried-initialize.sed";
  const published = notification(
    server.connection,
    "textDocument/publishDiagnostics",
    (params) => params.uri === uri,
  );
  server.connection.sendNotification("textDocument/didOpen", {
    textDocument: { uri, languageId: "sed", version: 1, text: "s/(a)/\\1/\n" },
  });
  assert.deepEqual((await published).diagnostics, []);
  assert.equal(server.stderr(), "");
});

test("does not track a document opened before initialization completes", async (t) => {
  const server = startServer();
  t.after(async () => stopServer(server));
  const logs = [];
  const disposable = server.connection.onNotification(
    "window/logMessage",
    (params) => logs.push(params.message),
  );
  t.after(() => disposable.dispose());

  const uri = "file:///opened-during-initialize.sed";
  const pending = server.connection.sendRequest("initialize", {
    processId: null,
    rootUri: null,
    capabilities: { general: { positionEncodings: ["utf-16"] } },
    initializationOptions: {},
  });
  server.connection.sendNotification("textDocument/didOpen", {
    textDocument: { uri, languageId: "sed", version: 1, text: "p\n" },
  });
  await pending;
  server.connection.sendNotification("initialized", {});
  server.connection.sendNotification("textDocument/didChange", {
    textDocument: { uri, version: 2 },
    contentChanges: [{ text: "q\n" }],
  });
  await wait(200);
  assert.deepEqual(
    logs.filter((message) => /Cannot update unopened document/.test(message)),
    [],
  );

  const published = notification(
    server.connection,
    "textDocument/publishDiagnostics",
    (params) => params.uri === uri,
  );
  server.connection.sendNotification("textDocument/didOpen", {
    textDocument: { uri, languageId: "sed", version: 3, text: "z\n" },
  });
  const reopened = await published;
  assert.equal(reopened.version, 3);
  assert.deepEqual(
    reopened.diagnostics.map(({ code }) => code),
    ["unknown-function"],
  );
});

test("drops a document whose change the server cannot apply", async (t) => {
  const server = startServer();
  t.after(async () => stopServer(server));
  await initialize(server.connection, {});
  const uri = "file:///rejected-change.sed";
  const opened = notification(
    server.connection,
    "textDocument/publishDiagnostics",
    (params) => params.uri === uri && params.version === 1,
  );
  server.connection.sendNotification("textDocument/didOpen", {
    textDocument: { uri, languageId: "sed", version: 1, text: "p;q" },
  });
  assert.deepEqual((await opened).diagnostics, []);

  const cleared = notification(
    server.connection,
    "textDocument/publishDiagnostics",
    (params) => params.uri === uri && params.version === 2,
  );
  server.connection.sendNotification("textDocument/didChange", {
    textDocument: { uri, version: 2 },
    contentChanges: [
      { range: { start: { line: 0, character: 1 } }, text: "X" },
    ],
  });

  assert.deepEqual((await cleared).diagnostics, []);
  assert.deepEqual(
    await server.connection.sendRequest("textDocument/formatting", {
      textDocument: { uri },
      options: { insertSpaces: true, tabSize: 2 },
    }),
    [],
  );
});

test("reports a close during formatting as modified content", async (t) => {
  const server = startServer();
  t.after(async () => stopServer(server));
  await initialize(server.connection, {});
  const uri = "file:///format-close.sed";
  server.connection.sendNotification("textDocument/didOpen", {
    textDocument: {
      uri,
      languageId: "sed",
      version: 1,
      text: "p;".repeat(20_000),
    },
  });

  const pending = server.connection.sendRequest("textDocument/formatting", {
    textDocument: { uri },
    options: { insertSpaces: true, tabSize: 2 },
  });
  server.connection.sendNotification("textDocument/didClose", {
    textDocument: { uri },
  });

  await assert.rejects(
    pending,
    (error) => error.code === LSPErrorCodes.ContentModified,
  );
  assert.equal(server.stderr(), "");
});

test("keeps running when the client output channel breaks", async (t) => {
  const server = startServer();
  t.after(async () => stopServer(server));
  await initialize(server.connection, {});
  const uri = "file:///broken-output.sed";
  const published = notification(
    server.connection,
    "textDocument/publishDiagnostics",
    (params) => params.uri === uri,
  );
  server.connection.sendNotification("textDocument/didOpen", {
    textDocument: { uri, languageId: "sed", version: 1, text: "p\n" },
  });
  await published;

  server.child.stdout.destroy();
  await wait(100);
  writeNotification(server.child, "textDocument/didChange", {
    textDocument: { uri, version: 2 },
    contentChanges: [{ text: "z\n" }],
  });
  writeNotification(server.child, "textDocument/didClose", {
    textDocument: { uri },
  });
  await wait(500);

  assert.equal(server.child.exitCode, null);
  assert.equal(server.stderr(), "");
});

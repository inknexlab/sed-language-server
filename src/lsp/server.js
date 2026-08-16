import { SedAnalysis } from "@inknexlab/sed-language-server/analysis";
import {
  createConnection,
  ErrorCodes,
  LSPErrorCodes,
  MessageType,
  PositionEncodingKind,
  ResponseError,
  TextDocumentSyncKind,
  TextDocuments,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { diagnostics } from "./diagnostics.js";
import { DocumentStore } from "./documents.js";
import { formatting } from "./formatting.js";
import {
  SemanticTokenResults,
  semanticTokenConfiguration,
  semanticTokens,
} from "./semantic-tokens.js";

const diagnosticDelay = 250;
const maximumUInteger = 2_147_483_647;
const parentCheckDelay = 250;
const regularExpressionModes = new Set(["bre", "ere"]);
const serverPhases = Object.freeze({
  initializing: "initializing",
  running: "running",
  stopped: "stopped",
  stopping: "stopping",
  waiting: "waiting",
});

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function isCancellation(error) {
  return error?.name === "AbortError";
}

function processIsAlive(identifier) {
  try {
    process.kill(identifier, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function invalidParameters(message) {
  return new ResponseError(ErrorCodes.InvalidParams, message);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parentProcessId(value) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximumUInteger) {
    throw invalidParameters(
      "processId must be a positive LSP integer or null.",
    );
  }
  return value;
}

// The regular-expression language is fixed for the lifetime of the process, so
// it is the one thing the client chooses at initialization.
function initializationMode(options) {
  if (options === undefined || options === null) {
    return "bre";
  }
  if (!isRecord(options)) {
    throw invalidParameters("initializationOptions must be an object.");
  }
  if (Object.keys(options).some((key) => key !== "regex")) {
    throw invalidParameters(
      "The only supported initialization option is 'regex'.",
    );
  }
  const mode = Object.hasOwn(options, "regex") ? options.regex : "bre";
  if (!regularExpressionModes.has(mode)) {
    throw invalidParameters(
      "initializationOptions.regex must be 'bre' or 'ere'.",
    );
  }
  return mode;
}

function textDocumentUri(parameters, requestName) {
  if (!isRecord(parameters)) {
    throw invalidParameters(`${requestName} parameters must be an object.`);
  }
  const { textDocument } = parameters;
  if (!isRecord(textDocument) || typeof textDocument.uri !== "string") {
    throw invalidParameters(
      `${requestName} parameters must include a text document URI.`,
    );
  }
  return textDocument.uri;
}

function formattingParameters(parameters) {
  const uri = textDocumentUri(parameters, "Formatting");
  const { options } = parameters;
  if (
    !isRecord(options) ||
    typeof options.insertSpaces !== "boolean" ||
    !Number.isInteger(options.tabSize) ||
    options.tabSize < 0 ||
    options.tabSize > maximumUInteger
  ) {
    throw invalidParameters(
      "Formatting options must include a boolean insertSpaces and a uinteger tabSize.",
    );
  }
  for (const name of [
    "insertFinalNewline",
    "trimFinalNewlines",
    "trimTrailingWhitespace",
  ]) {
    if (options[name] !== undefined && typeof options[name] !== "boolean") {
      throw invalidParameters(`Formatting option ${name} must be a boolean.`);
    }
  }
  return { options, uri };
}

function semanticTokensParameters(parameters, delta) {
  const uri = textDocumentUri(parameters, "Semantic Tokens");
  if (delta && typeof parameters.previousResultId !== "string") {
    throw invalidParameters("previousResultId must be a string.");
  }
  return {
    previousResultId: delta ? parameters.previousResultId : undefined,
    uri,
  };
}

function sentenceCase(activity) {
  return `${activity[0].toUpperCase()}${activity.slice(1)}`;
}

// Tracks every in-flight request so a document change, a client cancellation or
// a shutdown can abort the work it made obsolete.
class OperationRegistry {
  #currentDocument;
  #diagnosticRuns = new Map();
  #operations = new Set();

  constructor(currentDocument) {
    this.#currentDocument = currentDocument;
  }

  register(uri, kind, document, token) {
    let resolveFinished;
    const operation = {
      controller: new AbortController(),
      document,
      finished: new Promise((resolve) => {
        resolveFinished = resolve;
      }),
      reason: undefined,
      resolveFinished,
      subscription: undefined,
      uri,
    };
    this.#operations.add(operation);
    if (kind === "diagnostics") {
      this.#diagnosticRuns.set(uri, operation);
    }
    if (token !== undefined) {
      operation.subscription = token.onCancellationRequested(() => {
        this.cancel(operation, "client");
      });
      if (token.isCancellationRequested) {
        this.cancel(operation, "client");
      }
    }
    return operation;
  }

  cancel(operation, reason) {
    if (!operation.controller.signal.aborted) {
      operation.reason = reason;
      operation.controller.abort();
    }
  }

  finish(operation) {
    if (!this.#operations.delete(operation)) {
      return;
    }
    if (this.#diagnosticRuns.get(operation.uri) === operation) {
      this.#diagnosticRuns.delete(operation.uri);
    }
    operation.subscription?.dispose();
    operation.resolveFinished();
  }

  cancelDocument(uri, reason) {
    for (const operation of this.#operations) {
      if (operation.uri === uri) {
        this.cancel(operation, reason);
      }
    }
  }

  cancelDiagnostics(uri) {
    const operation = this.#diagnosticRuns.get(uri);
    if (operation !== undefined) {
      this.cancel(operation, "obsolete");
    }
  }

  cancelAll(reason) {
    const pending = [...this.#operations];
    for (const operation of pending) {
      this.cancel(operation, reason);
    }
    return Promise.all(pending.map(({ finished }) => finished));
  }

  isCurrent(operation) {
    return (
      this.#operations.has(operation) &&
      this.#currentDocument(operation.uri) === operation.document
    );
  }

  cancellation(operation, activity) {
    if (operation.reason === "modified") {
      return new ResponseError(
        LSPErrorCodes.ContentModified,
        `The document changed while ${activity}.`,
      );
    }
    if (operation.reason === "shutdown") {
      return new ResponseError(
        LSPErrorCodes.RequestFailed,
        `${sentenceCase(activity)} was interrupted because the language server is shutting down.`,
      );
    }
    return new ResponseError(
      LSPErrorCodes.RequestCancelled,
      `${sentenceCase(activity)} was cancelled.`,
    );
  }

  requireCurrent(operation, activity) {
    if (operation.reason === undefined && !this.isCurrent(operation)) {
      this.cancel(operation, "modified");
    }
    if (operation.reason !== undefined) {
      throw this.cancellation(operation, activity);
    }
  }
}

export function startLanguageServer() {
  const connection = createConnection();
  const diagnosticTimers = new Map();
  const operations = new OperationRegistry((uri) =>
    activeSession()?.documents.current(uri),
  );
  const semanticTokenResults = new SemanticTokenResults();
  let initialization;
  let parentProcessTimer;
  let semanticTokenSettings;
  let serverDisposal;
  let serverPhase = serverPhases.waiting;
  let serverStop;
  let session;

  function activeSession() {
    return serverPhase === serverPhases.running ? session : undefined;
  }

  function requireSession() {
    if (
      serverPhase === serverPhases.waiting ||
      serverPhase === serverPhases.initializing
    ) {
      throw new ResponseError(
        ErrorCodes.ServerNotInitialized,
        "The language server has not been initialized.",
      );
    }
    const active = activeSession();
    if (active === undefined) {
      throw new ResponseError(
        ErrorCodes.InvalidRequest,
        "The language server is shutting down.",
      );
    }
    return active;
  }

  function stopParentProcessMonitor() {
    if (parentProcessTimer !== undefined) {
      clearInterval(parentProcessTimer);
      parentProcessTimer = undefined;
    }
  }

  function monitorParentProcess(identifier) {
    if (identifier === undefined) {
      return;
    }
    const check = () => {
      if (serverPhase === serverPhases.running && !processIsAlive(identifier)) {
        stopParentProcessMonitor();
        void (async () => {
          try {
            await shutdown();
          } finally {
            process.exit(1);
          }
        })();
      }
    };
    // The first check waits a full interval so the initialize response is
    // written before a server whose client is already gone terminates.
    parentProcessTimer = setInterval(check, parentCheckDelay);
    parentProcessTimer.unref();
  }

  function cancelScheduledDiagnostics(uri) {
    const timer = diagnosticTimers.get(uri);
    if (timer !== undefined) {
      clearTimeout(timer);
      diagnosticTimers.delete(uri);
    }
  }

  function cancelDiagnostics(uri) {
    cancelScheduledDiagnostics(uri);
    operations.cancelDiagnostics(uri);
  }

  function cancelDocumentWork(uri, reason) {
    cancelScheduledDiagnostics(uri);
    operations.cancelDocument(uri, reason);
  }

  // Every report and notification the server sends without a caller waiting for
  // it absorbs its own failure, because a closed transport must not surface as
  // an unhandled rejection. The notification goes out directly: the remote
  // console retries a failed log through a handler that throws where no caller
  // can catch it.
  async function reportError(message) {
    try {
      await connection.sendNotification("window/logMessage", {
        message,
        type: MessageType.Error,
      });
    } catch {}
  }

  async function sendDiagnostics(uri, values, version) {
    try {
      await connection.sendDiagnostics({ diagnostics: values, uri, version });
    } catch (error) {
      await reportError(
        `Failed to publish diagnostics for ${uri}: ${errorMessage(error)}`,
      );
    }
  }

  function release(lease, operation) {
    try {
      lease.dispose();
    } finally {
      operations.finish(operation);
    }
  }

  async function publishDiagnostics(uri) {
    cancelDiagnostics(uri);
    const active = activeSession();
    const lease = active?.documents.acquire(uri);
    if (lease === undefined) {
      return;
    }
    const { document } = lease;
    const operation = operations.register(uri, "diagnostics", document);
    try {
      let values;
      try {
        values = await diagnostics(active.analysis, lease, {
          signal: operation.controller.signal,
        });
      } catch (error) {
        if (!isCancellation(error) && operations.isCurrent(operation)) {
          await reportError(`Diagnostics: ${errorMessage(error)}`);
        }
        return;
      }
      if (operations.isCurrent(operation)) {
        await sendDiagnostics(uri, values, document.version);
      }
    } finally {
      release(lease, operation);
    }
  }

  function scheduleDiagnostics(uri) {
    cancelDiagnostics(uri);
    const timer = setTimeout(() => {
      if (diagnosticTimers.get(uri) !== timer) {
        return;
      }
      diagnosticTimers.delete(uri);
      void publishDiagnostics(uri).catch((error) =>
        reportError(errorMessage(error)),
      );
    }, diagnosticDelay);
    timer.unref();
    diagnosticTimers.set(uri, timer);
  }

  function acquireOperation(active, uri, kind, token) {
    const lease = active.documents.acquire(uri);
    return lease === undefined
      ? undefined
      : {
          lease,
          operation: operations.register(uri, kind, lease.document, token),
        };
  }

  // Both stop paths share one teardown, so a forced exit during a graceful
  // shutdown cannot report disposal before the analysis is gone.
  function teardown() {
    serverDisposal ??= (async () => {
      const active = session;
      session = undefined;
      stopParentProcessMonitor();
      semanticTokenResults.clearAll();
      for (const timer of diagnosticTimers.values()) {
        clearTimeout(timer);
      }
      diagnosticTimers.clear();
      if (active !== undefined) {
        try {
          active.documents.dispose();
        } finally {
          await active.analysis.dispose();
        }
      }
    })();
    return serverDisposal;
  }

  function shutdown() {
    serverStop ??= (async () => {
      serverPhase = serverPhases.stopping;
      await operations.cancelAll("shutdown");
      if (initialization !== undefined) {
        await Promise.allSettled([initialization]);
      }
      try {
        await teardown();
      } finally {
        serverPhase = serverPhases.stopped;
      }
    })();
    return serverStop;
  }

  // Terminates without waiting for in-flight work, while the host is still able
  // to run this turn.
  function forceShutdown() {
    serverPhase = serverPhases.stopped;
    void operations.cancelAll("shutdown");
    const disposal = teardown();
    serverStop ??= disposal;
    void disposal.catch(() => undefined);
  }

  // Maintaining the store from the same callbacks that maintain the synced
  // documents keeps both registries in step: a document the store cannot accept
  // is never registered. A change the store cannot apply leaves the server
  // behind the client, so the document is closed instead of answering later
  // requests from text the client no longer has.
  const documents = new TextDocuments({
    create(uri, languageId, version, content) {
      return requireSession().documents.open(
        TextDocument.create(uri, languageId, version, content),
      );
    },
    update(current, changes, version) {
      const active = requireSession();
      let next;
      try {
        next = active.documents.update(current.uri, changes, version);
      } catch (error) {
        active.documents.close(current.uri);
        cancelDocumentWork(current.uri, "modified");
        void sendDiagnostics(current.uri, [], version);
        throw error;
      }
      cancelDocumentWork(current.uri, "modified");
      return next;
    },
  });

  connection.onInitialize(
    ({ capabilities, initializationOptions, processId }) => {
      if (serverPhase !== serverPhases.waiting) {
        throw new ResponseError(
          ErrorCodes.InvalidRequest,
          "The initialize request may only be sent once.",
        );
      }
      const monitoredProcess = parentProcessId(processId);
      const mode = initializationMode(initializationOptions);
      semanticTokenSettings = semanticTokenConfiguration(
        capabilities?.textDocument?.semanticTokens,
      );
      serverPhase = serverPhases.initializing;
      initialization = (async () => {
        let analysis;
        try {
          analysis = await SedAnalysis.create(mode);
          if (serverPhase !== serverPhases.initializing) {
            throw new ResponseError(
              ErrorCodes.InvalidRequest,
              "The language server is shutting down.",
            );
          }
          session = { analysis, documents: new DocumentStore(analysis) };
          serverPhase = serverPhases.running;
          monitorParentProcess(monitoredProcess);
          return {
            capabilities: {
              documentFormattingProvider: true,
              positionEncoding: PositionEncodingKind.UTF16,
              ...(semanticTokenSettings === undefined
                ? {}
                : {
                    semanticTokensProvider: {
                      full: semanticTokenSettings.delta
                        ? { delta: true }
                        : true,
                      legend: semanticTokenSettings.legend,
                    },
                  }),
              textDocumentSync: {
                change: TextDocumentSyncKind.Incremental,
                openClose: true,
              },
            },
            serverInfo: { name: "sed-language-server" },
          };
        } catch (error) {
          if (session === undefined) {
            await Promise.allSettled([analysis?.dispose()]);
          }
          if (serverPhase === serverPhases.initializing) {
            serverPhase = serverPhases.stopped;
          }
          throw error;
        }
      })();
      return initialization;
    },
  );

  documents.onDidOpen(({ document }) => {
    cancelDocumentWork(document.uri, "modified");
    semanticTokenResults.clear(document.uri);
  });

  documents.onDidChangeContent(({ document }) => {
    scheduleDiagnostics(document.uri);
  });

  documents.onDidClose(({ document }) => {
    const active = activeSession();
    if (active === undefined) {
      return;
    }
    cancelDocumentWork(document.uri, "modified");
    semanticTokenResults.clear(document.uri);
    active.documents.close(document.uri);
    void sendDiagnostics(document.uri, [], document.version);
  });

  connection.onDocumentFormatting(async (parameters, token) => {
    const active = requireSession();
    const { options, uri } = formattingParameters(parameters);
    const acquired = acquireOperation(active, uri, "formatting", token);
    if (acquired === undefined) {
      return [];
    }
    const { lease, operation } = acquired;
    try {
      const edits = await formatting(active.analysis, lease, options, {
        signal: operation.controller.signal,
      });
      operations.requireCurrent(operation, "formatting");
      return edits;
    } catch (error) {
      if (operation.reason !== undefined || isCancellation(error)) {
        throw operations.cancellation(operation, "formatting");
      }
      throw error;
    } finally {
      release(lease, operation);
    }
  });

  async function provideSemanticTokens(active, uri, token, previousResultId) {
    const acquired = acquireOperation(active, uri, "semantic tokens", token);
    if (acquired === undefined) {
      return { data: [] };
    }
    const { lease, operation } = acquired;
    try {
      const result = await semanticTokens(active.analysis, lease, {
        signal: operation.controller.signal,
      });
      operations.requireCurrent(operation, "computing semantic tokens");
      if (!semanticTokenSettings?.delta) {
        return result;
      }
      return previousResultId === undefined
        ? semanticTokenResults.full(uri, result.data)
        : semanticTokenResults.delta(uri, previousResultId, result.data);
    } catch (error) {
      if (operation.reason !== undefined || isCancellation(error)) {
        throw operations.cancellation(operation, "computing semantic tokens");
      }
      throw error;
    } finally {
      release(lease, operation);
    }
  }

  connection.languages.semanticTokens.on((parameters, token) => {
    const active = requireSession();
    const { uri } = semanticTokensParameters(parameters, false);
    if (semanticTokenSettings === undefined) {
      throw new ResponseError(
        ErrorCodes.InvalidRequest,
        "Semantic Tokens were not negotiated.",
      );
    }
    return provideSemanticTokens(active, uri, token);
  });

  connection.languages.semanticTokens.onDelta((parameters, token) => {
    const active = requireSession();
    const { previousResultId, uri } = semanticTokensParameters(
      parameters,
      true,
    );
    if (semanticTokenSettings?.delta !== true) {
      throw new ResponseError(
        ErrorCodes.InvalidRequest,
        "Semantic Tokens delta was not negotiated.",
      );
    }
    return provideSemanticTokens(active, uri, token, previousResultId);
  });

  connection.onShutdown(() => {
    if (
      serverPhase === serverPhases.waiting ||
      serverPhase === serverPhases.initializing
    ) {
      throw new ResponseError(
        ErrorCodes.ServerNotInitialized,
        "The language server has not been initialized.",
      );
    }
    if (serverPhase !== serverPhases.running) {
      throw new ResponseError(
        ErrorCodes.InvalidRequest,
        "The language server has already been shut down.",
      );
    }
    return shutdown();
  });
  connection.onExit(forceShutdown);
  documents.listen(connection);
  connection.listen();
  if (process.argv.includes("--stdio")) {
    process.stdin.prependOnceListener("close", forceShutdown);
    process.stdin.prependOnceListener("end", forceShutdown);
  }

  return Object.freeze({ dispose: shutdown, forceDispose: forceShutdown });
}

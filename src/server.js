#!/usr/bin/env node

import {
  createConnection,
  ErrorCodes,
  MarkupKind,
  PositionEncodingKind,
  ResponseError,
  TextDocumentSyncKind,
  TextDocuments,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { diagnostics } from "./diagnostics.js";
import { formattingEdits } from "./formatting.js";
import { hover } from "./hover.js";
import { regularExpressionModes, SyntaxStore } from "./parser.js";
import { definitions, references } from "./symbols.js";

if (process.argv.length === 2) {
  process.argv.push("--stdio");
}

const connection = createConnection();
const diagnosticDelay = 50;
const diagnosticTimers = new Map();
const serverPhases = Object.freeze({
  initializing: "initializing",
  running: "running",
  shutdown: "shutdown",
  waiting: "waiting",
});
let hoverContentKind = null;
let syntaxStore;
let serverPhase = serverPhases.waiting;

function preferredMarkupKind(formats) {
  if (Array.isArray(formats)) {
    for (const format of formats) {
      if (format === MarkupKind.Markdown || format === MarkupKind.PlainText) {
        return format;
      }
    }
  }
  return null;
}

function initializationMode(options) {
  if (options === undefined || options === null) {
    return "bre";
  }
  if (typeof options !== "object" || Array.isArray(options)) {
    throw new ResponseError(
      ErrorCodes.InvalidParams,
      "initializationOptions must be an object.",
    );
  }
  const keys = Object.keys(options);
  if (keys.some((key) => key !== "regex")) {
    throw new ResponseError(
      ErrorCodes.InvalidParams,
      "The only supported initialization option is 'regex'.",
    );
  }
  const mode = Object.hasOwn(options, "regex") ? options.regex : "bre";
  if (!regularExpressionModes().includes(mode)) {
    throw new ResponseError(
      ErrorCodes.InvalidParams,
      "initializationOptions.regex must be 'bre' or 'ere'.",
    );
  }
  return mode;
}

function activeStore() {
  return serverPhase === serverPhases.running ? syntaxStore : undefined;
}

function requestStore() {
  if (
    serverPhase === serverPhases.waiting ||
    serverPhase === serverPhases.initializing
  ) {
    throw new ResponseError(
      ErrorCodes.ServerNotInitialized,
      "The language server has not been initialized.",
    );
  }
  if (serverPhase !== serverPhases.running || syntaxStore === undefined) {
    throw new ResponseError(
      ErrorCodes.InvalidRequest,
      "The language server has been shut down.",
    );
  }
  return syntaxStore;
}

function requestSnapshot(uri, version) {
  return requestStore().snapshot(uri, version);
}

function publishDiagnostics(uri, version) {
  const currentStore = activeStore();
  const document = currentStore?.document(uri, version);
  if (document === undefined) {
    return;
  }
  const current = currentStore.snapshot(uri, version);
  const values = current === undefined ? [] : diagnostics(current);
  if (activeStore()?.document(uri, version) !== document) {
    return;
  }
  connection.sendDiagnostics({ uri, version, diagnostics: values });
}

function cancelDiagnostics(uri) {
  const timer = diagnosticTimers.get(uri);
  if (timer !== undefined) {
    clearTimeout(timer);
    diagnosticTimers.delete(uri);
  }
}

function cancelAllDiagnostics() {
  for (const timer of diagnosticTimers.values()) {
    clearTimeout(timer);
  }
  diagnosticTimers.clear();
}

function diagnosticError(error) {
  return error instanceof Error
    ? (error.stack ?? error.message)
    : String(error);
}

function scheduleDiagnostics(uri, version) {
  cancelDiagnostics(uri);
  const timer = setTimeout(() => {
    if (diagnosticTimers.get(uri) !== timer) {
      return;
    }
    diagnosticTimers.delete(uri);
    try {
      publishDiagnostics(uri, version);
    } catch (error) {
      connection.console.error(
        `Failed to analyze ${uri}: ${diagnosticError(error)}`,
      );
    }
  }, diagnosticDelay);
  diagnosticTimers.set(uri, timer);
}

const documents = new TextDocuments({
  create: TextDocument.create,
  update(document, changes, version) {
    const currentStore = activeStore();
    return currentStore?.has(document.uri)
      ? currentStore.update(document.uri, changes, version).document
      : TextDocument.update(document, changes, version);
  },
});

connection.onInitialize(async ({ capabilities, initializationOptions }) => {
  if (serverPhase !== serverPhases.waiting) {
    throw new ResponseError(
      ErrorCodes.InvalidRequest,
      "The initialize request may only be sent once.",
    );
  }
  serverPhase = serverPhases.initializing;
  try {
    const mode = initializationMode(initializationOptions);
    hoverContentKind = preferredMarkupKind(
      capabilities.textDocument?.hover?.contentFormat,
    );
    syntaxStore = await SyntaxStore.create(mode);
    serverPhase = serverPhases.running;
  } catch (error) {
    serverPhase = serverPhases.shutdown;
    throw error;
  }
  return {
    capabilities: {
      positionEncoding: PositionEncodingKind.UTF16,
      textDocumentSync: {
        openClose: true,
        change: TextDocumentSyncKind.Incremental,
      },
      definitionProvider: true,
      referencesProvider: true,
      hoverProvider: true,
      documentFormattingProvider: true,
    },
    serverInfo: { name: "sed-language-server" },
  };
});

documents.onDidOpen(({ document }) => {
  const currentStore = activeStore();
  if (currentStore === undefined) {
    return;
  }
  currentStore.open(document);
  scheduleDiagnostics(document.uri, document.version);
});

documents.onDidChangeContent(({ document }) => {
  if (activeStore()?.has(document.uri)) {
    scheduleDiagnostics(document.uri, document.version);
  }
});

documents.onDidClose(({ document }) => {
  const currentStore = activeStore();
  if (currentStore === undefined || !currentStore.has(document.uri)) {
    return;
  }
  cancelDiagnostics(document.uri);
  currentStore.close(document.uri);
  connection.sendDiagnostics({
    uri: document.uri,
    version: document.version,
    diagnostics: [],
  });
});

connection.onDefinition(({ textDocument, position }) => {
  const current = requestSnapshot(textDocument.uri);
  return current === undefined ? [] : definitions(current, position);
});

connection.onReferences(({ textDocument, position, context }) => {
  const current = requestSnapshot(textDocument.uri);
  return current === undefined
    ? []
    : references(current, position, context.includeDeclaration);
});

connection.onHover(({ textDocument, position }) => {
  const current = requestSnapshot(textDocument.uri);
  return current === undefined
    ? null
    : (hover(current, position, hoverContentKind) ?? null);
});

connection.onDocumentFormatting(({ textDocument, options }) => {
  const current = requestSnapshot(textDocument.uri);
  return current === undefined ? [] : formattingEdits(current, options);
});

function dispose() {
  cancelAllDiagnostics();
  syntaxStore?.dispose();
  syntaxStore = undefined;
  hoverContentKind = null;
}

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
  serverPhase = serverPhases.shutdown;
  dispose();
});

connection.onExit(() => {
  serverPhase = serverPhases.shutdown;
  dispose();
});

documents.listen(connection);
connection.listen();

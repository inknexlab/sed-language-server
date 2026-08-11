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
let syntaxStore;
let hoverContentKind = preferredMarkupKind();

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

function store() {
  if (syntaxStore === undefined) {
    throw new Error("The language server has not been initialized.");
  }
  return syntaxStore;
}

function snapshot(uri, version) {
  return syntaxStore?.snapshot(uri, version);
}

function publishDiagnostics(uri, version) {
  const current = snapshot(uri, version);
  if (current === undefined) {
    return;
  }
  const values = diagnostics(current);
  if (snapshot(uri, version) === undefined) {
    return;
  }
  connection.sendDiagnostics({
    uri,
    version,
    diagnostics: values,
  });
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
    return store().update(document.uri, changes, version).document;
  },
});

connection.onInitialize(async ({ capabilities, initializationOptions }) => {
  const mode = initializationMode(initializationOptions);
  hoverContentKind = preferredMarkupKind(
    capabilities.textDocument?.hover?.contentFormat,
  );
  syntaxStore = await SyntaxStore.create(mode);
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
    serverInfo: {
      name: "sed-language-server",
    },
  };
});

documents.onDidOpen(({ document }) => {
  store().open(document);
  scheduleDiagnostics(document.uri, document.version);
});

documents.onDidChangeContent(({ document }) => {
  scheduleDiagnostics(document.uri, document.version);
});

documents.onDidClose(({ document }) => {
  cancelDiagnostics(document.uri);
  syntaxStore?.close(document.uri);
  connection.sendDiagnostics({
    uri: document.uri,
    version: document.version,
    diagnostics: [],
  });
});

connection.onDefinition(({ textDocument, position }) => {
  const current = snapshot(textDocument.uri);
  return current === undefined ? [] : definitions(current, position);
});

connection.onHover(({ textDocument, position }) => {
  const current = snapshot(textDocument.uri);
  return current === undefined
    ? null
    : (hover(current, position, hoverContentKind) ?? null);
});

connection.onReferences(({ textDocument, position, context }) => {
  const current = snapshot(textDocument.uri);
  return current === undefined
    ? []
    : references(current, position, context.includeDeclaration);
});

connection.onDocumentFormatting(({ textDocument, options }) => {
  const current = snapshot(textDocument.uri);
  return current === undefined ? [] : formattingEdits(current, options);
});

connection.onShutdown(() => {
  cancelAllDiagnostics();
  syntaxStore?.dispose();
  syntaxStore = undefined;
  hoverContentKind = preferredMarkupKind();
});

connection.onExit(() => {
  cancelAllDiagnostics();
  syntaxStore?.dispose();
  syntaxStore = undefined;
  hoverContentKind = preferredMarkupKind();
});

documents.listen(connection);
connection.listen();

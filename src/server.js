#!/usr/bin/env node

import {
  createConnection,
  ErrorCodes,
  LSPErrorCodes,
  PositionEncodingKind,
  ResponseError,
  TextDocumentSyncKind,
  TextDocuments,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { diagnostics } from "./diagnostics.js";
import { formattingEdits } from "./formatting.js";
import {
  definitions,
  prepareRename,
  RenameError,
  references,
  rename,
} from "./labels.js";
import { regularExpressionModes, SyntaxStore } from "./syntax.js";

if (process.argv.length === 2) {
  process.argv.push("--stdio");
}

const connection = createConnection();
let syntaxStore;

function initializationMode(options) {
  if (options === undefined) {
    return "bre";
  }
  if (
    options === null ||
    typeof options !== "object" ||
    Array.isArray(options)
  ) {
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

function snapshot(uri) {
  return syntaxStore?.snapshot(uri);
}

function publishDiagnostics(uri) {
  const current = snapshot(uri);
  if (current === undefined) {
    return;
  }
  connection.sendDiagnostics({
    uri,
    version: current.document.version,
    diagnostics: diagnostics(current),
  });
}

const documents = new TextDocuments({
  create: TextDocument.create,
  update(document, changes, version) {
    return store().update(document.uri, changes, version).document;
  },
});

connection.onInitialize(async ({ initializationOptions }) => {
  const mode = initializationMode(initializationOptions);
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
      renameProvider: { prepareProvider: true },
      documentFormattingProvider: true,
    },
    serverInfo: {
      name: "sed-language-server",
    },
  };
});

documents.onDidOpen(({ document }) => {
  store().open(document);
});

documents.onDidChangeContent(({ document }) => {
  publishDiagnostics(document.uri);
});

documents.onDidClose(({ document }) => {
  syntaxStore?.close(document.uri);
  connection.sendDiagnostics({
    uri: document.uri,
    version: document.version,
    diagnostics: [],
  });
});

connection.onDefinition(({ textDocument, position }) => {
  const current = snapshot(textDocument.uri);
  if (current === undefined) {
    return null;
  }
  const locations = definitions(current, position);
  return locations.length === 0 ? null : locations;
});

connection.onReferences(({ textDocument, position, context }) => {
  const current = snapshot(textDocument.uri);
  if (current === undefined) {
    return null;
  }
  return references(current, position, context.includeDeclaration);
});

connection.onPrepareRename(({ textDocument, position }) => {
  const current = snapshot(textDocument.uri);
  if (current === undefined) {
    return null;
  }
  return prepareRename(current, position) ?? null;
});

connection.onRenameRequest(({ textDocument, position, newName }) => {
  const current = snapshot(textDocument.uri);
  if (current === undefined) {
    return null;
  }
  try {
    return rename(current, position, newName);
  } catch (error) {
    if (error instanceof RenameError) {
      throw new ResponseError(LSPErrorCodes.RequestFailed, error.message);
    }
    throw error;
  }
});

connection.onDocumentFormatting(({ textDocument, options }) => {
  const current = snapshot(textDocument.uri);
  return current === undefined ? [] : formattingEdits(current, options);
});

connection.onShutdown(() => {
  syntaxStore?.dispose();
  syntaxStore = undefined;
});

connection.onExit(() => {
  syntaxStore?.dispose();
  syntaxStore = undefined;
});

documents.listen(connection);
connection.listen();

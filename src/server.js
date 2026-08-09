#!/usr/bin/env node

import {
  createConnection,
  ErrorCodes,
  LSPErrorCodes,
  MarkupKind,
  PositionEncodingKind,
  ResponseError,
  TextDocumentSyncKind,
  TextDocuments,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { completionItems } from "./completion.js";
import { diagnostics } from "./diagnostics.js";
import { formattingEdits } from "./formatting.js";
import { hover } from "./hover.js";
import {
  definitions,
  prepareRename,
  RenameError,
  references,
  rename,
} from "./labels.js";
import { regularExpressionModes, SyntaxStore } from "./parser.js";

if (process.argv.length === 2) {
  process.argv.push("--stdio");
}

const connection = createConnection();
let syntaxStore;
let completionDocumentationKind = preferredMarkupKind();
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

connection.onInitialize(async ({ capabilities, initializationOptions }) => {
  const mode = initializationMode(initializationOptions);
  completionDocumentationKind = preferredMarkupKind(
    capabilities.textDocument?.completion?.completionItem?.documentationFormat,
  );
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
      completionProvider: {},
      definitionProvider: true,
      referencesProvider: true,
      hoverProvider: true,
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

connection.onCompletion(({ textDocument, position }) => {
  const current = snapshot(textDocument.uri);
  return current === undefined
    ? []
    : completionItems(current, position, completionDocumentationKind);
});

connection.onDefinition(({ textDocument, position }) => {
  const current = snapshot(textDocument.uri);
  if (current === undefined) {
    return null;
  }
  const locations = definitions(current, position);
  return locations.length === 0 ? null : locations;
});

connection.onHover(({ textDocument, position }) => {
  const current = snapshot(textDocument.uri);
  return current === undefined
    ? null
    : (hover(current, position, hoverContentKind) ?? null);
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
  completionDocumentationKind = preferredMarkupKind();
  hoverContentKind = preferredMarkupKind();
});

connection.onExit(() => {
  syntaxStore?.dispose();
  syntaxStore = undefined;
  completionDocumentationKind = preferredMarkupKind();
  hoverContentKind = preferredMarkupKind();
});

documents.listen(connection);
connection.listen();

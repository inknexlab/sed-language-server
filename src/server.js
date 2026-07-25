#!/usr/bin/env node

import {
  createConnection,
  ErrorCodes,
  ProposedFeatures,
  ResponseError,
  TextDocumentSyncKind,
  TextDocuments,
} from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { createDefinitionLocations } from "./definition.js";
import { createDiagnostics } from "./diagnostics.js";
import { createFormattingEdits } from "./formatting.js";
import { invalidateSyntaxTreeCache } from "./syntax.js";

if (process.argv.length === 2) {
  process.argv.push("--stdio");
}

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const defaultDialect = "posix";
let activeDialect = defaultDialect;

function resolveDialect(options) {
  if (options === undefined || options === null) {
    return { dialect: defaultDialect };
  }
  if (typeof options !== "object" || Array.isArray(options)) {
    return {
      error: "Syntax options must be provided as an object or null.",
    };
  }

  const dialect =
    options.dialect === undefined ? defaultDialect : options.dialect;
  if (dialect !== "posix" && dialect !== "gnu") {
    return {
      error: 'The syntax dialect must be either "posix" or "gnu".',
    };
  }

  return { dialect };
}

function publishDiagnostics(document) {
  return connection.sendDiagnostics({
    uri: document.uri,
    version: document.version,
    diagnostics: createDiagnostics(document, activeDialect),
  });
}

connection.onInitialize(({ initializationOptions }) => {
  const result = resolveDialect(initializationOptions);
  if (result.error !== undefined) {
    return new ResponseError(ErrorCodes.InvalidParams, result.error, {
      retry: false,
    });
  }

  activeDialect = result.dialect;
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      definitionProvider: true,
      documentFormattingProvider: true,
    },
  };
});

connection.onDefinition(({ textDocument, position }) => {
  const document = documents.get(textDocument.uri);
  return document === undefined
    ? null
    : createDefinitionLocations(document, position, activeDialect);
});

connection.onDocumentFormatting(({ textDocument, options }) => {
  const document = documents.get(textDocument.uri);
  return document === undefined
    ? []
    : createFormattingEdits(document, activeDialect, options);
});

documents.onDidChangeContent(({ document }) => {
  publishDiagnostics(document);
});

documents.onDidClose(({ document }) => {
  invalidateSyntaxTreeCache(document);
  connection.sendDiagnostics({ uri: document.uri, diagnostics: [] });
});

documents.listen(connection);
connection.listen();

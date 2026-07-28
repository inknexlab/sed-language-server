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
import { createReferenceLocations } from "./references.js";
import { createRenameWorkspaceEdit, prepareLabelRename } from "./rename.js";
import { invalidateSyntaxTreeCache } from "./syntax.js";

if (process.argv.length === 2) {
  process.argv.push("--stdio");
}

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);
const defaultSyntax = Object.freeze({
  dialect: "gnu",
  regex: "bre",
  parser: "sed",
});
let activeSyntax = defaultSyntax;

function resolveSyntax(options) {
  if (options === undefined || options === null) {
    return { syntax: defaultSyntax };
  }
  if (typeof options !== "object" || Array.isArray(options)) {
    return {
      error: "Syntax options must be provided as an object or null.",
    };
  }

  const dialect =
    options.dialect === undefined ? defaultSyntax.dialect : options.dialect;
  if (dialect !== "posix" && dialect !== "gnu") {
    return {
      error: 'The syntax dialect must be either "posix" or "gnu".',
    };
  }

  const regex =
    options.regex === undefined ? defaultSyntax.regex : options.regex;
  if (regex !== "bre" && regex !== "ere") {
    return {
      error: 'The regular expression mode must be either "bre" or "ere".',
    };
  }

  return {
    syntax: {
      dialect,
      parser:
        options.dialect === undefined && options.regex === undefined
          ? defaultSyntax.parser
          : `${dialect}-${regex}`,
      regex,
    },
  };
}

function publishDiagnostics(document) {
  return connection.sendDiagnostics({
    uri: document.uri,
    version: document.version,
    diagnostics: createDiagnostics(document, activeSyntax),
  });
}

connection.onInitialize(({ initializationOptions }) => {
  const result = resolveSyntax(initializationOptions);
  if (result.error !== undefined) {
    return new ResponseError(ErrorCodes.InvalidParams, result.error, {
      retry: false,
    });
  }

  activeSyntax = result.syntax;
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      definitionProvider: true,
      documentFormattingProvider: true,
      referencesProvider: true,
      renameProvider: {
        prepareProvider: true,
      },
    },
  };
});

connection.onDefinition(({ textDocument, position }) => {
  const document = documents.get(textDocument.uri);
  return document === undefined
    ? null
    : createDefinitionLocations(document, position, activeSyntax);
});

connection.onReferences(({ textDocument, position, context }) => {
  const document = documents.get(textDocument.uri);
  return document === undefined
    ? null
    : createReferenceLocations(document, position, activeSyntax, context);
});

connection.onPrepareRename(({ textDocument, position }) => {
  const document = documents.get(textDocument.uri);
  return document === undefined
    ? null
    : prepareLabelRename(document, position, activeSyntax);
});

connection.onRenameRequest(({ textDocument, position, newName }) => {
  const document = documents.get(textDocument.uri);
  return document === undefined
    ? null
    : createRenameWorkspaceEdit(document, position, activeSyntax, newName);
});

connection.onDocumentFormatting(({ textDocument, options }) => {
  const document = documents.get(textDocument.uri);
  return document === undefined
    ? []
    : createFormattingEdits(document, activeSyntax, options);
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

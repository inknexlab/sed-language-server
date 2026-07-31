import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TextDocument } from "vscode-languageserver-textdocument";
import { Language, Parser } from "web-tree-sitter";

const vendorDirectory = new URL("../vendor/", import.meta.url);
const manifest = JSON.parse(
  readFileSync(new URL("tree-sitter-sed.json", vendorDirectory), "utf8"),
);
const modes = Object.freeze(Object.keys(manifest.languages));
let parserInitialization;

function initializeParserRuntime() {
  parserInitialization ??= Parser.init();
  return parserInitialization;
}

function languageDefinition(mode) {
  const definition = manifest.languages[mode];
  if (definition === undefined) {
    throw new TypeError(`Unsupported regular expression mode: ${mode}`);
  }
  return definition;
}

function point({ character, line }) {
  return { row: line, column: character };
}

function endPosition(start, text) {
  const lines = text.split("\n");
  if (lines.length === 1) {
    return {
      line: start.line,
      character: start.character + text.length,
    };
  }
  return {
    line: start.line + lines.length - 1,
    character: lines.at(-1).length,
  };
}

function editForChange(document, change) {
  const oldText = document.getText();
  const start = change.range?.start ?? { line: 0, character: 0 };
  const oldEnd = change.range?.end ?? document.positionAt(oldText.length);
  const startIndex = document.offsetAt(start);
  const oldEndIndex = document.offsetAt(oldEnd);
  return {
    startIndex,
    oldEndIndex,
    newEndIndex: startIndex + change.text.length,
    startPosition: point(start),
    oldEndPosition: point(oldEnd),
    newEndPosition: point(endPosition(start, change.text)),
  };
}

function snapshotFor(state, mode) {
  return Object.freeze({
    document: state.document,
    mode,
    tree: state.tree,
  });
}

function copyDocument(document) {
  return TextDocument.create(
    document.uri,
    document.languageId,
    document.version,
    document.getText(),
  );
}

export function grammarManifest() {
  return manifest;
}

export function regularExpressionModes() {
  return modes;
}

export class SyntaxStore {
  static async create(mode) {
    const definition = languageDefinition(mode);
    await initializeParserRuntime();
    const wasmPath = fileURLToPath(new URL(definition.wasm, vendorDirectory));
    const language = await Language.load(wasmPath);
    if (language.name !== definition.language) {
      throw new Error(
        `Expected grammar ${definition.language}, loaded ${language.name ?? "an unnamed language"}.`,
      );
    }
    const parser = new Parser();
    parser.setLanguage(language);
    return new SyntaxStore(mode, parser);
  }

  #documents = new Map();
  #disposed = false;

  constructor(mode, parser) {
    this.mode = mode;
    this.parser = parser;
  }

  #assertAvailable() {
    if (this.#disposed) {
      throw new Error("The syntax store has been disposed.");
    }
  }

  #parse(source, oldTree) {
    const tree = this.parser.parse(source, oldTree);
    if (tree === null) {
      throw new Error(`Failed to parse POSIX sed ${this.mode.toUpperCase()}.`);
    }
    return tree;
  }

  #replace(uri, document, tree) {
    const previous = this.#documents.get(uri);
    this.#documents.set(uri, { document, tree });
    previous?.tree.delete();
    return snapshotFor({ document, tree }, this.mode);
  }

  open(document) {
    this.#assertAvailable();
    const ownedDocument = copyDocument(document);
    const tree = this.#parse(ownedDocument.getText());
    return this.#replace(document.uri, ownedDocument, tree);
  }

  update(uri, changes, version) {
    this.#assertAvailable();
    const state = this.#documents.get(uri);
    if (state === undefined) {
      throw new Error(`Cannot update unopened document: ${uri}`);
    }

    let nextDocument = copyDocument(state.document);
    const editedTree = state.tree.copy();
    try {
      for (const change of changes) {
        const edit = editForChange(nextDocument, change);
        nextDocument = TextDocument.update(nextDocument, [change], version);
        editedTree.edit(edit);
      }

      let nextTree;
      try {
        nextTree = this.#parse(nextDocument.getText(), editedTree);
      } catch {
        nextTree = this.#parse(nextDocument.getText());
      }
      return this.#replace(uri, nextDocument, nextTree);
    } finally {
      editedTree.delete();
    }
  }

  snapshot(uri, version) {
    this.#assertAvailable();
    const state = this.#documents.get(uri);
    if (
      state === undefined ||
      (version !== undefined && state.document.version !== version)
    ) {
      return undefined;
    }
    return snapshotFor(state, this.mode);
  }

  close(uri) {
    this.#assertAvailable();
    const state = this.#documents.get(uri);
    if (state !== undefined) {
      this.#documents.delete(uri);
      state.tree.delete();
    }
  }

  dispose() {
    if (this.#disposed) {
      return;
    }
    for (const { tree } of this.#documents.values()) {
      tree.delete();
    }
    this.#documents.clear();
    this.parser.delete();
    this.#disposed = true;
  }
}

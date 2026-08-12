import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Language, Parser } from "web-tree-sitter";

const vendorDirectory = new URL("../../vendor/", import.meta.url);
const manifest = deepFreeze(
  JSON.parse(
    readFileSync(
      new URL("tree-sitter-posix-sed.json", vendorDirectory),
      "utf8",
    ),
  ),
);
const modes = Object.freeze(Object.keys(manifest.languages));
const languagePromises = new Map();
const parsedTrees = new WeakMap();
let parserInitialization;

function deepFreeze(value) {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}

function initializeParserRuntime() {
  parserInitialization ??= Parser.init();
  return parserInitialization;
}

export function languageDefinition(mode) {
  if (typeof mode !== "string" || !Object.hasOwn(manifest.languages, mode)) {
    throw new TypeError(`Unsupported regular expression mode: ${mode}`);
  }
  return manifest.languages[mode];
}

async function loadLanguage(mode) {
  const definition = languageDefinition(mode);
  let pending = languagePromises.get(mode);
  if (pending === undefined) {
    pending = (async () => {
      await initializeParserRuntime();
      const wasmPath = fileURLToPath(new URL(definition.wasm, vendorDirectory));
      const language = await Language.load(wasmPath);
      if (language.name !== definition.language) {
        throw new Error(
          `Expected grammar ${definition.language}, loaded ${language.name ?? "an unnamed language"}.`,
        );
      }
      return language;
    })();
    languagePromises.set(mode, pending);
  }
  return pending;
}

export function grammarManifest() {
  return manifest;
}

export function regularExpressionModes() {
  return modes;
}

export function assertParsedTree(tree, mode, source) {
  const definition = languageDefinition(mode);
  if (tree?.language?.name !== definition.language) {
    throw new TypeError(
      `Expected a ${definition.language} syntax tree for ${mode}.`,
    );
  }
  const parsed = parsedTrees.get(tree);
  if (parsed?.mode !== mode || parsed.source !== source) {
    throw new TypeError("The sed source must match the syntax tree.");
  }
  if (tree.rootNode.hasChanges) {
    throw new TypeError("The edited sed syntax tree must be reparsed.");
  }
}

function pointAtOffset(source, offset) {
  const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
  let row = 0;
  for (let index = 0; index < lineStart; index += 1) {
    if (source[index] === "\n") {
      row += 1;
    }
  }
  return { row, column: offset - lineStart };
}

function advancePoint(start, text) {
  const lastLineStart = text.lastIndexOf("\n") + 1;
  if (lastLineStart === 0) {
    return { row: start.row, column: start.column + text.length };
  }
  let row = start.row;
  for (let index = 0; index < lastLineStart; index += 1) {
    if (text[index] === "\n") {
      row += 1;
    }
  }
  return { row, column: text.length - lastLineStart };
}

function applySourceEdit(source, edit, tree) {
  const { oldEndIndex, startIndex, text } = edit ?? {};
  if (
    !Number.isInteger(startIndex) ||
    !Number.isInteger(oldEndIndex) ||
    startIndex < 0 ||
    oldEndIndex < startIndex ||
    oldEndIndex > source.length ||
    typeof text !== "string"
  ) {
    throw new TypeError("Invalid incremental source edit.");
  }

  if (tree !== undefined) {
    const startPosition = pointAtOffset(source, startIndex);
    tree.edit({
      startIndex,
      oldEndIndex,
      newEndIndex: startIndex + text.length,
      startPosition,
      oldEndPosition: pointAtOffset(source, oldEndIndex),
      newEndPosition: advancePoint(startPosition, text),
    });
  }

  return `${source.slice(0, startIndex)}${text}${source.slice(oldEndIndex)}`;
}

function applySourceEdits(source, edits, tree) {
  let editedSource = source;
  for (const edit of edits) {
    editedSource = applySourceEdit(editedSource, edit, tree);
  }
  return editedSource;
}

function requiresCanonicalParse(tree) {
  return (
    tree.rootNode.hasError ||
    tree.rootNode.descendantsOfType("syntax_issue").length > 0
  );
}

export class SedParser {
  static async create(mode) {
    const language = await loadLanguage(mode);
    const parser = new Parser();
    try {
      parser.setLanguage(language);
      return new SedParser(mode, language.name, parser);
    } catch (error) {
      parser.delete();
      throw error;
    }
  }

  #deleted = false;
  #languageName;
  #mode;
  #parser;

  constructor(mode, languageName, parser) {
    this.#mode = mode;
    this.#languageName = languageName;
    this.#parser = parser;
  }

  #assertAvailableSource(source) {
    if (this.#deleted) {
      throw new Error("The parser has been deleted.");
    }
    if (typeof source !== "string") {
      throw new TypeError("The sed source must be a string.");
    }
  }

  #parseTree(source, oldTree) {
    const tree = this.#parser.parse(source, oldTree);
    if (tree === null) {
      throw new Error(`Failed to parse POSIX sed ${this.#mode.toUpperCase()}.`);
    }
    return tree;
  }

  #parse(source, oldTree) {
    let tree = this.#parseTree(source, oldTree);
    if (oldTree !== undefined && requiresCanonicalParse(tree)) {
      tree.delete();
      tree = this.#parseTree(source);
    }
    parsedTrees.set(tree, { mode: this.#mode, source });
    return tree;
  }

  parse(source, ...incrementalArguments) {
    this.#assertAvailableSource(source);
    if (incrementalArguments.length > 0) {
      throw new TypeError("Use reparse() for incremental source edits.");
    }
    return this.#parse(source);
  }

  reparse(source, oldTree, edits) {
    this.#assertAvailableSource(source);
    const parsed = parsedTrees.get(oldTree);
    if (
      oldTree?.language?.name !== this.#languageName ||
      parsed?.mode !== this.#mode
    ) {
      throw new TypeError(
        `Expected a parsed ${this.#languageName} syntax tree.`,
      );
    }
    if (oldTree.rootNode.hasChanges) {
      throw new TypeError("The incremental syntax tree must not be edited.");
    }
    if (!Array.isArray(edits)) {
      throw new TypeError("Incremental edits must be an array.");
    }

    if (requiresCanonicalParse(oldTree)) {
      const editedSource = applySourceEdits(parsed.source, edits);
      if (editedSource !== source) {
        throw new TypeError(
          "The incremental edits must produce the requested sed source.",
        );
      }
      return this.#parse(source);
    }

    const editedTree = oldTree.copy();
    try {
      const editedSource = applySourceEdits(parsed.source, edits, editedTree);
      if (editedSource !== source) {
        throw new TypeError(
          "The incremental edits must produce the requested sed source.",
        );
      }
      return this.#parse(source, editedTree);
    } finally {
      editedTree.delete();
    }
  }

  delete() {
    if (!this.#deleted) {
      this.#parser.delete();
      this.#deleted = true;
    }
  }
}

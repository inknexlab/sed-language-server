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

  parse(source, oldTree) {
    if (this.#deleted) {
      throw new Error("The parser has been deleted.");
    }
    if (typeof source !== "string") {
      throw new TypeError("The sed source must be a string.");
    }
    if (
      oldTree !== undefined &&
      oldTree !== null &&
      oldTree.language?.name !== this.#languageName
    ) {
      throw new TypeError(
        `Expected an incremental ${this.#languageName} syntax tree.`,
      );
    }
    const tree = this.#parser.parse(source, oldTree);
    if (tree === null) {
      throw new Error(`Failed to parse POSIX sed ${this.#mode.toUpperCase()}.`);
    }
    return tree;
  }

  delete() {
    if (!this.#deleted) {
      this.#parser.delete();
      this.#deleted = true;
    }
  }
}

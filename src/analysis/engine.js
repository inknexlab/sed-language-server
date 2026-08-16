import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Language, Parser } from "web-tree-sitter";
import { analyzeDiagnostics } from "./diagnostics.js";
import { analyzeFormatting } from "./formatting.js";

const constructionKey = Symbol("SedAnalysis");
const emptySemanticTokens = Object.freeze([]);

function abortError(message = "The sed analysis operation was aborted.") {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal) {
  if (!signal?.aborted) {
    return;
  }
  const { reason } = signal;
  if (reason instanceof Error && reason.name === "AbortError") {
    throw reason;
  }
  throw abortError();
}

function combinedSignal(signal, lifetimeSignal) {
  return signal === undefined
    ? lifetimeSignal
    : AbortSignal.any([signal, lifetimeSignal]);
}

// Yielding to the event loop between work units is what makes an in-flight
// analysis observe a cancellation at all.
async function analysisCheckpoint(signal) {
  await new Promise((resolve) => setImmediate(resolve));
  throwIfAborted(signal);
}

const vendorDirectory = new URL("../../vendor/", import.meta.url);
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

const manifest = deepFreeze(
  JSON.parse(
    readFileSync(
      new URL("tree-sitter-posix-sed.json", vendorDirectory),
      "utf8",
    ),
  ),
);

export function grammarManifest() {
  return manifest;
}

function languageDefinition(mode) {
  if (typeof mode !== "string" || !Object.hasOwn(manifest.languages, mode)) {
    throw new TypeError(`Unsupported regular expression mode: ${mode}`);
  }
  return manifest.languages[mode];
}

function initializeParser() {
  parserInitialization ??= Parser.init().catch((error) => {
    parserInitialization = undefined;
    throw error;
  });
  return parserInitialization;
}

// The runtime and each vendored grammar are loaded once and shared by every
// parser the process creates for that mode, but a failed load is not cached: a
// later attempt must be able to succeed.
async function loadLanguage(mode) {
  const definition = languageDefinition(mode);
  let pending = languagePromises.get(mode);
  if (pending === undefined) {
    pending = (async () => {
      await initializeParser();
      const wasmPath = fileURLToPath(new URL(definition.wasm, vendorDirectory));
      const language = await Language.load(wasmPath);
      if (language.name !== definition.language) {
        throw new Error(
          `Expected grammar ${definition.language}, loaded ${language.name ?? "an unnamed language"}.`,
        );
      }
      return language;
    })().catch((error) => {
      languagePromises.delete(mode);
      throw error;
    });
    languagePromises.set(mode, pending);
  }
  return pending;
}

const parsedTrees = new WeakMap();
const startPoint = Object.freeze({ column: 0, row: 0 });

function advancePoint(start, text, end = text.length) {
  let { column, row } = start;
  for (let index = 0; index < end; index += 1) {
    if (text.charCodeAt(index) === 0x0a) {
      row += 1;
      column = 0;
    } else {
      column += 1;
    }
  }
  return { column, row };
}

function pointAtOffset(source, offset) {
  return advancePoint(startPoint, source, offset);
}

function validateEdit(source, edit) {
  const { endOffset, startOffset, text } = edit ?? {};
  if (
    !Number.isInteger(startOffset) ||
    !Number.isInteger(endOffset) ||
    startOffset < 0 ||
    endOffset < startOffset ||
    endOffset > source.length ||
    typeof text !== "string"
  ) {
    throw new TypeError("Invalid incremental source edit.");
  }
  return { endOffset, startOffset, text };
}

// Each edit is measured against the source the previous edits produced, which is
// the coordinate system an already edited tree expects, and the end point is
// measured from the start point so no edit rescans the whole document.
function applyEdit(source, edit, tree) {
  const { endOffset, startOffset, text } = validateEdit(source, edit);
  if (tree !== undefined) {
    const startPosition = pointAtOffset(source, startOffset);
    tree.edit({
      startIndex: startOffset,
      oldEndIndex: endOffset,
      newEndIndex: startOffset + text.length,
      startPosition,
      oldEndPosition: advancePoint(
        startPosition,
        source.slice(startOffset, endOffset),
      ),
      newEndPosition: advancePoint(startPosition, text),
    });
  }
  return `${source.slice(0, startOffset)}${text}${source.slice(endOffset)}`;
}

function editedSource(source, edits, tree) {
  let result = source;
  for (const edit of edits) {
    result = applyEdit(result, edit, tree);
  }
  return result;
}

export class ParserEngine {
  static async create(mode) {
    const language = await loadLanguage(mode);
    const parser = new Parser();
    try {
      parser.setLanguage(language);
      return new ParserEngine(mode, language.name, parser);
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
      throw new Error("The sed analysis parser has been disposed.");
    }
    if (typeof source !== "string") {
      throw new TypeError("The sed source must be a string.");
    }
  }

  #parsedTree(tree, source) {
    if (this.#deleted) {
      throw new Error("The sed analysis parser has been disposed.");
    }
    const parsed = parsedTrees.get(tree);
    if (
      tree?.language?.name !== this.#languageName ||
      parsed?.mode !== this.#mode
    ) {
      throw new TypeError(
        `Expected a parsed ${this.#languageName} syntax tree.`,
      );
    }
    if (source !== undefined && parsed.source !== source) {
      throw new TypeError("The sed source must match the syntax tree.");
    }
    if (tree.rootNode.hasChanges) {
      throw new TypeError("The incremental syntax tree must not be edited.");
    }
    return parsed;
  }

  #parse(source, oldTree) {
    const tree = this.#parser.parse(source, oldTree);
    if (tree === null) {
      throw new Error(`Failed to parse POSIX sed ${this.#mode.toUpperCase()}.`);
    }
    parsedTrees.set(tree, {
      mode: this.#mode,
      // The same source must produce the same tree however it was reached, so
      // a tree is reused only where incremental parsing is known to agree.
      reusable: source.isWellFormed() && !tree.rootNode.hasError,
      source,
    });
    return tree;
  }

  parse(source) {
    this.#assertAvailableSource(source);
    return this.#parse(source);
  }

  reparse(source, oldTree, edits) {
    this.#assertAvailableSource(source);
    const parsed = this.#parsedTree(oldTree, source);
    if (!Array.isArray(edits)) {
      throw new TypeError("Incremental edits must be an array.");
    }
    if (edits.length === 0) {
      return { source, tree: undefined };
    }

    const editedTree = parsed.reusable ? oldTree.copy() : undefined;
    try {
      const nextSource = editedSource(source, edits, editedTree);
      if (nextSource === source) {
        return { source, tree: undefined };
      }
      const reuseTree = editedTree !== undefined && nextSource.isWellFormed();
      return {
        source: nextSource,
        tree: this.#parse(nextSource, reuseTree ? editedTree : undefined),
      };
    } finally {
      editedTree?.delete();
    }
  }

  delete() {
    if (!this.#deleted) {
      this.#parser.delete();
      this.#deleted = true;
    }
  }
}

// A snapshot core owns one parsed tree together with the source it was parsed
// from. Handles are the only thing that leaves this module: the tree is freed
// when the last handle of a core is disposed, or when the owner is disposed.

const handles = new WeakMap();

function assertOwnerAvailable(owner) {
  if (owner.state !== "active") {
    throw new Error("The sed analysis has been disposed.");
  }
}

function recordFor(snapshot) {
  const record = handles.get(snapshot);
  if (record === undefined || record.disposed || record.core.invalid) {
    throw new TypeError("Expected a live sed analysis snapshot.");
  }
  return record;
}

function releaseCore(core) {
  core.references -= 1;
  if (core.references === 0 && !core.invalid) {
    core.invalid = true;
    core.owner.cores.delete(core);
    core.tree.delete();
    core.tree = undefined;
  }
}

function handleFor(core) {
  assertOwnerAvailable(core.owner);
  if (core.invalid) {
    throw new TypeError("Expected a live sed analysis snapshot.");
  }
  core.references += 1;
  const snapshot = new SedSnapshot();
  handles.set(snapshot, { core, disposed: false });
  return Object.freeze(snapshot);
}

class SedSnapshot {
  get source() {
    return recordFor(this).core.source;
  }

  retain() {
    return handleFor(recordFor(this).core);
  }

  dispose() {
    const record = handles.get(this);
    if (record !== undefined && !record.disposed) {
      record.disposed = true;
      releaseCore(record.core);
    }
  }
}

function createSnapshotOwner(mode) {
  return { cores: new Set(), mode, state: "active" };
}

function createSnapshot(owner, source, tree) {
  assertOwnerAvailable(owner);
  const core = {
    cache: Object.create(null),
    invalid: false,
    mode: owner.mode,
    owner,
    references: 0,
    source,
    tree,
  };
  owner.cores.add(core);
  return handleFor(core);
}

// A lease keeps the core alive for the duration of one operation without
// exposing another handle to it.
function acquireSnapshot(owner, snapshot) {
  assertOwnerAvailable(owner);
  const { core } = recordFor(snapshot);
  if (core.owner !== owner) {
    throw new TypeError("The sed analysis snapshot belongs to another engine.");
  }
  core.references += 1;
  let released = false;
  return {
    core,
    release() {
      if (!released) {
        released = true;
        releaseCore(core);
      }
    },
  };
}

// New snapshots are refused as soon as disposal starts, while the operations
// already holding a lease keep their tree until they settle.
function beginSnapshotDisposal(owner) {
  if (owner.state === "active") {
    owner.state = "closing";
  }
}

function disposeSnapshots(owner) {
  if (owner.state === "disposed") {
    return;
  }
  owner.state = "disposed";
  for (const core of owner.cores) {
    core.invalid = true;
    core.tree.delete();
    core.tree = undefined;
  }
  owner.cores.clear();
}

function freezeDiagnostics(values) {
  return Object.freeze(values.map((value) => Object.freeze({ ...value })));
}

export class SedAnalysis {
  static async create(mode = "bre") {
    return new SedAnalysis(
      constructionKey,
      mode,
      await ParserEngine.create(mode),
    );
  }

  #disposePromise;
  #lifetime = new AbortController();
  #operations = new Set();
  #owner;
  #parser;

  constructor(key, mode, parser) {
    if (key !== constructionKey) {
      throw new TypeError("Use SedAnalysis.create() to create an analysis.");
    }
    this.#owner = createSnapshotOwner(mode);
    this.#parser = parser;
  }

  #assertAvailable() {
    assertOwnerAvailable(this.#owner);
  }

  #run(snapshot, signal, work) {
    this.#assertAvailable();
    const operationSignal = combinedSignal(signal, this.#lifetime.signal);
    const lease = acquireSnapshot(this.#owner, snapshot);
    const operation = { pending: undefined };
    this.#operations.add(operation);
    operation.pending = (async () => {
      try {
        await analysisCheckpoint(operationSignal);
        const value = await work(lease.core, () =>
          analysisCheckpoint(operationSignal),
        );
        throwIfAborted(operationSignal);
        return value;
      } finally {
        lease.release();
        this.#operations.delete(operation);
      }
    })();
    return operation.pending;
  }

  parse(source) {
    this.#assertAvailable();
    const tree = this.#parser.parse(source);
    try {
      return createSnapshot(this.#owner, source, tree);
    } catch (error) {
      tree.delete();
      throw error;
    }
  }

  reparse(snapshot, edits) {
    this.#assertAvailable();
    const lease = acquireSnapshot(this.#owner, snapshot);
    try {
      const parsed = this.#parser.reparse(
        lease.core.source,
        lease.core.tree,
        edits,
      );
      if (parsed.tree === undefined) {
        return snapshot.retain();
      }
      try {
        return createSnapshot(this.#owner, parsed.source, parsed.tree);
      } catch (error) {
        parsed.tree.delete();
        throw error;
      }
    } finally {
      lease.release();
    }
  }

  async diagnostics(snapshot, { signal } = {}) {
    return await this.#run(snapshot, signal, async (core, checkpoint) => {
      if (core.cache.diagnostics === undefined) {
        const values = freezeDiagnostics(
          await analyzeDiagnostics(core, { checkpoint }),
        );
        // Another operation may have cached this snapshot while analysis ran.
        core.cache.diagnostics ??= values;
      }
      return core.cache.diagnostics;
    });
  }

  async semanticTokens(snapshot, { signal } = {}) {
    return await this.#run(snapshot, signal, () => emptySemanticTokens);
  }

  async format(snapshot, options, { signal } = {}) {
    return await this.#run(snapshot, signal, (core, checkpoint) =>
      analyzeFormatting(core, options, { checkpoint }),
    );
  }

  dispose() {
    if (this.#disposePromise === undefined) {
      beginSnapshotDisposal(this.#owner);
      this.#lifetime.abort(abortError("The sed analysis has been disposed."));
      const operations = [...this.#operations].map(({ pending }) => pending);
      this.#disposePromise = (async () => {
        try {
          await Promise.allSettled(operations);
        } finally {
          disposeSnapshots(this.#owner);
          this.#parser.delete();
        }
      })();
    }
    return this.#disposePromise;
  }
}

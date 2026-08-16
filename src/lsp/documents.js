import { TextDocument } from "vscode-languageserver-textdocument";

export function rangeForOffsets(document, startOffset, endOffset) {
  return {
    end: document.positionAt(endOffset),
    start: document.positionAt(startOffset),
  };
}

export function fullDocumentRange(document) {
  return rangeForOffsets(document, 0, document.getText().length);
}

function isPosition(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Number.isInteger(value.line) &&
    value.line >= 0 &&
    Number.isInteger(value.character) &&
    value.character >= 0
  );
}

function editForChange(document, change) {
  if (
    change === null ||
    typeof change !== "object" ||
    Array.isArray(change) ||
    typeof change.text !== "string"
  ) {
    throw new TypeError("Invalid document change.");
  }
  const { range } = change;
  if (range === undefined) {
    return {
      endOffset: document.getText().length,
      startOffset: 0,
      text: change.text,
    };
  }
  if (
    range === null ||
    typeof range !== "object" ||
    Array.isArray(range) ||
    !isPosition(range.start) ||
    !isPosition(range.end)
  ) {
    throw new TypeError("Invalid document change range.");
  }
  // A well-typed range is not required to be well formed, so its two positions
  // are ordered before they become an edit: the same text the client applied is
  // what the document and its snapshot must both end up with.
  const first = document.offsetAt(range.start);
  const second = document.offsetAt(range.end);
  return {
    endOffset: Math.max(first, second),
    startOffset: Math.min(first, second),
    text: change.text,
  };
}

function copyDocument(document, version = document.version) {
  return TextDocument.create(
    document.uri,
    document.languageId,
    version,
    document.getText(),
  );
}

// Every change is expressed against the document the previous change produced,
// which is also the offset basis the analysis reparse expects.
function applyDocumentChange(document, change, version) {
  const edit = editForChange(document, change);
  const source = document.getText();
  return {
    document: TextDocument.create(
      document.uri,
      document.languageId,
      version,
      `${source.slice(0, edit.startOffset)}${edit.text}${source.slice(edit.endOffset)}`,
    ),
    edit,
  };
}

function documentState(document, snapshot) {
  return Object.freeze({ document, snapshot });
}

function snapshotLease(state) {
  const snapshot = state.snapshot.retain();
  let disposed = false;
  return Object.freeze({
    dispose() {
      if (!disposed) {
        disposed = true;
        snapshot.dispose();
      }
    },
    document: state.document,
    snapshot,
  });
}

// Pairs every open document with the snapshot parsed from its exact text.
export class DocumentStore {
  #analysis;
  #disposed = false;
  #documents = new Map();

  constructor(analysis) {
    this.#analysis = analysis;
  }

  #assertAvailable() {
    if (this.#disposed) {
      throw new Error("The document store has been disposed.");
    }
  }

  #replace(uri, state) {
    const previous = this.#documents.get(uri);
    this.#documents.set(uri, state);
    previous?.snapshot.dispose();
    return state.document;
  }

  open(document) {
    this.#assertAvailable();
    const owned = copyDocument(document);
    const snapshot = this.#analysis.parse(owned.getText());
    return this.#replace(document.uri, documentState(owned, snapshot));
  }

  update(uri, changes, version) {
    this.#assertAvailable();
    const state = this.#documents.get(uri);
    if (state === undefined) {
      throw new Error(`Cannot update unopened document: ${uri}`);
    }

    let next = copyDocument(state.document, version);
    const edits = [];
    for (const change of changes) {
      const applied = applyDocumentChange(next, change, version);
      next = applied.document;
      edits.push(applied.edit);
    }
    const snapshot = this.#analysis.reparse(state.snapshot, edits);
    return this.#replace(uri, documentState(next, snapshot));
  }

  current(uri) {
    this.#assertAvailable();
    return this.#documents.get(uri)?.document;
  }

  acquire(uri) {
    this.#assertAvailable();
    const state = this.#documents.get(uri);
    return state === undefined ? undefined : snapshotLease(state);
  }

  close(uri) {
    this.#assertAvailable();
    const state = this.#documents.get(uri);
    if (state !== undefined) {
      this.#documents.delete(uri);
      state.snapshot.dispose();
    }
  }

  dispose() {
    if (!this.#disposed) {
      this.#disposed = true;
      for (const { snapshot } of this.#documents.values()) {
        snapshot.dispose();
      }
      this.#documents.clear();
    }
  }
}

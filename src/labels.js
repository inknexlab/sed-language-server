import { labelSymbols, rangeForNode } from "./cst.js";

export class RenameError extends Error {
  constructor(message) {
    super(message);
    this.name = "RenameError";
  }
}

function symbolsFor(snapshot) {
  return labelSymbols(snapshot.document, snapshot.tree.rootNode);
}

function symbolAt(document, symbols, position) {
  const offset = document.offsetAt(position);
  return symbols.find(
    ({ node }) => node.startIndex <= offset && offset <= node.endIndex,
  );
}

function location(snapshot, symbol) {
  return {
    uri: snapshot.document.uri,
    range: rangeForNode(snapshot.document, symbol.node),
  };
}

function invalidRename(name) {
  if (name.length === 0) {
    return "A label cannot be empty.";
  }
  if (name.includes("\0") || name.includes("\r") || name.includes("\n")) {
    return "A label cannot contain NUL, carriage return, or newline.";
  }
  if (name.startsWith(" ") || name.startsWith("\t")) {
    return "A label cannot begin with a blank character.";
  }
  return undefined;
}

export function definitions(snapshot, position) {
  const symbols = symbolsFor(snapshot);
  const selected = symbolAt(snapshot.document, symbols, position);
  if (selected === undefined) {
    return [];
  }
  return symbols
    .filter(({ kind, name }) => kind === "definition" && name === selected.name)
    .map((symbol) => location(snapshot, symbol));
}

export function references(snapshot, position, includeDeclaration) {
  const symbols = symbolsFor(snapshot);
  const selected = symbolAt(snapshot.document, symbols, position);
  if (selected === undefined) {
    return [];
  }
  return symbols
    .filter(
      ({ kind, name }) =>
        name === selected.name && (kind === "reference" || includeDeclaration),
    )
    .map((symbol) => location(snapshot, symbol));
}

export function prepareRename(snapshot, position) {
  const symbols = symbolsFor(snapshot);
  const selected = symbolAt(snapshot.document, symbols, position);
  if (selected === undefined) {
    return undefined;
  }
  return {
    range: rangeForNode(snapshot.document, selected.node),
    placeholder: selected.name,
  };
}

export function rename(snapshot, position, newName) {
  const symbols = symbolsFor(snapshot);
  const selected = symbolAt(snapshot.document, symbols, position);
  if (selected === undefined) {
    throw new RenameError("The position is not on a sed label.");
  }
  const invalid = invalidRename(newName);
  if (invalid !== undefined) {
    throw new RenameError(invalid);
  }
  if (
    newName !== selected.name &&
    symbols.some(({ kind, name }) => kind === "definition" && name === newName)
  ) {
    throw new RenameError(`Label '${newName}' is already defined.`);
  }
  return {
    changes: {
      [snapshot.document.uri]: symbols
        .filter(({ name }) => name === selected.name)
        .map((symbol) => ({
          range: rangeForNode(snapshot.document, symbol.node),
          newText: newName,
        })),
    },
  };
}

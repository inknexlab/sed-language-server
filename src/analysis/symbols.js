import { labelSymbols, rangeForNode as offsetRangeForNode } from "./cst.js";
import { assertSnapshot } from "./snapshot.js";

function symbolsFor(snapshot) {
  return labelSymbols(snapshot.source, snapshot.tree.rootNode);
}

function symbolAt(symbols, offset) {
  return symbols.find(
    ({ node }) => node.startIndex <= offset && offset <= node.endIndex,
  );
}

function assertOffset(snapshot, offset) {
  if (!Number.isInteger(offset)) {
    throw new TypeError("The sed symbol offset must be an integer.");
  }
  if (offset < 0 || offset > snapshot.source.length) {
    throw new RangeError("The sed symbol offset is outside the source.");
  }
}

export function definitions(snapshot, offset) {
  assertSnapshot(snapshot);
  assertOffset(snapshot, offset);
  const symbols = symbolsFor(snapshot);
  const selected = symbolAt(symbols, offset);
  if (selected === undefined) {
    return [];
  }
  return symbols
    .filter(({ kind, name }) => kind === "definition" && name === selected.name)
    .map(({ node }) => offsetRangeForNode(node));
}

export function references(snapshot, offset, includeDeclaration) {
  assertSnapshot(snapshot);
  assertOffset(snapshot, offset);
  if (typeof includeDeclaration !== "boolean") {
    throw new TypeError("includeDeclaration must be a boolean.");
  }
  const symbols = symbolsFor(snapshot);
  const selected = symbolAt(symbols, offset);
  if (selected === undefined) {
    return [];
  }
  return symbols
    .filter(
      ({ kind, name }) =>
        name === selected.name && (kind === "reference" || includeDeclaration),
    )
    .map(({ node }) => offsetRangeForNode(node));
}

import { labelSymbols, rangeForNode } from "./cst.js";

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

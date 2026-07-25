import { rangeForNode, syntaxTreeFor } from "./syntax.js";

function labelReferenceAt(rootNode, offset) {
  let node = rootNode.namedDescendantForIndex(offset);
  while (node !== null) {
    if (
      node.type === "label_reference" &&
      node.startIndex <= offset &&
      offset < node.endIndex
    ) {
      return node;
    }
    node = node.parent;
  }
  return undefined;
}

export function createDefinitionLocations(document, position, syntax) {
  const rootNode = syntaxTreeFor(document, syntax).rootNode;
  const offset = document.offsetAt(position);
  const reference =
    labelReferenceAt(rootNode, offset) ??
    (offset === 0 ? undefined : labelReferenceAt(rootNode, offset - 1));

  if (reference === undefined) {
    return null;
  }

  const locations = rootNode
    .descendantsOfType("label_definition")
    .filter((definition) => definition.text === reference.text)
    .map((definition) => ({
      uri: document.uri,
      range: rangeForNode(document, definition),
    }));

  return locations.length === 0 ? null : locations;
}

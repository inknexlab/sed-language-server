import { syntaxTreeFor } from "./syntax.js";

const labelNodeTypes = ["label_definition", "label_reference"];

function labelAt(rootNode, offset) {
  let node = rootNode.namedDescendantForIndex(offset);
  while (node !== null) {
    if (
      labelNodeTypes.includes(node.type) &&
      node.startIndex <= offset &&
      offset < node.endIndex
    ) {
      return node;
    }
    node = node.parent;
  }
  return undefined;
}

export function labelAtPosition(document, position, syntax) {
  const rootNode = syntaxTreeFor(document, syntax).rootNode;
  const offset = document.offsetAt(position);
  const node =
    labelAt(rootNode, offset) ??
    (offset === 0 ? undefined : labelAt(rootNode, offset - 1));

  if (node === undefined) {
    return undefined;
  }

  return {
    node,
    rootNode,
  };
}

export function matchingLabels(rootNode, label, types = labelNodeTypes) {
  return rootNode
    .descendantsOfType(types)
    .filter((node) => node.text === label.text);
}

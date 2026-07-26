import { labelAtPosition, matchingLabels } from "./labels.js";
import { rangeForNode } from "./syntax.js";

export function createReferenceLocations(
  document,
  position,
  syntax,
  { includeDeclaration },
) {
  const label = labelAtPosition(document, position, syntax);
  if (label === undefined) {
    return null;
  }

  const matches = includeDeclaration
    ? matchingLabels(label.rootNode, label.node)
    : matchingLabels(label.rootNode, label.node, "label_reference");

  return matches.map((node) => ({
    uri: document.uri,
    range: rangeForNode(document, node),
  }));
}

import { labelAtPosition, matchingLabels } from "./labels.js";
import { rangeForNode } from "./syntax.js";

export function createDefinitionLocations(document, position, syntax) {
  const label = labelAtPosition(document, position, syntax);

  if (label === undefined || label.node.type !== "label_reference") {
    return null;
  }

  const locations = matchingLabels(
    label.rootNode,
    label.node,
    "label_definition",
  ).map((node) => ({
    uri: document.uri,
    range: rangeForNode(document, node),
  }));

  return locations.length === 0 ? null : locations;
}

import { ErrorCodes, ResponseError } from "vscode-languageserver/node";
import { labelAtPosition, matchingLabels } from "./labels.js";
import { rangeForNode } from "./syntax.js";

function validateLabelName(name, syntax) {
  const startsWithBlank = name.startsWith(" ") || name.startsWith("\t");
  const endsWithBlank = name.endsWith(" ") || name.endsWith("\t");
  if (
    name === "" ||
    name.includes("\0") ||
    name.includes("\r") ||
    name.includes("\n") ||
    startsWithBlank ||
    (syntax.dialect === "gnu" &&
      (endsWithBlank ||
        name.includes(";") ||
        name.includes("#") ||
        name.includes("}")))
  ) {
    throw new ResponseError(
      ErrorCodes.InvalidParams,
      `The new name is not a valid ${syntax.dialect} sed label.`,
    );
  }
}

export function prepareLabelRename(document, position, syntax) {
  const label = labelAtPosition(document, position, syntax);
  return label === undefined ? null : rangeForNode(document, label.node);
}

export function createRenameWorkspaceEdit(document, position, syntax, newName) {
  const label = labelAtPosition(document, position, syntax);
  if (label === undefined) {
    return null;
  }

  validateLabelName(newName, syntax);
  if (
    newName !== label.node.text &&
    label.rootNode
      .descendantsOfType("label_definition")
      .some((node) => node.text === newName)
  ) {
    throw new ResponseError(
      ErrorCodes.InvalidParams,
      "The new sed label name is already defined in this document.",
    );
  }

  return {
    changes: {
      [document.uri]: matchingLabels(label.rootNode, label.node).map(
        (node) => ({
          range: rangeForNode(document, node),
          newText: newName,
        }),
      ),
    },
  };
}

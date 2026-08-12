import assert from "node:assert/strict";
import { TextDocument } from "vscode-languageserver-textdocument";

let documentNumber = 0;

export function documentFor(source, version = 1) {
  documentNumber += 1;
  return TextDocument.create(
    `file:///test-${documentNumber}.sed`,
    "sed",
    version,
    source,
  );
}

export function serializeNode(node) {
  return {
    type: node.type,
    named: node.isNamed,
    missing: node.isMissing,
    startIndex: node.startIndex,
    endIndex: node.endIndex,
    startPosition: node.startPosition,
    endPosition: node.endPosition,
    children: Array.from({ length: node.childCount }, (_, index) => {
      const child = node.child(index);
      assert.notEqual(child, null);
      return {
        field: node.fieldNameForChild(index),
        node: serializeNode(child),
      };
    }),
  };
}

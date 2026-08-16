import assert from "node:assert/strict";
import { SedAnalysis } from "@inknexlab/sed-language-server/analysis";

export async function withSnapshot(mode, source, run) {
  const analysis = await SedAnalysis.create(mode);
  const snapshot = analysis.parse(source);
  try {
    return await run(analysis, snapshot);
  } finally {
    snapshot.dispose();
    await analysis.dispose();
  }
}

export function serializeNode(node) {
  return {
    children: Array.from({ length: node.childCount }, (_, index) => {
      const child = node.child(index);
      assert.notEqual(child, null);
      return {
        field: node.fieldNameForChild(index),
        node: serializeNode(child),
      };
    }),
    endIndex: node.endIndex,
    endPosition: node.endPosition,
    missing: node.isMissing,
    named: node.isNamed,
    startIndex: node.startIndex,
    startPosition: node.startPosition,
    type: node.type,
  };
}

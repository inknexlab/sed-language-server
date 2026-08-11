import assert from "node:assert/strict";
import test from "node:test";
import {
  diagnostics,
  regularExpressionModes,
  SedParser,
} from "@inknexlab/sed-language-server/analysis";

test("exposes sed analysis through the package subpath", async () => {
  assert.deepEqual(regularExpressionModes(), ["bre", "ere"]);

  const source = "p\n";
  const parser = await SedParser.create("bre");
  const tree = parser.parse(source);
  try {
    assert.deepEqual(diagnostics({ mode: "bre", source, tree }), []);
  } finally {
    tree.delete();
    parser.delete();
  }
});

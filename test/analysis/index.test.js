import assert from "node:assert/strict";
import test from "node:test";
import * as analysis from "@inknexlab/sed-language-server/analysis";

test("exports exactly the public analysis interface", () => {
  assert.deepEqual(Object.keys(analysis), ["SedAnalysis"]);
});

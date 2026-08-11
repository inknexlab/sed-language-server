import assert from "node:assert/strict";
import test from "node:test";
import { SedParser } from "../../src/analysis/parser.js";
import { assertSnapshot } from "../../src/analysis/snapshot.js";

test("validates snapshot structure, grammar, and parser ownership", async () => {
  const parser = await SedParser.create("bre");
  const tree = parser.parse("p\n");
  try {
    assert.throws(() => assertSnapshot(null), {
      name: "TypeError",
      message: "The sed syntax snapshot must be an object.",
    });
    assert.throws(() => assertSnapshot({ mode: "bre", source: null, tree }), {
      name: "TypeError",
      message: "The sed source must be a string.",
    });
    assert.throws(() => assertSnapshot({ mode: "ere", source: "p\n", tree }), {
      name: "TypeError",
      message: "Expected a posix_sed_ere syntax tree for ere.",
    });
    assert.throws(
      () => assertSnapshot({ mode: "toString", source: "p\n", tree }),
      {
        name: "TypeError",
        message: "Unsupported regular expression mode: toString",
      },
    );
    for (const source of ["q\n", ""]) {
      assert.throws(() => assertSnapshot({ mode: "bre", source, tree }), {
        name: "TypeError",
        message: "The sed source must match the syntax tree.",
      });
    }
  } finally {
    tree.delete();
    parser.delete();
  }
});

test("accepts recovery trees and rejects edited trees", async () => {
  const parser = await SedParser.create("bre");
  const source = " }";
  const tree = parser.parse(source);
  try {
    assert.doesNotThrow(() => assertSnapshot({ mode: "bre", source, tree }));

    tree.edit({
      startIndex: 0,
      oldEndIndex: 0,
      newEndIndex: 1,
      startPosition: { row: 0, column: 0 },
      oldEndPosition: { row: 0, column: 0 },
      newEndPosition: { row: 0, column: 1 },
    });
    assert.throws(() => assertSnapshot({ mode: "bre", source, tree }), {
      name: "TypeError",
      message: "The edited sed syntax tree must be reparsed.",
    });
  } finally {
    tree.delete();
    parser.delete();
  }
});

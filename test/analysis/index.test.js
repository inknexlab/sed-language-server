import assert from "node:assert/strict";
import test from "node:test";
import {
  completions,
  definitions,
  diagnostics,
  format,
  hover,
  references,
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
    assert.deepEqual(hover({ mode: "bre", source, tree }, 0), {
      startOffset: 0,
      endOffset: 1,
      documentation: {
        display: "p",
        title: "Print",
        synopsis: "[address[,address]]p",
        description: "Writes the pattern space to standard output.",
      },
    });
    assert.equal(format({ mode: "bre", source, tree }, {}), undefined);
    assert.deepEqual(definitions({ mode: "bre", source, tree }, 0), []);
    assert.deepEqual(references({ mode: "bre", source, tree }, 0, false), []);

    const emptySource = "";
    const emptyTree = parser.parse(emptySource);
    try {
      assert.equal(
        completions({ mode: "bre", source: emptySource, tree: emptyTree }, 0)
          .length,
        26,
      );
    } finally {
      emptyTree.delete();
    }
  } finally {
    tree.delete();
    parser.delete();
  }
});

test("accepts a parser-owned tree whose recovery root starts after source layout", async () => {
  const source = " }";
  const parser = await SedParser.create("bre");
  const tree = parser.parse(source);
  const snapshot = { mode: "bre", source, tree };
  try {
    assert.deepEqual(completions(snapshot, 0), []);
    assert.deepEqual(
      diagnostics(snapshot).map(({ code }) => code),
      ["unmatched-closing-brace"],
    );
    assert.equal(format(snapshot, {}), undefined);
    assert.equal(hover(snapshot, 0), undefined);
    assert.deepEqual(definitions(snapshot, 0), []);
    assert.deepEqual(references(snapshot, 0, true), []);
  } finally {
    tree.delete();
    parser.delete();
  }
});

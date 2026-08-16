import assert from "node:assert/strict";
import test from "node:test";
import {
  cstIndex,
  descendants,
  functionForCommand,
  rangeForNode,
  textForIndices,
  textForNode,
} from "../../src/analysis/cst.js";
import { ParserEngine } from "../../src/analysis/engine.js";

async function withTree(mode, source, callback) {
  const parser = await ParserEngine.create(mode);
  const tree = parser.parse(source);
  try {
    return await callback(source, tree.rootNode);
  } finally {
    tree.delete();
    parser.delete();
  }
}

test("projects POSIX editing functions and labels in source order", async () => {
  await withTree(
    "bre",
    ":start\n1,2{\nb start\nt end\n}\n:end\n",
    async (source, root) => {
      assert.deepEqual(
        descendants(root, "editing_command").map(
          (command) => functionForCommand(command)?.type,
        ),
        [
          "label_function",
          "block_function",
          "branch_function",
          "test_function",
          "label_function",
        ],
      );
      const symbols = (await cstIndex(source, root)).symbols;
      assert.deepEqual(
        symbols.map(({ kind, name }) => [kind, name]),
        [
          ["definition", "start"],
          ["reference", "start"],
          ["reference", "end"],
          ["definition", "end"],
        ],
      );
      assert.deepEqual(
        symbols.map(({ node }) => textForNode(source, node)),
        ["start", "start", "end", "end"],
      );
      assert.deepEqual(rangeForNode(symbols[0].node), {
        startOffset: 1,
        endOffset: 6,
      });
    },
  );
});

test("preserves carriage returns in source-backed label names", async () => {
  await withTree("bre", ":same\r\n:same\n", async (source, root) => {
    assert.equal(textForIndices(source, 1, 6), "same\r");
    assert.deepEqual(
      (await cstIndex(source, root)).symbols.map(({ name }) => name),
      ["same\r", "same"],
    );
  });
});

test("extracts every structured outcome without interpreting it", async () => {
  const cases = [
    [
      "bre",
      "/a\\?/p\n",
      "implementation_defined_syntax",
      "bre_question_mark_escape",
    ],
    [
      "bre",
      "rfile\n",
      "implementation_option_syntax",
      "omitted_file_separator",
    ],
    ["bre", "r", "incomplete_syntax", "missing_rfile"],
    ["bre", "1,2q\n", "nonconforming_syntax", "excess_addresses"],
    ["ere", ",p\n", "undefined_syntax", "omitted_address"],
    ["ere", "1! p\n", "unspecified_syntax", "blanks_after_negation"],
  ];
  for (const [mode, source, outcome, reason] of cases) {
    await withTree(mode, source, async (_source, root) => {
      assert.deepEqual(
        (await cstIndex(undefined, root)).structuredIssues.map((issue) => [
          issue.outcome,
          issue.reason,
        ]),
        [[outcome, reason]],
      );
    });
  }
});

test("keeps native errors separate from structured issues", async () => {
  await withTree("bre", "},\0", async (_source, root) => {
    const index = await cstIndex(undefined, root);
    assert.ok(
      index.nativeIssues.some(({ kind }) => kind === "error"),
      root.toString(),
    );
    assert.ok(index.structuredIssues.length > 0, root.toString());
  });
});

test("rejects a structured issue without its required outcome", async () => {
  const issue = {
    type: "syntax_issue",
    namedChildCount: 0,
    namedChild: () => null,
    children: [],
  };
  const root = { type: "script", children: [issue] };
  await assert.rejects(cstIndex(undefined, root), {
    message: "syntax_issue must have exactly one named child.",
  });
});

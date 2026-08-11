import assert from "node:assert/strict";
import test from "node:test";
import {
  descendants,
  functionForCommand,
  labelSymbols,
  nativeIssues,
  rangeForNode,
  structuredIssues,
  textForIndices,
  textForNode,
} from "../../src/analysis/cst.js";
import { withAnalysisSnapshot } from "./helpers.js";

async function withTree(mode, source, callback) {
  return withAnalysisSnapshot(mode, source, ({ tree }) =>
    callback(source, tree.rootNode),
  );
}

test("projects POSIX editing functions and labels in source order", async () => {
  await withTree(
    "bre",
    ":start\n1,2{\nb start\nt end\n}\n:end\n",
    (source, root) => {
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
      const symbols = labelSymbols(source, root);
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
  await withTree("bre", ":same\r\n:same\n", (source, root) => {
    assert.equal(textForIndices(source, 1, 6), "same\r");
    assert.deepEqual(
      labelSymbols(source, root).map(({ name }) => name),
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
    await withTree(mode, source, (_source, root) => {
      assert.deepEqual(
        structuredIssues(root).map((issue) => [issue.outcome, issue.reason]),
        [[outcome, reason]],
      );
    });
  }
});

test("keeps native errors and missing nodes separate from structured issues", async () => {
  await withTree("bre", "},\0", (_source, root) => {
    const native = nativeIssues(root);
    assert.ok(
      native.some(({ kind }) => kind === "error"),
      root.toString(),
    );
    assert.ok(
      native.some(({ kind }) => kind === "missing"),
      root.toString(),
    );
    assert.ok(structuredIssues(root).length > 0, root.toString());
  });
});

test("rejects a structured issue without its required outcome", () => {
  const issue = {
    type: "syntax_issue",
    namedChildCount: 0,
    namedChild: () => null,
    children: [],
  };
  const root = { type: "script", children: [issue] };
  assert.throws(() => structuredIssues(root), {
    message: "syntax_issue must have exactly one named child.",
  });
});

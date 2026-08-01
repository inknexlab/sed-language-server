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
} from "../src/cst.js";
import { SyntaxStore } from "../src/syntax.js";
import { documentFor } from "./support.js";

async function withTree(mode, source, callback) {
  const store = await SyntaxStore.create(mode);
  try {
    const document = documentFor(source);
    const { tree } = store.open(document);
    return callback(document, tree.rootNode);
  } finally {
    store.dispose();
  }
}

test("projects POSIX editing functions and labels in source order", async () => {
  await withTree(
    "bre",
    ":start\n1,2{\nb start\nt end\n}\n:end\n",
    (document, root) => {
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
      const symbols = labelSymbols(document, root);
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
        symbols.map(({ node }) => textForNode(document, node)),
        ["start", "start", "end", "end"],
      );
      assert.deepEqual(rangeForNode(document, symbols[0].node), {
        start: { line: 0, character: 1 },
        end: { line: 0, character: 6 },
      });
    },
  );
});

test("preserves carriage returns in source-backed label names", async () => {
  await withTree("bre", ":same\r\n:same\n", (document, root) => {
    assert.equal(textForIndices(document, 1, 6), "same\r");
    assert.deepEqual(
      labelSymbols(document, root).map(({ name }) => name),
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
    ["bre", "r\n", "incomplete_syntax", "missing_rfile"],
    ["bre", "1,2q\n", "nonconforming_syntax", "excess_addresses"],
    ["ere", ",p\n", "undefined_syntax", "omitted_address"],
    ["ere", "1! p\n", "unspecified_syntax", "blanks_after_negation"],
  ];
  for (const [mode, source, outcome, reason] of cases) {
    await withTree(mode, source, (_document, root) => {
      assert.deepEqual(
        structuredIssues(root).map((issue) => [issue.outcome, issue.reason]),
        [[outcome, reason]],
      );
    });
  }
});

test("keeps native errors and missing nodes separate from structured issues", async () => {
  await withTree("bre", "1!/\0", (_document, root) => {
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

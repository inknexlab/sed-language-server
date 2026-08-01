import assert from "node:assert/strict";
import test from "node:test";
import { TextDocument } from "vscode-languageserver-textdocument";
import { SyntaxStore } from "../src/syntax.js";
import { documentFor, serializeNode } from "./support.js";

function changeForOffsets(document, startIndex, endIndex, text) {
  return {
    range: {
      start: document.positionAt(startIndex),
      end: document.positionAt(endIndex),
    },
    text,
  };
}

function replacementChange(document, search, text) {
  const source = document.getText();
  const startIndex = source.indexOf(search);
  assert.notEqual(startIndex, -1, `missing edit target: ${search}`);
  return changeForOffsets(
    document,
    startIndex,
    startIndex + search.length,
    text,
  );
}

function changedCharacterChanges(document, before, after) {
  assert.equal(before.length, after.length);
  const source = document.getText();
  const startIndex = source.indexOf(before);
  assert.notEqual(startIndex, -1, `missing edit target: ${before}`);

  const changes = [];
  for (let index = 0; index < before.length; index += 1) {
    if (before[index] !== after[index]) {
      changes.push(
        changeForOffsets(
          document,
          startIndex + index,
          startIndex + index + 1,
          after[index],
        ),
      );
    }
  }
  return changes;
}

async function assertIncrementalMatchesFull({ mode, source, changes, verify }) {
  const incrementalStore = await SyntaxStore.create(mode);
  const fullStore = await SyntaxStore.create(mode);
  try {
    const document = documentFor(source);
    const actualChanges =
      typeof changes === "function" ? changes(document) : changes;
    incrementalStore.open(document);
    const updated = incrementalStore.update(document.uri, actualChanges, 2);
    const fullDocument = TextDocument.update(
      documentFor(source),
      actualChanges,
      2,
    );
    const full = fullStore.open(fullDocument);
    assert.equal(updated.document.getText(), fullDocument.getText());
    assert.deepEqual(
      serializeNode(incrementalStore.snapshot(document.uri, 2).tree.rootNode),
      serializeNode(full.tree.rootNode),
    );
    verify?.(updated);
  } finally {
    incrementalStore.dispose();
    fullStore.dispose();
  }
}

test("applies sequential LSP changes incrementally in both modes", async () => {
  for (const mode of ["bre", "ere"]) {
    await assertIncrementalMatchesFull({
      mode,
      source: "s/a/b/g\np\n",
      changes: [
        {
          range: {
            start: { line: 0, character: 2 },
            end: { line: 0, character: 3 },
          },
          text: "[ab]",
        },
        {
          range: {
            start: { line: 1, character: 0 },
            end: { line: 1, character: 1 },
          },
          text: "1,2d",
        },
      ],
    });
  }
});

test("incremental parsing preserves Unicode and scanner state", async () => {
  for (const mode of ["bre", "ere"]) {
    await assertIncrementalMatchesFull({
      mode,
      source: ":😀\ns|a\\|b|c|\nb 😀\n",
      changes: [
        {
          range: {
            start: { line: 1, character: 2 },
            end: { line: 1, character: 6 },
          },
          text: "[a|]",
        },
        {
          range: {
            start: { line: 2, character: 2 },
            end: { line: 2, character: 4 },
          },
          text: "終",
        },
      ],
    });
  }
});

test("delimiter edits restore every external-scanner mode", async () => {
  const cases = [
    {
      mode: "bre",
      source: "s|ab|cd|g\n",
      before: "s|ab|cd|",
      after: "s#ab#cd#",
    },
    {
      mode: "bre",
      source: "s#\\|#x#\n",
      before: "s#\\|#x#",
      after: "s|\\||x|",
    },
    {
      mode: "bre",
      source: "\\|ab|p\n",
      before: "\\|ab|",
      after: "\\#ab#",
    },
    {
      mode: "bre",
      source: "y|ab|cd|\n",
      before: "y|ab|cd|",
      after: "y#ab#cd#",
    },
    {
      mode: "ere",
      source: "s|a+?|cd|g\n",
      before: "s|a+?|cd|",
      after: "s#a+?#cd#",
    },
    {
      mode: "ere",
      source: "\\|a+?|p\n",
      before: "\\|a+?|",
      after: "\\#a+?#",
    },
    {
      mode: "ere",
      source: "y|ab|cd|\n",
      before: "y|ab|cd|",
      after: "y#ab#cd#",
    },
  ];

  for (const { mode, source, before, after } of cases) {
    await assertIncrementalMatchesFull({
      mode,
      source,
      changes: (document) => changedCharacterChanges(document, before, after),
      verify: ({ tree }) => {
        assert.equal(tree.rootNode.hasError, false, source);
      },
    });
  }
});

test("edits from recovery to canonical syntax match full parses", async () => {
  const cases = [
    ["bre", "s/a/b\np\n", "b\n", "b/\n"],
    ["ere", "s/a/b\np\n", "b\n", "b/\n"],
    ["bre", "s|a|b\np\n", "b\n", "b|\n"],
    ["ere", "/(ab/p\n", "ab/", "ab)/"],
    ["ere", "/a{2/p\n", "2/", "2}/"],
    ["ere", "/[a-[:alpha:]]/p\n", "[:alpha:]", "[.z.]"],
    ["bre", "1, 2p\n", ", ", ","],
    ["bre", "1,2,3p\n", ",3", ""],
    ["bre", "b;p\n", "b", "p"],
    ["bre", "{ }\np\n", " ", ";"],
    ["bre", "a\\\ntext\\\n", "text\\\n", "text\n"],
  ];

  for (const [mode, source, search, replacement] of cases) {
    await assertIncrementalMatchesFull({
      mode,
      source,
      changes: (document) => [replacementChange(document, search, replacement)],
      verify: ({ tree }) => {
        assert.equal(tree.rootNode.hasError, false, source);
        assert.equal(
          tree.rootNode.descendantsOfType("syntax_issue").length,
          0,
          source,
        );
      },
    });
  }
});

test("script-leading #n suppression follows incremental edits", async () => {
  for (const mode of ["bre", "ere"]) {
    const incrementalStore = await SyntaxStore.create(mode);
    const fullStore = await SyntaxStore.create(mode);
    try {
      let document = documentFor("#x\n");
      incrementalStore.open(document);
      fullStore.open(document);
      const stages = [
        {
          change: (current) => replacementChange(current, "x", "n"),
          expected: 1,
        },
        {
          change: (current) => changeForOffsets(current, 0, 0, " "),
          expected: 0,
        },
        {
          change: (current) => replacementChange(current, " ", ""),
          expected: 1,
        },
        {
          change: (current) => replacementChange(current, "n", "x"),
          expected: 0,
        },
      ];

      let version = document.version;
      for (const { change: makeChange, expected } of stages) {
        const change = makeChange(document);
        version += 1;
        document = TextDocument.update(document, [change], version);
        const incremental = incrementalStore.update(
          document.uri,
          [change],
          version,
        );
        const full = fullStore.open(document);

        assert.deepEqual(
          serializeNode(incremental.tree.rootNode),
          serializeNode(full.tree.rootNode),
        );
        assert.equal(
          incremental.tree.rootNode.descendantsOfType(
            "default_output_suppression",
          ).length,
          expected,
          `${mode}: ${JSON.stringify(document.getText())}`,
        );
      }
    } finally {
      incrementalStore.dispose();
      fullStore.dispose();
    }
  }
});

test("multiline operand edits match full parses", async () => {
  const cases = [
    ["a\\\nhello\\\nworld\np\n", "hello", "greeting"],
    ["s|a|first\\\nsecond|\np\n", "first", "updated"],
    ["y|ab|cd|\np\n", "ab", "a\\n"],
  ];

  for (const [source, search, replacement] of cases) {
    await assertIncrementalMatchesFull({
      mode: "bre",
      source,
      changes: (document) => [replacementChange(document, search, replacement)],
    });
  }
});

test("substitution flag edits preserve ordered flag nodes", async () => {
  await assertIncrementalMatchesFull({
    mode: "bre",
    source: "s/a/b/giw output\n",
    changes: (document) => [replacementChange(document, "gi", "gip")],
    verify: ({ tree }) => {
      assert.equal(tree.rootNode.hasError, false);
      assert.equal(tree.rootNode.descendantsOfType("syntax_issue").length, 0);
      assert.deepEqual(
        tree.rootNode
          .descendantsOfType("substitution_flags")[0]
          ?.namedChildren.map(({ type }) => type),
        ["global_flag", "case_insensitive_flag", "print_flag", "write_flag"],
      );
    },
  });
});

test("regular-expression state edits match full parses", async () => {
  const cases = [
    ["bre", "/\\(a\\)/p\n", "\\)", ""],
    ["ere", "/[[.].]]/p\n", "]", "a"],
    ["ere", "/[.a.]/p\n", "a.", "a:"],
    ["ere", "/a*b/p\n", "*", "*?"],
    ["ere", "/a*?/p\n", "*?", "*+"],
    ["ere", "/a*{2}/p\n", "{2}", "+??"],
    ["bre", "/a*\\{2\\}/p\n", "*", "b"],
    ["bre", "/a\\{255\\}/p\n", "255", "999999999999999999999999"],
    ["bre", "/^a/p\n", "a", "^"],
    ["ere", "/[[.a.]]/p\n", "a", "ch"],
    ["bre", "/[%--]/p\n", "-]", "@]"],
  ];

  for (const [mode, source, search, replacement] of cases) {
    await assertIncrementalMatchesFull({
      mode,
      source,
      changes: (document) => [replacementChange(document, search, replacement)],
    });
  }
});

test("incremental character ranges use UTF-16 indices", async () => {
  await assertIncrementalMatchesFull({
    mode: "bre",
    source: "/cat/p\n",
    changes: (document) => [replacementChange(document, "cat", "😺犬")],
    verify: ({ tree }) => {
      assert.deepEqual(
        tree.rootNode
          .descendantsOfType("ordinary_character")
          .map((node) => [node.text, node.startIndex, node.endIndex]),
        [
          ["😺", 1, 3],
          ["犬", 3, 4],
        ],
      );
    },
  });
});

test("supports full-document replacement and versioned snapshots", async () => {
  const store = await SyntaxStore.create("bre");
  try {
    const document = documentFor("p\n", 4);
    store.open(document);
    const updated = store.update(document.uri, [{ text: "1,2d\n" }], 5);
    assert.equal(updated.document.getText(), "1,2d\n");
    assert.equal(store.snapshot(document.uri, 4), undefined);
    assert.equal(store.snapshot(document.uri, 5)?.document, updated.document);
    store.close(document.uri);
    assert.equal(store.snapshot(document.uri), undefined);
  } finally {
    store.dispose();
  }
});

test("keeps the previous snapshot when an update cannot be applied", async () => {
  const store = await SyntaxStore.create("bre");
  try {
    const document = documentFor("p\n", 4);
    const snapshot = store.open(document);
    assert.throws(() => store.update(document.uri, undefined, 5), TypeError);
    const retained = store.snapshot(document.uri, 4);
    assert.equal(retained?.document, snapshot.document);
    assert.equal(retained?.tree, snapshot.tree);
  } finally {
    store.dispose();
  }
});

test("rejects unsupported modes and use after disposal", async () => {
  await assert.rejects(
    SyntaxStore.create("other"),
    /Unsupported regular expression mode/,
  );
  const store = await SyntaxStore.create("bre");
  store.dispose();
  assert.throws(() => store.snapshot("file:///closed.sed"), /disposed/);
});

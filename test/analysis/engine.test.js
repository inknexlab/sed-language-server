import assert from "node:assert/strict";
import test from "node:test";
import { SedAnalysis } from "@inknexlab/sed-language-server/analysis";
import { grammarManifest, ParserEngine } from "../../src/analysis/engine.js";
import { serializeNode } from "./support.js";

const modes = ["bre", "ere"];

function sourceEdit(startOffset, endOffset, text) {
  return { endOffset, startOffset, text };
}

function replacementEdit(source, search, text) {
  const startOffset = source.indexOf(search);
  assert.notEqual(startOffset, -1, `missing edit target: ${search}`);
  return sourceEdit(startOffset, startOffset + search.length, text);
}

function replacementEdits(source, replacements) {
  const edits = [];
  let current = source;
  for (const [search, text] of replacements) {
    const edit = replacementEdit(current, search, text);
    edits.push(edit);
    current = `${current.slice(0, edit.startOffset)}${text}${current.slice(edit.endOffset)}`;
  }
  return edits;
}

function changedCharacterEdits(source, before, after) {
  assert.equal(before.length, after.length);
  const startOffset = source.indexOf(before);
  assert.notEqual(startOffset, -1, `missing edit target: ${before}`);
  const edits = [];
  for (let index = 0; index < before.length; index += 1) {
    if (before[index] !== after[index]) {
      edits.push(
        sourceEdit(startOffset + index, startOffset + index + 1, after[index]),
      );
    }
  }
  return edits;
}

async function assertIncrementalMatchesFull({ edits, mode, source, verify }) {
  const parser = await ParserEngine.create(mode);
  const previous = parser.parse(source);
  let incremental;
  let full;
  try {
    const actualEdits = typeof edits === "function" ? edits(source) : edits;
    const parsed = parser.reparse(source, previous, actualEdits);
    incremental = parsed.tree;
    full = parser.parse(parsed.source);
    assert.deepEqual(
      serializeNode(incremental.rootNode),
      serializeNode(full.rootNode),
    );
    await verify?.({ source: parsed.source, tree: incremental });
  } finally {
    previous.delete();
    incremental?.delete();
    full?.delete();
    parser.delete();
  }
}

test("loads the BRE and ERE grammars independently", async () => {
  assert.equal(Object.isFrozen(grammarManifest()), true);
  assert.equal(Object.isFrozen(grammarManifest().languages), true);

  const [bre, ere] = await Promise.all([
    ParserEngine.create("bre"),
    ParserEngine.create("ere"),
  ]);
  const breTree = bre.parse("s/a\\+/x/\n");
  const ereTree = ere.parse("s/a+/x/\n");
  try {
    assert.equal(breTree.language.name, "posix_sed_bre");
    assert.equal(ereTree.language.name, "posix_sed_ere");
    assert.equal(breTree.rootNode.descendantsOfType("basic_reg_exp").length, 1);
    assert.equal(
      ereTree.rootNode.descendantsOfType("extended_reg_exp").length,
      1,
    );
  } finally {
    breTree.delete();
    ereTree.delete();
    bre.delete();
    ere.delete();
  }
});

test("validates modes, source values, and parser lifetime", async () => {
  for (const mode of ["other", "toString", "constructor", "__proto__"]) {
    await assert.rejects(ParserEngine.create(mode), {
      message: `Unsupported regular expression mode: ${mode}`,
      name: "TypeError",
    });
  }
  const parser = await ParserEngine.create("bre");
  assert.throws(() => parser.parse(null), {
    message: "The sed source must be a string.",
    name: "TypeError",
  });
  parser.delete();
  parser.delete();
  assert.throws(() => parser.parse("p\n"), /disposed/);
});

test("keeps full parses independent of prior syntax trees", async () => {
  const parser = await ParserEngine.create("bre");
  const previous = parser.parse("1,2p\n");
  const actual = parser.parse("1,2q\n");
  try {
    assert.equal(actual.rootNode.descendantsOfType("quit_function").length, 1);
    assert.equal(actual.rootNode.descendantsOfType("print_function").length, 0);
    assert.equal(
      actual.rootNode.descendantsOfType("excess_addresses").length,
      1,
    );
    assert.equal(
      previous.rootNode.descendantsOfType("print_function").length,
      1,
    );
  } finally {
    previous.delete();
    actual.delete();
    parser.delete();
  }
});

test("validates incremental tree ownership and edit shape", async () => {
  const [bre, ere] = await Promise.all([
    ParserEngine.create("bre"),
    ParserEngine.create("ere"),
  ]);
  const breTree = bre.parse("1,2p\n");
  const ereTree = ere.parse("p\n");
  let reparsed;
  try {
    assert.throws(
      () => bre.reparse("p\n", ereTree, [sourceEdit(0, 1, "q")]),
      /posix_sed_bre/,
    );
    assert.throws(
      () => bre.reparse("1,2p\n", breTree, [sourceEdit(-1, 0, "")]),
      /Invalid incremental source edit/,
    );
    assert.throws(
      () => bre.reparse("1,2p\n", breTree, [sourceEdit(3, 99, "q")]),
      /Invalid incremental source edit/,
    );

    const parsed = bre.reparse("1,2p\n", breTree, [sourceEdit(3, 4, "q")]);
    reparsed = parsed.tree;
    assert.equal(parsed.source, "1,2q\n");
    assert.equal(
      reparsed.rootNode.descendantsOfType("quit_function").length,
      1,
    );
    assert.equal(breTree.rootNode.hasChanges, false);
    assert.equal(
      breTree.rootNode.descendantsOfType("print_function").length,
      1,
    );
  } finally {
    reparsed?.delete();
    breTree.delete();
    ereTree.delete();
    bre.delete();
    ere.delete();
  }
});

test("matches full parses across canonical and recovery transitions", async () => {
  const cases = [
    ["p\n", "q\n", false, false],
    ["p\n", "}}{};}{}", false, true],
    ["}}{};}{}", "x}}{};}{}", false, true],
    ["p\n", "s/", false, true],
  ];
  for (const [previousSource, source, expectedError, expectedIssue] of cases) {
    await assertIncrementalMatchesFull({
      edits: [sourceEdit(0, previousSource.length, source)],
      mode: "bre",
      source: previousSource,
      verify: ({ tree }) => {
        assert.equal(tree.rootNode.hasError, expectedError, source);
        assert.equal(
          tree.rootNode.descendantsOfType("syntax_issue").length > 0,
          expectedIssue,
          source,
        );
      },
    });
  }
});

test("fully reparses edits from a tree containing native recovery", async () => {
  await assertIncrementalMatchesFull({
    edits: [sourceEdit(2, 2, "(")],
    mode: "bre",
    source: "p\0/;",
    verify: ({ source, tree }) => {
      assert.equal(source, "p\0(/;");
      assert.equal(tree.rootNode.hasError, true);
    },
  });
});

test("does not parse an edit sequence that leaves the source unchanged", async () => {
  const parser = await ParserEngine.create("bre");
  const previous = parser.parse("p\0(/;");
  try {
    const parsed = parser.reparse("p\0(/;", previous, [sourceEdit(0, 0, "")]);
    assert.equal(parsed.source, "p\0(/;");
    assert.equal(parsed.tree, undefined);
  } finally {
    previous.delete();
    parser.delete();
  }
});

test("falls back to a full parse after an edit splits a surrogate pair", async () => {
  await assertIncrementalMatchesFull({
    edits: [sourceEdit(8, 9, "b:")],
    mode: "bre",
    source: "s😀p😀d😀!n2D",
    verify: ({ source, tree }) => {
      assert.equal(source, "s😀p😀d\ud83db:!n2D");
      assert.equal(tree.rootNode.hasError, false);
      assert.ok(tree.rootNode.descendantsOfType("syntax_issue").length > 0);
    },
  });
});

test("applies sequential edits in both modes", async () => {
  for (const mode of modes) {
    await assertIncrementalMatchesFull({
      edits: [sourceEdit(2, 3, "[ab]"), sourceEdit(10, 11, "1,2d")],
      mode,
      source: "s/a/b/\np\n",
    });
  }
});

test("uses CRLF-aware coordinates for sequential edits", async () => {
  for (const mode of modes) {
    await assertIncrementalMatchesFull({
      edits: [sourceEdit(1, 1, "\r"), sourceEdit(0, 3, "")],
      mode,
      source: "p\nq\n",
      verify: ({ source }) => assert.equal(source, "q\n"),
    });
  }
});

test("applies an offset-zero edit to source beginning with LF", async () => {
  for (const mode of modes) {
    await assertIncrementalMatchesFull({
      edits: [sourceEdit(0, 0, "q\n")],
      mode,
      source: "\np\n",
    });
  }
});

test("incremental parsing preserves Unicode and scanner state", async () => {
  for (const mode of modes) {
    await assertIncrementalMatchesFull({
      edits: (source) =>
        replacementEdits(source, [
          ["a\\|b", "[a|]"],
          ["b 😀", "b 終"],
        ]),
      mode,
      source: ":😀\ns|a\\|b|c|\nb 😀\n",
    });
  }
});

test("delimiter edits restore every external-scanner mode", async () => {
  const cases = [
    ["bre", "s|ab|cd|g\n", "s|ab|cd|", "s#ab#cd#"],
    ["bre", "s#\\|#x#\n", "s#\\|#x#", "s|\\||x|"],
    ["bre", "\\|ab|p\n", "\\|ab|", "\\#ab#"],
    ["bre", "y|ab|cd|\n", "y|ab|cd|", "y#ab#cd#"],
    ["ere", "s|a+?|cd|g\n", "s|a+?|cd|", "s#a+?#cd#"],
    ["ere", "\\|a+?|p\n", "\\|a+?|", "\\#a+?#"],
    ["ere", "y|ab|cd|\n", "y|ab|cd|", "y#ab#cd#"],
  ];
  for (const [mode, source, before, after] of cases) {
    await assertIncrementalMatchesFull({
      edits: () => changedCharacterEdits(source, before, after),
      mode,
      source,
      verify: ({ tree }) => assert.equal(tree.rootNode.hasError, false, source),
    });
  }
});

test("edits distinct recovery shapes into canonical syntax", async () => {
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
      edits: () => [replacementEdit(source, search, replacement)],
      mode,
      source,
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

test("recovery CSTs converge from distinct edit histories", async () => {
  const cases = [
    ["/[", sourceEdit(2, 2, "a")],
    ["/[b", sourceEdit(2, 3, "a")],
    ["1!x\np\n", sourceEdit(2, 3, "/")],
    ["1!$\np\n", sourceEdit(2, 3, "/")],
    ["}}{};}{}", sourceEdit(0, 0, "x")],
  ];
  for (const [source, edit] of cases) {
    await assertIncrementalMatchesFull({
      edits: [edit],
      mode: "bre",
      source,
      verify: ({ tree }) => {
        assert.equal(tree.rootNode.hasError, false, source);
        assert.ok(
          tree.rootNode.descendantsOfType("syntax_issue").length > 0,
          source,
        );
      },
    });
  }
});

test("script-leading #n suppression follows incremental edits", async () => {
  for (const mode of modes) {
    const parser = await ParserEngine.create(mode);
    let source = "#x\n";
    let tree = parser.parse(source);
    try {
      const stages = [
        ["x", "n", 1],
        ["#", " #", 0],
        [" ", "", 1],
        ["n", "x", 0],
      ];
      for (const [search, replacement, expected] of stages) {
        const parsed = parser.reparse(source, tree, [
          replacementEdit(source, search, replacement),
        ]);
        const full = parser.parse(parsed.source);
        try {
          assert.deepEqual(
            serializeNode(parsed.tree.rootNode),
            serializeNode(full.rootNode),
          );
          assert.equal(
            parsed.tree.rootNode.descendantsOfType("default_output_suppression")
              .length,
            expected,
            `${mode}: ${JSON.stringify(parsed.source)}`,
          );
        } catch (error) {
          parsed.tree.delete();
          throw error;
        } finally {
          full.delete();
        }
        tree.delete();
        source = parsed.source;
        tree = parsed.tree;
      }
    } finally {
      tree.delete();
      parser.delete();
    }
  }
});

test("multiline operand edits match full parses", async () => {
  for (const [source, search, replacement] of [
    ["a\\\nhello\\\nworld\np\n", "hello", "greeting"],
    ["s|a|first\\\nsecond|\np\n", "first", "updated"],
    ["y|ab|cd|\np\n", "ab", "a\\n"],
  ]) {
    await assertIncrementalMatchesFull({
      edits: [replacementEdit(source, search, replacement)],
      mode: "bre",
      source,
    });
  }
});

test("substitution flag edits preserve ordered flag nodes", async () => {
  const source = "s/a/b/giw output\n";
  await assertIncrementalMatchesFull({
    edits: [replacementEdit(source, "gi", "gip")],
    mode: "bre",
    source,
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
      edits: [replacementEdit(source, search, replacement)],
      mode,
      source,
    });
  }
});

test("incremental character ranges use UTF-16 offsets", async () => {
  const source = "/cat/p\n";
  await assertIncrementalMatchesFull({
    edits: [replacementEdit(source, "cat", "😺犬")],
    mode: "bre",
    source,
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

test("composes edits at UTF-16 code point boundaries", async () => {
  for (const [source, search, replacement] of [
    ["/😀/p\n", "😀", "😺"],
    ["/𐀀/p\n", "𐀀", "𐐀"],
  ]) {
    await assertIncrementalMatchesFull({
      edits: [replacementEdit(source, search, replacement)],
      mode: "bre",
      source,
    });
  }
});

test("applies many exact edits without rebuilding source history", {
  timeout: 3000,
}, async () => {
  const parser = await ParserEngine.create("bre");
  const previous = parser.parse("");
  const count = 10_000;
  const edits = Array.from({ length: count }, (_, index) =>
    sourceEdit(index, index, "p"),
  );
  const parsed = parser.reparse("", previous, edits);
  try {
    assert.equal(parsed.source, "p".repeat(count));
    assert.equal(parsed.tree.rootNode.endIndex, count);
  } finally {
    previous.delete();
    parsed.tree.delete();
    parser.delete();
  }
});

test("creates opaque retained snapshots with deterministic disposal", async () => {
  assert.throws(() => new SedAnalysis(), /SedAnalysis\.create/);
  const analysis = await SedAnalysis.create();
  const snapshot = analysis.parse("p\n");
  const retained = snapshot.retain();
  assert.equal(snapshot.source, "p\n");
  assert.equal(snapshot.mode, undefined);
  assert.equal(snapshot.tree, undefined);
  assert.deepEqual(Object.keys(snapshot), []);

  snapshot.dispose();
  snapshot.dispose();
  assert.equal(retained.source, "p\n");
  assert.deepEqual(await analysis.diagnostics(retained), []);
  retained.dispose();
  retained.dispose();
  assert.throws(() => retained.source, /live sed analysis snapshot/);

  const disposal = analysis.dispose();
  assert.equal(analysis.dispose(), disposal);
  await disposal;
  assert.throws(() => analysis.parse("q\n"), /disposed/);
});

test("creates independent BRE and ERE analysis instances", async () => {
  const [bre, ere] = await Promise.all([
    SedAnalysis.create("bre"),
    SedAnalysis.create("ere"),
  ]);
  const breSnapshot = bre.parse("s/a\\+/x/\n");
  const ereSnapshot = ere.parse("s/a+/x/\n");
  try {
    assert.equal(breSnapshot.source, "s/a\\+/x/\n");
    assert.equal(ereSnapshot.source, "s/a+/x/\n");
    assert.deepEqual(await ere.diagnostics(ereSnapshot), []);
    await assert.rejects(bre.diagnostics(ereSnapshot), /another engine/);
    await assert.rejects(bre.semanticTokens(ereSnapshot), /another engine/);
  } finally {
    breSnapshot.dispose();
    ereSnapshot.dispose();
    await Promise.all([bre.dispose(), ere.dispose()]);
  }
});

test("returns one shared immutable empty Semantic Tokens list", async () => {
  const analysis = await SedAnalysis.create("bre");
  const first = analysis.parse("p\n");
  const second = analysis.parse("q\n");
  try {
    const pending = analysis.semanticTokens(first);
    first.dispose();
    const firstResult = await pending;
    const secondResult = await analysis.semanticTokens(second);
    assert.strictEqual(firstResult, secondResult);
    assert.deepEqual(firstResult, []);
    assert.equal(Object.isFrozen(firstResult), true);
    assert.throws(() => firstResult.push({}), TypeError);
  } finally {
    first.dispose();
    second.dispose();
    await analysis.dispose();
  }
});

test("validates modes and source values", async () => {
  for (const mode of ["other", "toString", "constructor", "__proto__"]) {
    await assert.rejects(SedAnalysis.create(mode), {
      message: `Unsupported regular expression mode: ${mode}`,
      name: "TypeError",
    });
  }
  const analysis = await SedAnalysis.create("bre");
  try {
    assert.throws(() => analysis.parse(null), {
      message: "The sed source must be a string.",
      name: "TypeError",
    });
  } finally {
    await analysis.dispose();
  }
});

test("reparses sequential UTF-16 edits without changing the old snapshot", async () => {
  const analysis = await SedAnalysis.create("bre");
  const original = analysis.parse("s/a/b/\np\n");
  const updated = analysis.reparse(original, [
    { endOffset: 3, startOffset: 2, text: "[ab]" },
    { endOffset: 11, startOffset: 10, text: "1,2d" },
  ]);
  const unchanged = analysis.reparse(updated, []);
  try {
    assert.equal(original.source, "s/a/b/\np\n");
    assert.equal(updated.source, "s/[ab]/b/\n1,2d\n");
    assert.equal(unchanged.source, updated.source);
    assert.notEqual(unchanged, updated);
    assert.deepEqual(await analysis.diagnostics(updated), []);
  } finally {
    unchanged.dispose();
    updated.dispose();
    original.dispose();
    await analysis.dispose();
  }
});

test("keeps native recovery diagnostics independent of edit history", async () => {
  const analysis = await SedAnalysis.create("bre");
  const original = analysis.parse("p\0/;");
  const updated = analysis.reparse(original, [
    { endOffset: 2, startOffset: 2, text: "(" },
  ]);
  const full = analysis.parse(updated.source);
  try {
    const codes = async (snapshot) =>
      (await analysis.diagnostics(snapshot)).map(({ code }) => code);
    assert.deepEqual(await codes(updated), await codes(full));
    assert.ok((await codes(updated)).includes("unknown-function"));
  } finally {
    full.dispose();
    updated.dispose();
    original.dispose();
    await analysis.dispose();
  }
});

test("rejects foreign snapshots and invalid edits without consuming state", async () => {
  const first = await SedAnalysis.create("bre");
  const second = await SedAnalysis.create("bre");
  const snapshot = first.parse("p\n");
  try {
    assert.throws(() => second.reparse(snapshot, []), /another engine/);
    assert.throws(() => first.reparse(snapshot), /array/);
    assert.throws(
      () =>
        first.reparse(snapshot, [
          { endOffset: 99, startOffset: 0, text: "bad" },
        ]),
      /Invalid incremental source edit/,
    );
    assert.equal(snapshot.source, "p\n");
    assert.deepEqual(await first.diagnostics(snapshot), []);
  } finally {
    snapshot.dispose();
    await Promise.all([first.dispose(), second.dispose()]);
  }
});

test("retains a snapshot for an asynchronous operation", async () => {
  const analysis = await SedAnalysis.create("bre");
  const source = "r\n".repeat(600);
  const snapshot = analysis.parse(source);
  const pending = analysis.diagnostics(snapshot);
  snapshot.dispose();
  assert.equal((await pending).length, 600);
  await analysis.dispose();
});

test("propagates request cancellation as an AbortError", async () => {
  const analysis = await SedAnalysis.create("bre");
  const snapshot = analysis.parse("p;p\n");
  const controller = new AbortController();
  controller.abort();
  try {
    await assert.rejects(
      analysis.diagnostics(snapshot, { signal: controller.signal }),
      { name: "AbortError" },
    );
    await assert.rejects(
      analysis.format(snapshot, {}, { signal: controller.signal }),
      { name: "AbortError" },
    );
    await assert.rejects(
      analysis.semanticTokens(snapshot, { signal: controller.signal }),
      { name: "AbortError" },
    );
  } finally {
    snapshot.dispose();
    await analysis.dispose();
  }
});

test("disposal aborts and waits for active analysis", async () => {
  const analysis = await SedAnalysis.create("bre");
  const snapshot = analysis.parse("r\n".repeat(20_000));
  const pending = analysis.diagnostics(snapshot);
  const disposal = analysis.dispose();
  await assert.rejects(pending, { name: "AbortError" });
  await disposal;
  snapshot.dispose();
});

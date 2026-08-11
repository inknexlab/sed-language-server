import assert from "node:assert/strict";
import test from "node:test";
import {
  grammarManifest,
  regularExpressionModes,
  SedParser,
} from "../../src/analysis/parser.js";

test("loads the pinned BRE and ERE grammars independently", async () => {
  assert.deepEqual(regularExpressionModes(), ["bre", "ere"]);
  assert.equal(Object.isFrozen(grammarManifest()), true);
  assert.equal(
    grammarManifest().revision,
    "5a1270d54337c909a8fca6b0dda396d579da79b1",
  );
  assert.equal(Object.isFrozen(grammarManifest().languages), true);

  const [bre, ere] = await Promise.all([
    SedParser.create("bre"),
    SedParser.create("ere"),
  ]);
  const breTree = bre.parse("s/a\\+/x/\n");
  const ereTree = ere.parse("s/a+/x/\n");
  try {
    assert.equal(breTree.language.name, "posix_sed_bre");
    assert.equal(ereTree.language.name, "posix_sed_ere");
    assert.equal(
      breTree.rootNode.descendantsOfType("basic_reg_exp").length > 0,
      true,
    );
    assert.equal(
      ereTree.rootNode.descendantsOfType("extended_reg_exp").length > 0,
      true,
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
    await assert.rejects(SedParser.create(mode), {
      name: "TypeError",
      message: `Unsupported regular expression mode: ${mode}`,
    });
  }
  const parser = await SedParser.create("bre");
  assert.throws(() => parser.parse(null), {
    name: "TypeError",
    message: "The sed source must be a string.",
  });
  parser.delete();
  parser.delete();
  assert.throws(() => parser.parse("p\n"), {
    message: "The parser has been deleted.",
  });
});

test("keeps full parses independent of prior syntax trees", async () => {
  const parser = await SedParser.create("bre");
  const previous = parser.parse("1,2p\n");
  assert.throws(() => parser.parse("1,2q\n", previous), {
    name: "TypeError",
    message: "Use reparse() for incremental source edits.",
  });
  const actual = parser.parse("1,2q\n");
  try {
    assert.equal(actual.rootNode.descendantsOfType("quit_function").length, 1);
    assert.equal(actual.rootNode.descendantsOfType("print_function").length, 0);
    assert.equal(
      actual.rootNode.descendantsOfType("excess_addresses").length,
      1,
    );
  } finally {
    previous.delete();
    actual.delete();
    parser.delete();
  }
});

test("validates incremental tree ownership and source edits", async () => {
  const [bre, ere] = await Promise.all([
    SedParser.create("bre"),
    SedParser.create("ere"),
  ]);
  const breTree = bre.parse("1,2p\n");
  const ereTree = ere.parse("p\n");
  try {
    assert.throws(() => bre.reparse("p\n", ereTree, []), {
      name: "TypeError",
      message: "Expected a parsed posix_sed_bre syntax tree.",
    });
    assert.throws(() => bre.reparse("1,2q\n", breTree, []), {
      name: "TypeError",
      message: "The incremental edits must produce the requested sed source.",
    });

    const reparsed = bre.reparse("1,2q\n", breTree, [
      { startIndex: 3, oldEndIndex: 4, text: "q" },
    ]);
    try {
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
      reparsed.delete();
    }
  } finally {
    breTree.delete();
    ereTree.delete();
    bre.delete();
    ere.delete();
  }
});

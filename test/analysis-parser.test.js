import assert from "node:assert/strict";
import test from "node:test";
import { regularExpressionModes, SedParser } from "../src/analysis/index.js";
import { grammarManifest } from "../src/analysis/parser.js";

test("loads the pinned BRE and ERE grammars independently", async () => {
  assert.deepEqual(regularExpressionModes(), ["bre", "ere"]);
  assert.equal(Object.isFrozen(grammarManifest()), true);
  assert.equal(
    grammarManifest().revision,
    "38b635ec26e6fd403e250b2932706cac15f36311",
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

test("rejects an incremental tree owned by the other grammar", async () => {
  const [bre, ere] = await Promise.all([
    SedParser.create("bre"),
    SedParser.create("ere"),
  ]);
  const ereTree = ere.parse("p\n");
  try {
    assert.throws(() => bre.parse("p\n", ereTree), {
      name: "TypeError",
      message: "Expected an incremental posix_sed_bre syntax tree.",
    });
  } finally {
    ereTree.delete();
    bre.delete();
    ere.delete();
  }
});

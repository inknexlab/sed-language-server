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
    "77dbaf6ccc12c360b75d9f3077ccb474d0cdaaf9",
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
  const recoveryTree = bre.parse("}}{};}{}");
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
    assert.throws(() => bre.reparse("x}}{};}{}", recoveryTree, []), {
      name: "TypeError",
      message: "The incremental edits must produce the requested sed source.",
    });
    assert.throws(
      () =>
        bre.reparse("}}{};}{}", recoveryTree, [
          { startIndex: -1, oldEndIndex: 0, text: "" },
        ]),
      {
        name: "TypeError",
        message: "Invalid incremental source edit.",
      },
    );

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
    recoveryTree.delete();
    ereTree.delete();
    bre.delete();
    ere.delete();
  }
});

test("matches full parses across canonical and recovery transitions", async () => {
  const parser = await SedParser.create("bre");
  const cases = [
    {
      name: "canonical to canonical",
      previousSource: "p\n",
      source: "q\n",
      expectedError: false,
      expectedIssue: false,
    },
    {
      name: "canonical to native recovery",
      previousSource: "p\n",
      source: "}}{};}{}",
      expectedError: true,
      expectedIssue: true,
    },
    {
      name: "native recovery to native recovery",
      previousSource: "}}{};}{}",
      source: "x}}{};}{}",
      expectedError: true,
      expectedIssue: true,
    },
    {
      name: "canonical to structured recovery",
      previousSource: "p\n",
      source: "s/",
      expectedError: false,
      expectedIssue: true,
    },
    {
      name: "structured recovery after a split surrogate pair",
      previousSource: "s😀p😀d😀!n2D",
      source: "s😀p😀d\ud83db:!n2D",
      edits: [{ startIndex: 8, oldEndIndex: 9, text: "b:" }],
      expectedError: false,
      expectedIssue: true,
    },
  ];

  try {
    for (const {
      edits,
      expectedError,
      expectedIssue,
      name,
      previousSource,
      source,
    } of cases) {
      const previous = parser.parse(previousSource);
      const incremental = parser.reparse(
        source,
        previous,
        edits ?? [
          {
            startIndex: 0,
            oldEndIndex: previousSource.length,
            text: source,
          },
        ],
      );
      const full = parser.parse(source);
      try {
        assert.equal(incremental.rootNode.hasError, expectedError, name);
        assert.equal(
          incremental.rootNode.descendantsOfType("syntax_issue").length > 0,
          expectedIssue,
          name,
        );
        assert.equal(
          incremental.rootNode.toString(),
          full.rootNode.toString(),
          name,
        );
      } finally {
        previous.delete();
        incremental.delete();
        full.delete();
      }
    }
  } finally {
    parser.delete();
  }
});

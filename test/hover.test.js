import assert from "node:assert/strict";
import test from "node:test";
import { MarkupKind } from "vscode-languageserver";
import { hover } from "../src/hover.js";
import { SyntaxStore } from "../src/parser.js";
import { documentFor } from "./helpers.js";

async function withStore(callback) {
  const store = await SyntaxStore.create("bre");
  try {
    return await callback(store);
  } finally {
    store.dispose();
  }
}

function rangeAt(character, length = 1, line = 0) {
  return {
    start: { line, character },
    end: { line, character: character + length },
  };
}

function inlineCode(value) {
  if (!value.includes("`")) {
    return `\`${value}\``;
  }
  let fence = "``";
  while (value.includes(fence)) {
    fence += "`";
  }
  return `${fence} ${value} ${fence}`;
}

function expectedHover(reference, range) {
  const { title, synopsis, description } = reference;
  const display = reference.display ?? reference.spelling ?? reference.verb;
  return {
    contents: {
      kind: MarkupKind.Markdown,
      value: `### ${inlineCode(display)} — ${title}\n\n\`\`\`sed\n${synopsis}\n\`\`\`\n\n${description}`,
    },
    range,
  };
}

const commandReferences = [
  {
    source: "{p;}\n",
    verb: "{",
    title: "Command Block",
    synopsis: "[address[,address]]{ … }",
    description:
      "Executes the enclosed editing commands when the current pattern space is selected.",
  },
  {
    source: "a\\\ntext\n",
    verb: "a",
    title: "Append Text",
    synopsis: "[address]a\\\ntext",
    description:
      "Schedules text for standard output before the next input fetch, before `q`, or at the end of the script.",
  },
  {
    source: "b label\n",
    verb: "b",
    title: "Branch",
    synopsis: "[address[,address]]b [label]",
    description:
      "Branches to label, or to the end of the script when label is omitted.",
  },
  {
    source: "c\\\ntext\n",
    verb: "c",
    title: "Change Text",
    synopsis: "[address[,address]]c\\\ntext",
    description:
      "Deletes the pattern space, writes text once for the selected line or completed range, and starts the next cycle.",
  },
  {
    source: "d\n",
    verb: "d",
    title: "Delete",
    synopsis: "[address[,address]]d",
    description: "Deletes the pattern space and starts the next cycle.",
  },
  {
    source: "D\n",
    verb: "D",
    title: "Delete First Line",
    synopsis: "[address[,address]]D",
    description:
      "Deletes through the first newline and restarts the cycle without reading input, or acts like `d` when no newline exists.",
  },
  {
    source: "g\n",
    verb: "g",
    title: "Get",
    synopsis: "[address[,address]]g",
    description: "Replaces the pattern space with the hold space.",
  },
  {
    source: "G\n",
    verb: "G",
    title: "Get and Append",
    synopsis: "[address[,address]]G",
    description: "Appends a newline and the hold space to the pattern space.",
  },
  {
    source: "h\n",
    verb: "h",
    title: "Hold",
    synopsis: "[address[,address]]h",
    description: "Replaces the hold space with the pattern space.",
  },
  {
    source: "H\n",
    verb: "H",
    title: "Hold and Append",
    synopsis: "[address[,address]]H",
    description: "Appends a newline and the pattern space to the hold space.",
  },
  {
    source: "i\\\ntext\n",
    verb: "i",
    title: "Insert Text",
    synopsis: "[address]i\\\ntext",
    description:
      "Writes text to standard output before continuing with the selected pattern space.",
  },
  {
    source: "l\n",
    verb: "l",
    title: "List",
    synopsis: "[address[,address]]l",
    description:
      "Writes an unambiguous escaped representation of the pattern space.",
  },
  {
    source: "n\n",
    verb: "n",
    title: "Next",
    synopsis: "[address[,address]]n",
    description:
      "Writes the pattern space when default output is enabled, then replaces it with the next input line.",
  },
  {
    source: "N\n",
    verb: "N",
    title: "Append Next Line",
    synopsis: "[address[,address]]N",
    description:
      "Appends a newline and the next input line to the pattern space.",
  },
  {
    source: "1,2!p\n",
    character: 4,
    verb: "p",
    title: "Print",
    synopsis: "[address[,address]]p",
    description: "Writes the pattern space to standard output.",
  },
  {
    source: "P\n",
    verb: "P",
    title: "Print First Line",
    synopsis: "[address[,address]]P",
    description:
      "Writes the first line of the pattern space to standard output.",
  },
  {
    source: "q\n",
    verb: "q",
    title: "Quit",
    synopsis: "[address]q",
    description:
      "Branches to the end of the script and quits without starting a new cycle.",
  },
  {
    source: "r input\n",
    verb: "r",
    title: "Read File",
    synopsis: "[address]r rfile",
    description:
      "Schedules the contents of rfile to be written to standard output.",
  },
  {
    source: "s/a/b/\n",
    verb: "s",
    title: "Substitute",
    synopsis: "[address[,address]]s/RE/replacement/[flags]",
    description:
      "Replaces instances of RE in the pattern space according to flags.",
  },
  {
    source: "t label\n",
    verb: "t",
    title: "Test and Branch",
    synopsis: "[address[,address]]t [label]",
    description:
      "Branches to label if a substitution has occurred since the last input read or previous `t`, or to the end when label is omitted.",
  },
  {
    source: "w output\n",
    verb: "w",
    title: "Write File",
    synopsis: "[address[,address]]w wfile",
    description: "Appends the pattern space to wfile.",
  },
  {
    source: "x\n",
    verb: "x",
    title: "Exchange",
    synopsis: "[address[,address]]x",
    description: "Exchanges the pattern and hold spaces.",
  },
  {
    source: "y/a/b/\n",
    verb: "y",
    title: "Translate",
    synopsis: "[address[,address]]y/string1/string2/",
    description:
      "Replaces each occurrence of a character in string1 with the corresponding character in string2.",
  },
  {
    source: ":label\n",
    verb: ":",
    title: "Label",
    synopsis: ":label",
    description:
      "Defines a label for `b` and `t` without otherwise changing processing.",
  },
  {
    source: "=\n",
    verb: "=",
    title: "Print Line Number",
    synopsis: "[address]=",
    description: "Writes the current input line number to standard output.",
  },
  {
    source: "# comment\n",
    verb: "#",
    title: "Comment",
    synopsis: "#comment",
    description:
      "Ignores the remainder of the line; `#n` as the first two script characters also suppresses default output.",
  },
];

const substitutionFlagReferences = [
  {
    spelling: "001",
    character: 6,
    length: 3,
    positions: [6, 7, 8],
    title: "Occurrence",
    synopsis: "s/RE/replacement/n",
    description: "Replaces only the nth occurrence of RE in the pattern space.",
  },
  {
    spelling: "g",
    character: 9,
    title: "Global",
    synopsis: "s/RE/replacement/g",
    description:
      "Replaces all non-overlapping instances of RE rather than only the first.",
  },
  {
    spelling: "i",
    character: 10,
    title: "Case-Insensitive",
    synopsis: "s/RE/replacement/i",
    description: "Matches RE case-insensitively.",
  },
  {
    spelling: "p",
    character: 11,
    title: "Print on Substitution",
    synopsis: "s/RE/replacement/p",
    description:
      "Writes the pattern space to standard output if a replacement was made.",
  },
  {
    spelling: "w",
    character: 12,
    title: "Write on Substitution",
    synopsis: "s/RE/replacement/w wfile",
    description:
      "Appends the pattern space to wfile if a replacement was made.",
  },
];

const lineNumberAddressReference = {
  spelling: "001",
  title: "Line Number Address",
  synopsis: "number",
  description:
    "Selects the input line with this cumulative line number across all input files.",
};

const lastLineAddressReference = {
  spelling: "$",
  title: "Last-Line Address",
  synopsis: "$",
  description: "Selects the last line of input.",
};

function contextAddressReference(display) {
  return {
    display,
    title: "Context Address",
    synopsis: display,
    description:
      "Selects each pattern space that matches RE; use `/RE/` or `\\cREc`, where c is any character other than backslash or newline.",
  };
}

function emptyRegularExpressionReference(display) {
  return {
    display,
    title: "Empty Regular Expression",
    synopsis: display,
    description:
      "Behaves as if the most recently applied regular expression from a context address or substitute command were specified.",
  };
}

const addressRangeReference = {
  spelling: ",",
  title: "Address Range",
  synopsis: "address1,address2",
  description:
    "Selects each inclusive range from a pattern space selected by address1 through the next pattern space selected by address2; if address2 is a line number no greater than the first selected line number, only that first pattern space is selected.",
};

const negationReference = {
  spelling: "!",
  title: "Negated Selection",
  synopsis: "[address[,address]]!function",
  description:
    "Inverts the address selection that controls whether the editing command is applied.",
};

const matchedTextReference = {
  spelling: "&",
  title: "Matched Text",
  synopsis: "s/RE/&/",
  description: "Inserts the text matched by RE.",
};

function backReference(number, character) {
  return {
    spelling: `\\${number}`,
    character,
    length: 2,
    title: "Back-Reference",
    synopsis: `s/RE/\\${number}/`,
    description: `Inserts the text matched by regular-expression subexpression ${number}, or an empty string if that subexpression did not match.`,
  };
}

function delimiterReference(delimiter, character) {
  return {
    spelling: `\\${delimiter}`,
    character,
    length: 1 + delimiter.length,
    title: "Literal Delimiter",
    synopsis: `s${delimiter}RE${delimiter}\\${delimiter}${delimiter}`,
    description: "Inserts the substitution delimiter as a literal character.",
  };
}

const literalAmpersandReference = {
  spelling: "\\&",
  title: "Literal Ampersand",
  synopsis: "s/RE/\\&/",
  description: "Inserts a literal ampersand instead of the text matched by RE.",
};

const literalBackslashReference = {
  spelling: "\\\\",
  title: "Literal Backslash",
  synopsis: "s/RE/\\\\/",
  description: "Inserts a literal backslash.",
};

const embeddedNewlineReference = {
  display: "\\<newline>",
  title: "Embedded Newline",
  synopsis: "s/RE/first\\\nsecond/",
  description: "Inserts a newline into the replacement.",
};

const carriageReturnDelimiterReference = {
  display: "\\<carriage-return>",
  title: "Literal Delimiter",
  synopsis:
    "s<carriage-return>RE<carriage-return>\\<carriage-return><carriage-return>",
  description: "Inserts the substitution delimiter as a literal character.",
};

const formatDelimiterReference = {
  display: "\\<U+202A>",
  title: "Literal Delimiter",
  synopsis: "s<U+202A>RE<U+202A>\\<U+202A><U+202A>",
  description: "Inserts the substitution delimiter as a literal character.",
};

test("documents every POSIX command verb with its exact source range", async () => {
  await withStore((store) => {
    for (const reference of commandReferences) {
      const character = reference.character ?? 0;
      const snapshot = store.open(documentFor(reference.source));
      assert.deepEqual(
        hover(snapshot, { line: 0, character }),
        expectedHover(reference, rangeAt(character)),
        reference.verb,
      );
    }
  });
});

test("documents every POSIX substitution flag with its exact source range", async () => {
  await withStore((store) => {
    const snapshot = store.open(documentFor("s/a/b/001gipw output\n"));
    for (const reference of substitutionFlagReferences) {
      const positions = reference.positions ?? [reference.character];
      for (const character of positions) {
        assert.deepEqual(
          hover(snapshot, { line: 0, character }),
          expectedHover(
            reference,
            rangeAt(reference.character, reference.length),
          ),
          `${reference.spelling} at ${character}`,
        );
      }
    }

    for (const position of [
      { line: 0, character: 13 },
      { line: 0, character: 14 },
      { line: 0, character: 19 },
      { line: 0, character: 20 },
      { line: 1, character: 0 },
    ]) {
      assert.equal(
        hover(snapshot, position),
        undefined,
        JSON.stringify(position),
      );
    }
  });
});

test("documents every atomic address element with its exact source range", async () => {
  await withStore((store) => {
    const snapshot = store.open(documentFor("001,$!p\n"));
    for (const character of [0, 1, 2]) {
      assert.deepEqual(
        hover(snapshot, { line: 0, character }),
        expectedHover(lineNumberAddressReference, rangeAt(0, 3)),
        `line number at ${character}`,
      );
    }
    assert.deepEqual(
      hover(snapshot, { line: 0, character: 3 }),
      expectedHover(addressRangeReference, rangeAt(3)),
    );
    assert.deepEqual(
      hover(snapshot, { line: 0, character: 4 }),
      expectedHover(lastLineAddressReference, rangeAt(4)),
    );
    assert.deepEqual(
      hover(snapshot, { line: 0, character: 5 }),
      expectedHover(negationReference, rangeAt(5)),
    );
    for (const position of [
      { line: 0, character: 7 },
      { line: 1, character: 0 },
    ]) {
      assert.equal(hover(snapshot, position), undefined);
    }
  });
});

test("documents complete and empty context addresses only at delimiters", async () => {
  await withStore((store) => {
    const snapshot = store.open(documentFor("/1,$!/p;//p\n"));
    const contextReference = contextAddressReference("/RE/");
    for (const character of [0, 5]) {
      assert.deepEqual(
        hover(snapshot, { line: 0, character }),
        expectedHover(contextReference, rangeAt(0, 6)),
        `context delimiter at ${character}`,
      );
    }
    for (const character of [1, 2, 3, 4, 7]) {
      assert.equal(
        hover(snapshot, { line: 0, character }),
        undefined,
        `context interior at ${character}`,
      );
    }

    const emptyReference = emptyRegularExpressionReference("//");
    for (const character of [8, 9]) {
      assert.deepEqual(
        hover(snapshot, { line: 0, character }),
        expectedHover(emptyReference, rangeAt(8, 2)),
        `empty expression at ${character}`,
      );
    }
    for (const position of [
      { line: 0, character: 11 },
      { line: 1, character: 0 },
    ]) {
      assert.equal(hover(snapshot, position), undefined);
    }
  });
});

test("normalizes alternative address delimiters across UTF-16 positions", async () => {
  await withStore((store) => {
    const astral = store.open(documentFor("\\😀a😀p\n"));
    const astralReference = contextAddressReference("\\😀RE😀");
    for (const character of [0, 1, 2, 4, 5]) {
      assert.deepEqual(
        hover(astral, { line: 0, character }),
        expectedHover(astralReference, rangeAt(0, 6)),
        `astral delimiter at ${character}`,
      );
    }
    assert.equal(hover(astral, { line: 0, character: 3 }), undefined);
    assert.equal(hover(astral, { line: 0, character: 7 }), undefined);

    const backtick = store.open(documentFor("\\``p\n"));
    const backtickReference = emptyRegularExpressionReference("\\``");
    for (const character of [0, 1, 2]) {
      assert.deepEqual(
        hover(backtick, { line: 0, character }),
        expectedHover(backtickReference, rangeAt(0, 3)),
        `backtick delimiter at ${character}`,
      );
    }
    assert.equal(hover(backtick, { line: 0, character: 4 }), undefined);
  });
});

test("keeps concrete address syntax and excludes recovery artifacts", async () => {
  await withStore((store) => {
    const missingSeparator = store.open(documentFor("1 2p\n"));
    for (const [character, spelling] of [
      [0, "1"],
      [2, "2"],
    ]) {
      const reference = {
        ...lineNumberAddressReference,
        spelling,
      };
      assert.deepEqual(
        hover(missingSeparator, { line: 0, character }),
        expectedHover(reference, rangeAt(character)),
      );
    }
    assert.equal(hover(missingSeparator, { line: 0, character: 1 }), undefined);

    const blanksAroundSeparator = store.open(documentFor("1 , 2p\n"));
    assert.deepEqual(
      hover(blanksAroundSeparator, { line: 0, character: 2 }),
      expectedHover(addressRangeReference, rangeAt(2)),
    );

    const commandWithOneAddress = store.open(documentFor("1,2q\n"));
    assert.deepEqual(
      hover(commandWithOneAddress, { line: 0, character: 1 }),
      expectedHover(addressRangeReference, rangeAt(1)),
    );

    const duplicateNegation = store.open(documentFor("!!p\n"));
    assert.deepEqual(
      hover(duplicateNegation, { line: 0, character: 0 }),
      expectedHover(negationReference, rangeAt(0)),
    );
    assert.equal(
      hover(duplicateNegation, { line: 0, character: 1 }),
      undefined,
    );

    const blankAfterNegation = store.open(documentFor("! p\n"));
    assert.deepEqual(
      hover(blankAfterNegation, { line: 0, character: 0 }),
      expectedHover(negationReference, rangeAt(0)),
    );
    assert.equal(
      hover(blankAfterNegation, { line: 0, character: 1 }),
      undefined,
    );

    const invalidCases = [
      ["0p\n", [0]],
      [",p\n", [0]],
      ["1,p\n", [1]],
      [",2p\n", [0]],
      ["1,2,3p\n", [3, 4]],
      ["/\np\n", [0]],
      ["\\|a\np\n", [0, 1]],
      ["\\\\p\n", [0, 1]],
    ];
    for (const [source, characters] of invalidCases) {
      const snapshot = store.open(documentFor(source));
      for (const character of characters) {
        assert.equal(
          hover(snapshot, { line: 0, character }),
          undefined,
          `${JSON.stringify(source)} at ${character}`,
        );
      }
    }
  });
});

test("prefers concrete syntax over zero-width recovery at the same position", async () => {
  await withStore((store) => {
    const appendReference = commandReferences.find(({ verb }) => verb === "a");
    assert.notEqual(appendReference, undefined);
    const cases = [
      ["1, 2p\n", addressRangeReference],
      ["1$p\n", lastLineAddressReference],
      ["}a}\n", appendReference],
    ];
    for (const [source, reference] of cases) {
      const snapshot = store.open(documentFor(source));
      assert.deepEqual(
        hover(snapshot, { line: 0, character: 1 }),
        expectedHover(reference, rangeAt(1)),
        source,
      );
    }
  });
});

test("documents every portable replacement special element with exact ranges", async () => {
  await withStore((store) => {
    const snapshot = store.open(
      documentFor("s|a|x&\\1\\2\\3\\4\\5\\6\\7\\8\\9\\|\\&\\\\|\n"),
    );
    const references = [
      { ...matchedTextReference, character: 5, length: 1 },
      ...Array.from({ length: 9 }, (_, index) =>
        backReference(index + 1, 6 + index * 2),
      ),
      delimiterReference("|", 24),
      { ...literalAmpersandReference, character: 26, length: 2 },
      { ...literalBackslashReference, character: 28, length: 2 },
    ];

    for (const reference of references) {
      for (
        let character = reference.character;
        character < reference.character + reference.length;
        character += 1
      ) {
        assert.deepEqual(
          hover(snapshot, { line: 0, character }),
          expectedHover(
            reference,
            rangeAt(reference.character, reference.length),
          ),
          `${reference.spelling} at ${character}`,
        );
      }
    }

    for (const position of [
      { line: 0, character: 1 },
      { line: 0, character: 2 },
      { line: 0, character: 3 },
      { line: 0, character: 4 },
      { line: 0, character: 30 },
      { line: 0, character: 31 },
      { line: 1, character: 0 },
    ]) {
      assert.equal(
        hover(snapshot, position),
        undefined,
        JSON.stringify(position),
      );
    }

    const followedByDigit = store.open(documentFor("s|a|\\12|"));
    const firstBackReference = backReference(1, 4);
    for (const character of [4, 5]) {
      assert.deepEqual(
        hover(followedByDigit, { line: 0, character }),
        expectedHover(firstBackReference, rangeAt(4, 2)),
      );
    }
    assert.equal(hover(followedByDigit, { line: 0, character: 6 }), undefined);
  });
});

test("documents digit, astral, and backtick replacement delimiters", async () => {
  await withStore((store) => {
    const cases = [
      {
        source: "s0a0\\00",
        reference: delimiterReference("0", 4),
        unsupportedCharacters: [1, 3, 6, 7],
      },
      {
        source: "s😀a😀\\😀😀",
        reference: delimiterReference("😀", 6),
        unsupportedCharacters: [1, 2, 4, 5, 9, 10, 11],
      },
      {
        source: "s`a`\\``",
        reference: delimiterReference("`", 4),
        unsupportedCharacters: [1, 3, 6, 7],
      },
    ];

    for (const { source, reference, unsupportedCharacters } of cases) {
      const snapshot = store.open(documentFor(source));
      for (
        let character = reference.character;
        character < reference.character + reference.length;
        character += 1
      ) {
        assert.deepEqual(
          hover(snapshot, { line: 0, character }),
          expectedHover(
            reference,
            rangeAt(reference.character, reference.length),
          ),
          `${reference.spelling} at ${character}`,
        );
      }
      for (const character of unsupportedCharacters) {
        assert.equal(
          hover(snapshot, { line: 0, character }),
          undefined,
          `${source} at ${character}`,
        );
      }
    }
  });
});

test("renders a carriage-return delimiter safely over its source range", async () => {
  await withStore((store) => {
    const snapshot = store.open(documentFor("s\ra\r\\\r\r"));
    const range = {
      start: { line: 2, character: 0 },
      end: { line: 3, character: 0 },
    };
    for (const position of [
      { line: 2, character: 0 },
      { line: 2, character: 1 },
    ]) {
      const result = hover(snapshot, position);
      assert.deepEqual(
        result,
        expectedHover(carriageReturnDelimiterReference, range),
        JSON.stringify(position),
      );
      assert.equal(result.contents.value.includes("\r"), false);
    }
  });
});

test("renders an invisible Unicode delimiter without formatting controls", async () => {
  await withStore((store) => {
    const snapshot = store.open(documentFor("s\u202aa\u202a\\\u202a\u202a"));
    for (const character of [4, 5]) {
      const result = hover(snapshot, { line: 0, character });
      assert.deepEqual(
        result,
        expectedHover(formatDelimiterReference, rangeAt(4, 2)),
      );
      assert.equal(result.contents.value.includes("\u202a"), false);
    }
  });
});

test("ranges an embedded newline and following reference across UTF-16 lines", async () => {
  await withStore((store) => {
    const snapshot = store.open(documentFor("s|a|😀\\\n&|"));
    const newlineRange = {
      start: { line: 0, character: 6 },
      end: { line: 1, character: 0 },
    };
    for (const position of [
      { line: 0, character: 6 },
      { line: 0, character: 7 },
    ]) {
      assert.deepEqual(
        hover(snapshot, position),
        expectedHover(embeddedNewlineReference, newlineRange),
        JSON.stringify(position),
      );
    }

    assert.deepEqual(
      hover(snapshot, { line: 1, character: 0 }),
      expectedHover(matchedTextReference, rangeAt(0, 1, 1)),
    );
    for (const position of [
      { line: 0, character: 4 },
      { line: 0, character: 5 },
      { line: 1, character: 1 },
      { line: 1, character: 2 },
    ]) {
      assert.equal(
        hover(snapshot, position),
        undefined,
        JSON.stringify(position),
      );
    }
  });
});

test("keeps valid replacement elements through missing-delimiter recovery", async () => {
  await withStore((store) => {
    const snapshot = store.open(documentFor("s|a|&\\1\\q\\"));
    assert.deepEqual(
      hover(snapshot, { line: 0, character: 4 }),
      expectedHover(matchedTextReference, rangeAt(4)),
    );
    const reference = backReference(1, 5);
    for (const character of [5, 6]) {
      assert.deepEqual(
        hover(snapshot, { line: 0, character }),
        expectedHover(reference, rangeAt(5, 2)),
      );
    }
    for (const character of [7, 8, 9, 10]) {
      assert.equal(
        hover(snapshot, { line: 0, character }),
        undefined,
        String(character),
      );
    }

    const zero = store.open(documentFor("s/a/\\0/"));
    for (const character of [4, 5]) {
      assert.equal(hover(zero, { line: 0, character }), undefined);
    }

    const ampersandDelimiter = store.open(documentFor("s&x&\\&&"));
    for (const character of [4, 5]) {
      assert.equal(
        hover(ampersandDelimiter, { line: 0, character }),
        undefined,
      );
    }
  });
});

test("does not confuse replacement elements with regex or translation syntax", async () => {
  await withStore((store) => {
    const snapshot = store.open(
      documentFor("s|\\1&\\||&\\1\\||\ny|\\||\\||\n"),
    );
    for (const character of [1, 2, 3, 4, 5, 6, 7, 13]) {
      assert.equal(
        hover(snapshot, { line: 0, character }),
        undefined,
        `regex at ${character}`,
      );
    }

    assert.deepEqual(
      hover(snapshot, { line: 0, character: 8 }),
      expectedHover(matchedTextReference, rangeAt(8)),
    );
    assert.deepEqual(
      hover(snapshot, { line: 0, character: 9 }),
      expectedHover(backReference(1, 9), rangeAt(9, 2)),
    );
    assert.deepEqual(
      hover(snapshot, { line: 0, character: 11 }),
      expectedHover(delimiterReference("|", 11), rangeAt(11, 2)),
    );

    for (const character of [1, 2, 3, 4, 5, 6, 7]) {
      assert.equal(
        hover(snapshot, { line: 1, character }),
        undefined,
        `translation at ${character}`,
      );
    }
  });
});

test("does not confuse documented syntax with surrounding text", async () => {
  await withStore((store) => {
    const snapshot = store.open(documentFor("1p;s/p/p/p;b p\n# p\n{p;}\n"));
    const unsupportedPositions = [
      { line: 0, character: 2 },
      { line: 0, character: 4 },
      { line: 0, character: 5 },
      { line: 0, character: 7 },
      { line: 0, character: 10 },
      { line: 0, character: 12 },
      { line: 0, character: 13 },
      { line: 1, character: 1 },
      { line: 1, character: 2 },
      { line: 2, character: 2 },
      { line: 2, character: 3 },
      { line: 3, character: 0 },
    ];
    for (const position of unsupportedPositions) {
      assert.equal(
        hover(snapshot, position),
        undefined,
        JSON.stringify(position),
      );
    }

    const printFlag = substitutionFlagReferences.find(
      ({ spelling }) => spelling === "p",
    );
    assert.notEqual(printFlag, undefined);
    assert.deepEqual(
      hover(snapshot, { line: 0, character: 9 }),
      expectedHover(printFlag, rangeAt(9)),
    );

    const adjacent = hover(snapshot, { line: 2, character: 1 });
    assert.match(adjacent?.contents.value ?? "", /^### `p` — Print$/m);

    const finalVerb = store.open(documentFor("d"));
    assert.equal(hover(finalVerb, { line: 0, character: 1 }), undefined);
  });
});

test("keeps valid flags and excludes invalid recovery artifacts", async () => {
  await withStore((store) => {
    const writeFlag = substitutionFlagReferences.find(
      ({ spelling }) => spelling === "w",
    );
    assert.notEqual(writeFlag, undefined);
    for (const source of ["s/a/b/w\n", "s/a/b/woutput\n"]) {
      const snapshot = store.open(documentFor(source));
      assert.deepEqual(
        hover(snapshot, { line: 0, character: 6 }),
        expectedHover(writeFlag, rangeAt(6)),
        source,
      );
    }

    const invalid = store.open(documentFor("s/a/b/000z\n"));
    for (const character of [6, 7, 8, 9]) {
      assert.equal(
        hover(invalid, { line: 0, character }),
        undefined,
        String(character),
      );
    }

    const globalFlag = substitutionFlagReferences.find(
      ({ spelling }) => spelling === "g",
    );
    assert.notEqual(globalFlag, undefined);
    const nativeRecovery = store.open(documentFor("{;s/a/b/g}"));
    assert.deepEqual(
      hover(nativeRecovery, { line: 0, character: 8 }),
      expectedHover(globalFlag, rangeAt(8)),
    );
  });
});

test("keeps known verbs through structured and native parser recovery", async () => {
  await withStore((store) => {
    const readReference = commandReferences.find(({ verb }) => verb === "r");
    assert.notEqual(readReference, undefined);
    const incompleteRead = store.open(documentFor("r\n"));
    assert.deepEqual(
      hover(incompleteRead, { line: 0, character: 0 }),
      expectedHover(readReference, rangeAt(0)),
    );

    const blockReference = commandReferences.find(({ verb }) => verb === "{");
    assert.notEqual(blockReference, undefined);
    const nativeRecovery = store.open(documentFor("{;p}"));
    assert.deepEqual(
      hover(nativeRecovery, { line: 0, character: 0 }),
      expectedHover(blockReference, rangeAt(0)),
    );
    assert.match(
      hover(nativeRecovery, { line: 0, character: 2 })?.contents.value ?? "",
      /^### `p` — Print$/m,
    );
    assert.equal(hover(nativeRecovery, { line: 0, character: 3 }), undefined);

    const unknown = store.open(documentFor("k tail\n"));
    assert.equal(hover(unknown, { line: 0, character: 0 }), undefined);
  });
});

test("resolves UTF-16 positions after an astral character", async () => {
  await withStore((store) => {
    const globalFlag = substitutionFlagReferences.find(
      ({ spelling }) => spelling === "g",
    );
    assert.notEqual(globalFlag, undefined);
    const snapshot = store.open(documentFor("s/😀/x/g;p"));
    assert.deepEqual(
      hover(snapshot, { line: 0, character: 7 }),
      expectedHover(globalFlag, rangeAt(7)),
    );

    const printCommand = commandReferences.find(({ verb }) => verb === "p");
    assert.notEqual(printCommand, undefined);
    assert.deepEqual(
      hover(snapshot, { line: 0, character: 9 }),
      expectedHover(printCommand, rangeAt(9)),
    );
  });
});

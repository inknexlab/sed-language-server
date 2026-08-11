import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { hover as analyze } from "../../src/analysis/hover.js";
import { offsetAt, positionAt, withAnalysisStore } from "./helpers.js";

async function withStore(callback) {
  return withAnalysisStore("bre", callback);
}

function hover(snapshot, position) {
  const result = analyze(snapshot, offsetAt(snapshot.source, position));
  if (result === undefined) {
    return undefined;
  }
  return {
    documentation: result.documentation,
    range: {
      start: positionAt(snapshot.source, result.startOffset),
      end: positionAt(snapshot.source, result.endOffset),
    },
  };
}

function analyzeHover(snapshot, offset) {
  return analyze(snapshot, offset);
}

function rangeAt(character, length = 1, line = 0) {
  return {
    start: { line, character },
    end: { line, character: character + length },
  };
}

function expectedHover(reference, range) {
  const { title, synopsis, description } = reference;
  const display = reference.display ?? reference.spelling ?? reference.verb;
  return {
    documentation: { display, title, synopsis, description },
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
      "Schedules text for standard output before the next input fetch, before q, or at the end of the script.",
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
      "Deletes through the first newline and restarts the cycle without reading input, or acts like d when no newline exists.",
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
      "Branches to label if a substitution has occurred since the last input read or previous t, or to the end when label is omitted.",
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
      "Defines a label for b and t without otherwise changing processing.",
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
      "Ignores the remainder of the line; #n as the first two script characters also suppresses default output.",
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
      "Selects each pattern space that matches RE; use /RE/ or \\cREc, where c is any character other than backslash or newline.",
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
      const snapshot = store.open(reference.source);
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
    const snapshot = store.open("s/a/b/001gipw output\n");
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
    const snapshot = store.open("001,$!p\n");
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
    const snapshot = store.open("/1,$!/p;//p\n");
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
    const astral = store.open("\\😀a😀p\n");
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

    const backtick = store.open("\\``p\n");
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
    const missingSeparator = store.open("1 2p\n");
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

    const blanksAroundSeparator = store.open("1 , 2p\n");
    assert.deepEqual(
      hover(blanksAroundSeparator, { line: 0, character: 2 }),
      expectedHover(addressRangeReference, rangeAt(2)),
    );

    const commandWithOneAddress = store.open("1,2q\n");
    assert.deepEqual(
      hover(commandWithOneAddress, { line: 0, character: 1 }),
      expectedHover(addressRangeReference, rangeAt(1)),
    );

    const zeroAddress = store.open("0p\n");
    assert.deepEqual(
      hover(zeroAddress, { line: 0, character: 0 }),
      expectedHover(
        { ...lineNumberAddressReference, spelling: "0" },
        rangeAt(0),
      ),
    );

    const duplicateNegation = store.open("!!p\n");
    assert.deepEqual(
      hover(duplicateNegation, { line: 0, character: 0 }),
      expectedHover(negationReference, rangeAt(0)),
    );
    assert.equal(
      hover(duplicateNegation, { line: 0, character: 1 }),
      undefined,
    );

    const blankAfterNegation = store.open("! p\n");
    assert.deepEqual(
      hover(blankAfterNegation, { line: 0, character: 0 }),
      expectedHover(negationReference, rangeAt(0)),
    );
    assert.equal(
      hover(blankAfterNegation, { line: 0, character: 1 }),
      undefined,
    );

    const invalidCases = [
      [",p\n", [0]],
      ["1,p\n", [1]],
      [",2p\n", [0]],
      ["1,2,3p\n", [3, 4]],
      ["/\np\n", [0]],
      ["\\|a\np\n", [0, 1]],
      ["\\\\p\n", [0, 1]],
    ];
    for (const [source, characters] of invalidCases) {
      const snapshot = store.open(source);
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
      const snapshot = store.open(source);
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
      "s|a|x&\\1\\2\\3\\4\\5\\6\\7\\8\\9\\|\\&\\\\|\n",
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

    const followedByDigit = store.open("s|a|\\12|");
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
      const snapshot = store.open(source);
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
    const snapshot = store.open("s\ra\r\\\r\r");
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
      assert.equal(JSON.stringify(result.documentation).includes("\r"), false);
    }
  });
});

test("renders an invisible Unicode delimiter without formatting controls", async () => {
  await withStore((store) => {
    const snapshot = store.open("s\u202aa\u202a\\\u202a\u202a");
    for (const character of [4, 5]) {
      const result = hover(snapshot, { line: 0, character });
      assert.deepEqual(
        result,
        expectedHover(formatDelimiterReference, rangeAt(4, 2)),
      );
      assert.equal(
        JSON.stringify(result.documentation).includes("\u202a"),
        false,
      );
    }
  });
});

test("ranges an embedded newline and following reference across UTF-16 lines", async () => {
  await withStore((store) => {
    const snapshot = store.open("s|a|😀\\\n&|");
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
    const snapshot = store.open("s|a|&\\1\\q\\");
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

    const zero = store.open("s/a/\\0/");
    for (const character of [4, 5]) {
      assert.equal(hover(zero, { line: 0, character }), undefined);
    }

    const ampersandDelimiter = store.open("s&x&\\&&");
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
    const snapshot = store.open("s|\\1&\\||&\\1\\||\ny|\\||\\||\n");
    for (const character of [1, 4, 5, 6, 7, 13]) {
      assert.equal(
        hover(snapshot, { line: 0, character }),
        undefined,
        `regex at ${character}`,
      );
    }
    for (const character of [2, 3]) {
      assert.deepEqual(
        hover(snapshot, { line: 0, character }),
        expectedHover(
          {
            display: "\\1",
            title: "Back-Reference",
            synopsis: "\\1",
            description:
              "Matches the same string matched by preceding BRE subexpression 1.",
          },
          rangeAt(2, 2),
        ),
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
    const snapshot = store.open("1p;s/p/p/p;b p\n# p\n{p;}\n");
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
    assert.deepEqual(
      [adjacent?.documentation.display, adjacent?.documentation.title],
      ["p", "Print"],
    );

    const finalVerb = store.open("d");
    assert.equal(hover(finalVerb, { line: 0, character: 1 }), undefined);
  });
});

test("keeps valid flags outside invalid recovery subtrees", async () => {
  await withStore((store) => {
    const writeFlag = substitutionFlagReferences.find(
      ({ spelling }) => spelling === "w",
    );
    assert.notEqual(writeFlag, undefined);
    for (const source of ["s/a/b/w\n", "s/a/b/woutput\n"]) {
      const snapshot = store.open(source);
      assert.deepEqual(
        hover(snapshot, { line: 0, character: 6 }),
        expectedHover(writeFlag, rangeAt(6)),
        source,
      );
    }

    const invalid = store.open("s/a/b/000z\n");
    const zeroOccurrence = {
      ...substitutionFlagReferences[0],
      spelling: "000",
    };
    for (const character of [6, 7, 8]) {
      assert.deepEqual(
        hover(invalid, { line: 0, character }),
        expectedHover(zeroOccurrence, rangeAt(6, 3)),
        String(character),
      );
    }
    assert.equal(hover(invalid, { line: 0, character: 9 }), undefined);

    const globalFlag = substitutionFlagReferences.find(
      ({ spelling }) => spelling === "g",
    );
    assert.notEqual(globalFlag, undefined);
    const nativeRecovery = store.open("{;s/a/b/g}");
    assert.equal(hover(nativeRecovery, { line: 0, character: 8 }), undefined);

    const preserved = store.open("s/a/b/g;@\n");
    assert.deepEqual(
      hover(preserved, { line: 0, character: 6 }),
      expectedHover(globalFlag, rangeAt(6)),
    );
  });
});

test("keeps known verbs outside recovery and omits native error subtrees", async () => {
  await withStore((store) => {
    const readReference = commandReferences.find(({ verb }) => verb === "r");
    assert.notEqual(readReference, undefined);
    const incompleteRead = store.open("r\n");
    assert.deepEqual(
      hover(incompleteRead, { line: 0, character: 0 }),
      expectedHover(readReference, rangeAt(0)),
    );

    const blockReference = commandReferences.find(({ verb }) => verb === "{");
    assert.notEqual(blockReference, undefined);
    const nativeRecovery = store.open("{;p}");
    for (const character of [0, 2]) {
      assert.equal(hover(nativeRecovery, { line: 0, character }), undefined);
    }

    const preserved = store.open("{;p}\np\n");
    assert.deepEqual(
      hover(preserved, { line: 0, character: 0 }),
      expectedHover(blockReference, rangeAt(0)),
    );
    const nestedPrint = hover(preserved, { line: 0, character: 2 });
    assert.deepEqual(
      [nestedPrint?.documentation.display, nestedPrint?.documentation.title],
      ["p", "Print"],
    );
    assert.equal(
      hover(preserved, { line: 1, character: 0 })?.documentation.title,
      "Print",
    );

    const unknown = store.open("k tail\n");
    assert.equal(hover(unknown, { line: 0, character: 0 }), undefined);
  });
});

test("resolves UTF-16 positions after an astral character", async () => {
  await withStore((store) => {
    const globalFlag = substitutionFlagReferences.find(
      ({ spelling }) => spelling === "g",
    );
    assert.notEqual(globalFlag, undefined);
    const snapshot = store.open("s/😀/x/g;p");
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

function occurrence(source, spelling, number = 1) {
  let start = -1;
  for (let current = 0; current < number; current += 1) {
    start = source.indexOf(spelling, start + 1);
  }
  assert.notEqual(start, -1, spelling);
  return { start, end: start + spelling.length };
}

function assertAnalysisHover(snapshot, cursor, range, reference) {
  assert.deepEqual(analyzeHover(snapshot, cursor), {
    startOffset: range.start,
    endOffset: range.end,
    documentation: {
      display:
        reference.display ?? snapshot.source.slice(range.start, range.end),
      title: reference.title,
      synopsis: reference.synopsis,
      description: reference.description,
    },
  });
}

test("describes the principal POSIX BRE constructs", async () => {
  await withAnalysisStore("bre", (store) => {
    const source = "s#^a.\\(b*\\)\\{2,3\\}\\1$#x#\n";
    const snapshot = store.open(source);
    const cases = [
      [
        "^",
        "Beginning Anchor",
        "^RE",
        "Matches only at the beginning of the string being searched.",
      ],
      [
        ".",
        "Any-Character Expression",
        ".",
        "Matches any character in the supported character set except NUL.",
      ],
      [
        "\\(",
        "Subexpression",
        "\\(RE\\)",
        "Groups RE as one expression; duplication applies to the group as a whole.",
      ],
      [
        "*",
        "Zero-or-More Duplication",
        "RE*",
        "Matches zero or more consecutive occurrences of RE.",
      ],
      [
        "\\)",
        "Subexpression",
        "\\(RE\\)",
        "Groups RE as one expression; duplication applies to the group as a whole.",
      ],
      [
        "\\{2,3\\}",
        "Interval Duplication",
        "RE\\{m,n\\}",
        "Matches a number of consecutive occurrences of RE within the interval's minimum and optional maximum bounds.",
      ],
      [
        "\\1",
        "Back-Reference",
        "\\1",
        "Matches the same string matched by preceding BRE subexpression 1.",
      ],
      [
        "$",
        "End Anchor",
        "RE$",
        "Matches only at the end of the string being searched.",
      ],
    ];

    for (const [spelling, title, synopsis, description] of cases) {
      const range = occurrence(source, spelling);
      assertAnalysisHover(snapshot, range.start, range, {
        title,
        synopsis,
        description,
      });
    }

    const interval = occurrence(source, "\\{2,3\\}");
    assert.equal(
      analyzeHover(snapshot, interval.start + 3)?.startOffset,
      interval.start,
    );
  });
});

test("describes the principal POSIX ERE constructs", async () => {
  await withAnalysisStore("ere", (store) => {
    const source = "s#^(a|.)+b?c{2,3}$#x#\n";
    const snapshot = store.open(source);
    const cases = [
      [
        "(",
        "Subexpression",
        "(RE)",
        "Groups RE as one expression; duplication applies to the group as a whole.",
      ],
      [
        "|",
        "Alternation",
        "RE|RE",
        "Matches either the expression on the left or the right.",
      ],
      [
        ".",
        "Any-Character Expression",
        ".",
        "Matches any character in the supported character set except NUL.",
      ],
      [
        ")",
        "Subexpression",
        "(RE)",
        "Groups RE as one expression; duplication applies to the group as a whole.",
      ],
      [
        "+",
        "One-or-More Duplication",
        "RE+",
        "Matches one or more consecutive occurrences of RE.",
      ],
      [
        "?",
        "Zero-or-One Duplication",
        "RE?",
        "Matches zero or one occurrence of RE.",
      ],
      [
        "{2,3}",
        "Interval Duplication",
        "RE{m,n}",
        "Matches a number of consecutive occurrences of RE within the interval's minimum and optional maximum bounds.",
      ],
    ];

    for (const [spelling, title, synopsis, description] of cases) {
      const range = occurrence(source, spelling);
      assertAnalysisHover(snapshot, range.start, range, {
        title,
        synopsis,
        description,
      });
    }
  });
});

test("documents every ERE minimal repetition modifier independently", async () => {
  await withAnalysisStore("ere", (store) => {
    const source = "s#A*?B+?C??D{2}?E{2,}?F{2,3}?#x#\n";
    const snapshot = store.open(source);
    const forms = ["*?", "+?", "??", "{2}?", "{2,}?", "{2,3}?"];

    for (const form of forms) {
      const complete = occurrence(source, form);
      const modifier = { start: complete.end - 1, end: complete.end };
      assertAnalysisHover(snapshot, modifier.start, modifier, {
        title: "Minimal Repetition Modifier",
        synopsis: `RE${form}`,
        description:
          "Makes the preceding duplication prefer the shortest match that permits the complete ERE to match.",
      });

      const base = analyzeHover(snapshot, complete.start);
      assert.notEqual(base, undefined, form);
      assert.equal(base.startOffset, complete.start, form);
      assert.equal(base.endOffset, complete.end - 1, form);
    }

    const modifier = occurrence(source, "*?");
    assert.deepEqual(analyzeHover(snapshot, modifier.end - 1), {
      startOffset: modifier.end - 1,
      endOffset: modifier.end,
      documentation: {
        display: "?",
        title: "Minimal Repetition Modifier",
        synopsis: "RE*?",
        description:
          "Makes the preceding duplication prefer the shortest match that permits the complete ERE to match.",
      },
    });
  });
});

test("describes complete bracket-expression structures in both modes", async () => {
  const source = "/[^a-c[:alpha:][.ch.][=x=]]/p\n";
  for (const mode of ["bre", "ere"]) {
    await withAnalysisStore(mode, (store) => {
      const snapshot = store.open(source);
      const cases = [
        [
          "[",
          1,
          "Bracket Expression",
          "[list]",
          "Matches a character, and may match a multi-character collating element, represented by its non-empty list.",
        ],
        [
          "^",
          1,
          "Non-Matching List",
          "[^list]",
          "Makes the bracket expression match a character not represented by its list.",
        ],
        [
          "-",
          1,
          "Range Expression",
          "[start-end]",
          "In the POSIX locale, represents the collating elements from start through end, inclusive; its behavior in other locales is unspecified.",
        ],
        [
          "[:alpha:]",
          1,
          "Alphabetic Character Class",
          "[[:alpha:]]",
          "Represents letters in the current locale.",
        ],
        [
          "[.ch.]",
          1,
          "Collating Symbol",
          "[[.element.]]",
          "Represents this collating element as a single bracket-expression element.",
        ],
        [
          "[=x=]",
          1,
          "Equivalence Class Expression",
          "[[=element=]]",
          "Represents the set of collating elements in the same equivalence class as this element.",
        ],
        [
          "]",
          4,
          "Bracket Expression",
          "[list]",
          "Matches a character, and may match a multi-character collating element, represented by its non-empty list.",
        ],
      ];

      for (const [spelling, number, title, synopsis, description] of cases) {
        const range = occurrence(source, spelling, number);
        assertAnalysisHover(snapshot, range.start, range, {
          title,
          synopsis,
          description,
        });
      }

      for (const spelling of ["[:alpha:]", "[.ch.]", "[=x=]"]) {
        const range = occurrence(source, spelling);
        assert.equal(
          analyzeHover(snapshot, range.start + 2)?.endOffset,
          range.end,
        );
      }
    });
  }
});

test("keeps complete bracket members outside an incomplete frame", async () => {
  const source = "/[^a-z[:alpha:]/p\n";
  for (const mode of ["bre", "ere"]) {
    await withAnalysisStore(mode, (store) => {
      const snapshot = store.open(source);
      assertAnalysisHover(
        snapshot,
        2,
        { start: 2, end: 3 },
        {
          title: "Non-Matching List",
          synopsis: "[^list]",
          description:
            "Makes the bracket expression match a character not represented by its list.",
        },
      );
      assertAnalysisHover(
        snapshot,
        4,
        { start: 4, end: 5 },
        {
          title: "Range Expression",
          synopsis: "[start-end]",
          description:
            "In the POSIX locale, represents the collating elements from start through end, inclusive; its behavior in other locales is unspecified.",
        },
      );
      assertAnalysisHover(
        snapshot,
        8,
        { start: 6, end: 15 },
        {
          title: "Alphabetic Character Class",
          synopsis: "[[:alpha:]]",
          description: "Represents letters in the current locale.",
        },
      );
    });
  }
});

test("omits operators whose immediate regular expression structure is invalid", async () => {
  await withAnalysisStore("ere", (store) => {
    for (const [source, offsets] of [
      ["/a|/p\n", [2]],
      ["/|a/p\n", [1]],
      ["/a||b/p\n", [2, 3]],
    ]) {
      const snapshot = store.open(source);
      for (const offset of offsets) {
        assert.equal(analyzeHover(snapshot, offset), undefined, source);
      }
    }

    const laterValidOperator = store.open("/|a|b/p\n");
    assert.equal(analyzeHover(laterValidOperator, 1), undefined);
    assert.equal(
      analyzeHover(laterValidOperator, 3)?.documentation.title,
      "Alternation",
    );
  });

  for (const mode of ["bre", "ere"]) {
    await withAnalysisStore(mode, (store) => {
      for (const source of ["/[a-[:digit:]]/p\n", "/[a-[=b=]]/p\n"]) {
        assert.equal(analyzeHover(store.open(source), 3), undefined);
      }
      assert.equal(
        analyzeHover(store.open("/[a--]/p\n"), 3)?.documentation.title,
        "Range Expression",
      );
    });
  }
});

test("classifies an ordinary character without walking a long expression", {
  timeout: 2000,
}, async () => {
  const source = `/${"a".repeat(10_000)}/p\n`;
  await withAnalysisStore("ere", (store) => {
    const snapshot = store.open(source);
    const started = performance.now();
    assert.equal(analyzeHover(snapshot, 1), undefined);
    assert.ok(performance.now() - started < 250);
  });
});

test("omits ordinary, implementation-defined, and recovered BRE syntax", async () => {
  await withAnalysisStore("bre", (store) => {
    const repeatedAnchor = store.open("/^^/p\n");
    assert.notEqual(analyzeHover(repeatedAnchor, 1), undefined);
    assert.equal(analyzeHover(repeatedAnchor, 2), undefined);

    const implementationDefined = store.open("/a\\|b\\+c\\?/p\n");
    for (const spelling of ["\\|", "\\+", "\\?"]) {
      assert.equal(
        analyzeHover(
          implementationDefined,
          occurrence(implementationDefined.source, spelling).start,
        ),
        undefined,
      );
    }

    const adjacent = store.open("/a**/p\n");
    assert.notEqual(analyzeHover(adjacent, 2), undefined);
    assert.equal(analyzeHover(adjacent, 3), undefined);

    const ereStyleModifier = store.open("/a*?/p\n");
    assert.notEqual(analyzeHover(ereStyleModifier, 2), undefined);
    assert.equal(analyzeHover(ereStyleModifier, 3), undefined);

    const incompleteAddress = store.open("/^a*");
    assert.notEqual(analyzeHover(incompleteAddress, 1), undefined);
    assert.notEqual(analyzeHover(incompleteAddress, 3), undefined);

    for (const source of [
      "/\\{2\\}/p\n",
      "/a\\{2/p\n",
      "/\\(a/p\n",
      "/[abc/p\n",
    ]) {
      const snapshot = store.open(source);
      for (let offset = 1; offset < source.indexOf("/p"); offset += 1) {
        assert.equal(analyzeHover(snapshot, offset), undefined, source);
      }
    }
  });
});

test("describes every standard character class in both modes", async () => {
  const classes = [
    [
      "alnum",
      "Alphanumeric",
      "Represents letters and decimal digits in the current locale.",
    ],
    ["alpha", "Alphabetic", "Represents letters in the current locale."],
    [
      "blank",
      "Blank",
      "Represents blank characters in the current locale; in the POSIX locale, these are space and tab.",
    ],
    [
      "cntrl",
      "Control",
      "Represents control characters in the current locale.",
    ],
    [
      "digit",
      "Decimal Digit",
      "Represents exactly the decimal digits 0 through 9 in every locale.",
    ],
    [
      "graph",
      "Graphical",
      "Represents printable characters other than space in the current locale.",
    ],
    [
      "lower",
      "Lowercase",
      "Represents lowercase letters in the current locale.",
    ],
    [
      "print",
      "Printable",
      "Represents printable characters, including space, in the current locale.",
    ],
    [
      "punct",
      "Punctuation",
      "Represents punctuation characters in the current locale.",
    ],
    [
      "space",
      "White-Space",
      "Represents white-space characters; in the POSIX locale, these are space, tab, newline, carriage return, form feed, and vertical tab.",
    ],
    [
      "upper",
      "Uppercase",
      "Represents uppercase letters in the current locale.",
    ],
    [
      "xdigit",
      "Hexadecimal Digit",
      "Represents exactly 0 through 9, A through F, and a through f in every locale.",
    ],
  ];
  const source = `/[${classes.map(([name]) => `[:${name}:]`).join("")}]/p\n`;

  for (const mode of ["bre", "ere"]) {
    await withAnalysisStore(mode, (store) => {
      const snapshot = store.open(source);
      for (const [name, title, description] of classes) {
        const spelling = `[:${name}:]`;
        const range = occurrence(source, spelling);
        assertAnalysisHover(snapshot, range.start + 2, range, {
          title: `${title} Character Class`,
          synopsis: `[${spelling}]`,
          description,
        });
      }

      for (const name of ["custom", "DIGIT"]) {
        const customSource = `/[[:${name}:]]/p\n`;
        const custom = store.open(customSource);
        const range = occurrence(customSource, `[:${name}:]`);
        assertAnalysisHover(custom, range.start + 2, range, {
          title: "Character Class Expression",
          synopsis: "[[:class:]]",
          description:
            "Represents the set of characters belonging to this locale-defined character class.",
        });
      }
    });
  }
});

test("omits recovered ERE syntax and returns source offsets", async () => {
  await withAnalysisStore("ere", (store) => {
    for (const source of ["/{2}/p\n", "/a{2/p\n", "/(a/p\n", "/[abc/p\n"]) {
      const snapshot = store.open(source);
      for (let offset = 1; offset < source.indexOf("/p"); offset += 1) {
        assert.equal(analyzeHover(snapshot, offset), undefined, source);
      }
    }

    const adjacent = store.open("/a**/p\n");
    assert.notEqual(analyzeHover(adjacent, 2), undefined);
    assert.notEqual(analyzeHover(adjacent, 3), undefined);

    for (const [source, modifierOffset] of [
      ["/*?/p\n", 2],
      ["/a{2?/p\n", 4],
    ]) {
      assert.equal(
        analyzeHover(store.open(source), modifierOffset),
        undefined,
        source,
      );
    }

    assert.notEqual(analyzeHover(store.open("/a**?/p\n"), 4), undefined);

    const extraModifier = store.open("/a*??/p\n");
    assert.notEqual(analyzeHover(extraModifier, 3), undefined);
    assert.notEqual(analyzeHover(extraModifier, 4), undefined);

    const quotedBackreference = store.open("/\\1/p\n");
    assert.equal(analyzeHover(quotedBackreference, 1), undefined);
    assert.equal(analyzeHover(quotedBackreference, 2), undefined);

    const source = "s😺^.[[:digit:]]$😺x😺\n";
    const snapshot = store.open(source);
    const range = occurrence(source, "[:digit:]");
    assert.deepEqual(analyzeHover(snapshot, range.start + 2), {
      startOffset: range.start,
      endOffset: range.end,
      documentation: {
        display: "[:digit:]",
        title: "Decimal Digit Character Class",
        synopsis: "[[:digit:]]",
        description:
          "Represents exactly the decimal digits 0 through 9 in every locale.",
      },
    });

    const ordinary = occurrence(source, "x");
    assert.equal(analyzeHover(snapshot, ordinary.start), undefined);

    const controlled = store.open("/[[.a\tb.]]/p\n/[[:a\u202Eb:]]/p\n");
    const tabSymbol = occurrence(controlled.source, "[.a\tb.]");
    assert.deepEqual(
      analyzeHover(controlled, tabSymbol.start + 3)?.documentation,
      {
        display: "[.a<tab>b.]",
        title: "Collating Symbol",
        synopsis: "[[.element.]]",
        description:
          "Represents this collating element as a single bracket-expression element.",
      },
    );
    const directionalClass = occurrence(controlled.source, "[:a\u202Eb:]");
    assert.equal(
      analyzeHover(controlled, directionalClass.start + 3)?.documentation
        .display,
      "[:a<U+202E>b:]",
    );
  });
});

async function withSnapshot(mode, source, callback) {
  return withAnalysisStore(mode, (store) => callback(store.open(source)));
}

test("returns source-offset presentation-neutral Hover documentation", async () => {
  await withSnapshot("bre", "p\n", (snapshot) => {
    assert.deepEqual(analyze(snapshot, 0), {
      startOffset: 0,
      endOffset: 1,
      documentation: {
        display: "p",
        title: "Print",
        synopsis: "[address[,address]]p",
        description: "Writes the pattern space to standard output.",
      },
    });
    assert.equal(analyze(snapshot, 1), undefined);
  });
});

test("validates the public Hover offset", async () => {
  await withSnapshot("bre", "p\n", (snapshot) => {
    assert.throws(() => analyze(snapshot, 0.5), /must be an integer/);
    assert.throws(() => analyze(snapshot, -1), /outside the source/);
    assert.throws(() => analyze(snapshot, 3), /outside the source/);
  });
});

test("reuses one validated snapshot across repeated Hover requests", {
  timeout: 3000,
}, async () => {
  await withSnapshot("bre", "p\n".repeat(20_000), (snapshot) => {
    const expected = analyzeHover(snapshot, 0);
    for (let request = 0; request < 2000; request += 1) {
      assert.deepEqual(analyzeHover(snapshot, 0), expected);
    }
  });
});

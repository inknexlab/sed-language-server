import assert from "node:assert/strict";
import test from "node:test";
import { TextDocument } from "vscode-languageserver-textdocument";
import { createFormattingEdits } from "../src/formatting.js";

const posixBre = { dialect: "posix", regex: "bre" };
const gnuBre = { dialect: "gnu", regex: "bre" };
const gnuEre = { dialect: "gnu", regex: "ere" };
const spaces = { tabSize: 2, insertSpaces: true };

function documentFor(source) {
  return TextDocument.create("file:///formatting.sed", "sed", 1, source);
}

test("formats command separators and nested blocks without changing command content", () => {
  const source = "{s/a;b/c/g;p;{x;d}}\n";
  const expected = "{\n  s/a;b/c/g\n  p\n  {\n    x\n    d\n  }\n}\n";

  assert.deepEqual(createFormattingEdits(documentFor(source), gnuBre, spaces), [
    {
      range: {
        start: { line: 0, character: 0 },
        end: { line: 1, character: 0 },
      },
      newText: expected,
    },
  ]);
  assert.deepEqual(
    createFormattingEdits(documentFor(expected), gnuBre, spaces),
    [],
  );
});

test("formats a script containing ERE operators", () => {
  assert.deepEqual(
    createFormattingEdits(documentFor("{s/(a)+/\\1/;p}\n"), gnuEre, spaces),
    [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 1, character: 0 },
        },
        newText: "{\n  s/(a)+/\\1/\n  p\n}\n",
      },
    ],
  );
});

test("uses client indentation and preserves multiline command arguments and CRLF", () => {
  const source = "{\r\n  a\\\r\n  keep  \r\n  p\r\n}\r\n";

  assert.deepEqual(
    createFormattingEdits(documentFor(source), posixBre, {
      tabSize: 8,
      insertSpaces: false,
    }),
    [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 5, character: 0 },
        },
        newText: "{\r\n\ta\\\r\n  keep  \r\n\tp\r\n}\r\n",
      },
    ],
  );
});

test("does not format scripts with exposed or hidden syntax errors", () => {
  assert.deepEqual(
    createFormattingEdits(documentFor("1,\n"), posixBre, spaces),
    [],
  );
  assert.deepEqual(
    createFormattingEdits(documentFor("d;a"), gnuBre, spaces),
    [],
  );
});

test("preserves first-line #n output suppression semantics", () => {
  assert.deepEqual(
    createFormattingEdits(documentFor("\n#n\n{p;d;}\n"), posixBre, spaces),
    [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 3, character: 0 },
        },
        newText: "\n#n\n{\n  p\n  d\n}\n",
      },
    ],
  );
  assert.deepEqual(
    createFormattingEdits(documentFor(" #n\n{p;d;}\n"), posixBre, spaces),
    [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 2, character: 0 },
        },
        newText: " #n\n{\n  p\n  d\n}\n",
      },
    ],
  );
  assert.deepEqual(
    createFormattingEdits(documentFor("#n\n{p;d;}\n"), posixBre, spaces),
    [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 2, character: 0 },
        },
        newText: "#n\n{\n  p\n  d\n}\n",
      },
    ],
  );
});

test("preserves blank lines while formatting commands", () => {
  const source = "{\n\np\n\n# section\n\nd\n\n}\n";
  const expected = "{\n\n  p\n\n  # section\n\n  d\n\n}\n";

  assert.deepEqual(
    createFormattingEdits(documentFor(source), posixBre, spaces),
    [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 9, character: 0 },
        },
        newText: expected,
      },
    ],
  );
  assert.deepEqual(
    createFormattingEdits(documentFor(expected), posixBre, spaces),
    [],
  );
});

test("keeps a separator when formatting an empty block", () => {
  assert.deepEqual(
    createFormattingEdits(documentFor("{;}\n"), posixBre, spaces),
    [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 1, character: 0 },
        },
        newText: "{\n}\n",
      },
    ],
  );
});

test("formats a compact GNU label before a closing brace", () => {
  assert.deepEqual(
    createFormattingEdits(documentFor("{:target}\n"), gnuBre, spaces),
    [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 1, character: 0 },
        },
        newText: "{\n  :target\n}\n",
      },
    ],
  );
});

test("declines excessively nested blocks without overflowing", () => {
  const source = `${"{".repeat(2000)}p${"}".repeat(2000)}`;

  assert.deepEqual(
    createFormattingEdits(documentFor(source), gnuBre, spaces),
    [],
  );
});

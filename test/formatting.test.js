import assert from "node:assert/strict";
import test from "node:test";
import { TextDocument } from "vscode-languageserver-textdocument";
import { createFormattingEdits } from "../src/formatting.js";

const posixDialect = "posix";
const gnuDialect = "gnu";
const spaces = { tabSize: 2, insertSpaces: true };

function documentFor(source) {
  return TextDocument.create("file:///formatting.sed", "sed", 1, source);
}

test("formats command separators and nested blocks without changing command content", () => {
  const source = "{s/a;b/c/g;p;{x;d}}\n";
  const expected = "{\n  s/a;b/c/g\n  p\n  {\n    x\n    d\n  }\n}\n";

  assert.deepEqual(
    createFormattingEdits(documentFor(source), gnuDialect, spaces),
    [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 1, character: 0 },
        },
        newText: expected,
      },
    ],
  );
  assert.deepEqual(
    createFormattingEdits(documentFor(expected), gnuDialect, spaces),
    [],
  );
});

test("uses client indentation and preserves multiline command arguments and CRLF", () => {
  const source = "{\r\n  a\\\r\n  keep  \r\n  p\r\n}\r\n";

  assert.deepEqual(
    createFormattingEdits(documentFor(source), posixDialect, {
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
    createFormattingEdits(documentFor("1,\n"), posixDialect, spaces),
    [],
  );
  assert.deepEqual(
    createFormattingEdits(documentFor("d;a"), gnuDialect, spaces),
    [],
  );
});

test("preserves first-line #n output suppression semantics", () => {
  assert.deepEqual(
    createFormattingEdits(documentFor("\n#n\n{p;d;}\n"), posixDialect, spaces),
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
    createFormattingEdits(documentFor(" #n\n{p;d;}\n"), posixDialect, spaces),
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
    createFormattingEdits(documentFor("#n\n{p;d;}\n"), posixDialect, spaces),
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
    createFormattingEdits(documentFor(source), posixDialect, spaces),
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
    createFormattingEdits(documentFor(expected), posixDialect, spaces),
    [],
  );
});

test("keeps a separator when formatting an empty block", () => {
  assert.deepEqual(
    createFormattingEdits(documentFor("{;}\n"), posixDialect, spaces),
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

import assert from "node:assert/strict";
import test from "node:test";
import { TextDocument } from "vscode-languageserver-textdocument";
import { createReferenceLocations } from "../src/references.js";

const posixBre = { dialect: "posix", regex: "bre" };
const gnuBre = { dialect: "gnu", regex: "bre" };

function documentFor(source) {
  return TextDocument.create("file:///references.sed", "sed", 1, source);
}

test("finds label references and honors declaration inclusion", () => {
  const document = documentFor(":target\nb target\nt target\n");

  assert.deepEqual(
    createReferenceLocations(document, { line: 0, character: 3 }, posixBre, {
      includeDeclaration: false,
    }),
    [
      {
        uri: document.uri,
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 8 },
        },
      },
      {
        uri: document.uri,
        range: {
          start: { line: 2, character: 2 },
          end: { line: 2, character: 8 },
        },
      },
    ],
  );

  assert.deepEqual(
    createReferenceLocations(document, { line: 1, character: 4 }, posixBre, {
      includeDeclaration: true,
    }),
    [
      {
        uri: document.uri,
        range: {
          start: { line: 0, character: 1 },
          end: { line: 0, character: 7 },
        },
      },
      {
        uri: document.uri,
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 8 },
        },
      },
      {
        uri: document.uri,
        range: {
          start: { line: 2, character: 2 },
          end: { line: 2, character: 8 },
        },
      },
    ],
  );
});

test("returns an empty list when a declaration has no references", () => {
  const document = documentFor(":target\n");

  assert.deepEqual(
    createReferenceLocations(document, { line: 0, character: 3 }, posixBre, {
      includeDeclaration: false,
    }),
    [],
  );
});

test("uses the selected grammar and only searches from label positions", () => {
  const document = documentFor(":target\nTtarget\np\n");

  assert.deepEqual(
    createReferenceLocations(document, { line: 1, character: 3 }, gnuBre, {
      includeDeclaration: false,
    }),
    [
      {
        uri: document.uri,
        range: {
          start: { line: 1, character: 1 },
          end: { line: 1, character: 7 },
        },
      },
    ],
  );
  assert.equal(
    createReferenceLocations(document, { line: 1, character: 3 }, posixBre, {
      includeDeclaration: false,
    }),
    null,
  );
  assert.equal(
    createReferenceLocations(document, { line: 2, character: 0 }, gnuBre, {
      includeDeclaration: true,
    }),
    null,
  );
});

test("returns UTF-16 ranges when the cursor follows a Unicode label", () => {
  const document = documentFor(":😀\r\nb 😀\r\n");

  assert.deepEqual(
    createReferenceLocations(document, { line: 1, character: 4 }, posixBre, {
      includeDeclaration: true,
    }),
    [
      {
        uri: document.uri,
        range: {
          start: { line: 0, character: 1 },
          end: { line: 0, character: 3 },
        },
      },
      {
        uri: document.uri,
        range: {
          start: { line: 1, character: 2 },
          end: { line: 1, character: 4 },
        },
      },
    ],
  );
});

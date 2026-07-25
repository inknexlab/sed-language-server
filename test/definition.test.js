import assert from "node:assert/strict";
import test from "node:test";
import { TextDocument } from "vscode-languageserver-textdocument";
import { createDefinitionLocations } from "../src/definition.js";

const posixDialect = "posix";
const gnuDialect = "gnu";

function documentFor(source) {
  return TextDocument.create("file:///definition.sed", "sed", 1, source);
}

test("resolves a label reference to every matching definition", () => {
  const document = documentFor(":target\n:other\n:target\nb target\n");

  assert.deepEqual(
    createDefinitionLocations(
      document,
      { line: 3, character: 4 },
      posixDialect,
    ),
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
          start: { line: 2, character: 1 },
          end: { line: 2, character: 7 },
        },
      },
    ],
  );
});

test("uses the selected grammar and only resolves label-reference positions", () => {
  const document = documentFor(":target\nTtarget\n");

  assert.deepEqual(
    createDefinitionLocations(document, { line: 1, character: 3 }, gnuDialect),
    [
      {
        uri: document.uri,
        range: {
          start: { line: 0, character: 1 },
          end: { line: 0, character: 7 },
        },
      },
    ],
  );
  assert.equal(
    createDefinitionLocations(
      document,
      { line: 1, character: 3 },
      posixDialect,
    ),
    null,
  );
  assert.equal(
    createDefinitionLocations(document, { line: 1, character: 0 }, gnuDialect),
    null,
  );
  assert.equal(
    createDefinitionLocations(
      documentFor(":target\nb missing\n"),
      { line: 1, character: 4 },
      posixDialect,
    ),
    null,
  );
});

test("resolves a label when the cursor is immediately after its name", () => {
  const document = documentFor(":target\nb target\np\n");

  assert.deepEqual(
    createDefinitionLocations(
      document,
      { line: 1, character: 8 },
      posixDialect,
    ),
    [
      {
        uri: document.uri,
        range: {
          start: { line: 0, character: 1 },
          end: { line: 0, character: 7 },
        },
      },
    ],
  );
  assert.equal(
    createDefinitionLocations(
      document,
      { line: 2, character: 0 },
      posixDialect,
    ),
    null,
  );
});

test("returns UTF-16 definition ranges across CRLF lines", () => {
  const document = documentFor(":😀\r\nb 😀\r\n");

  assert.deepEqual(
    createDefinitionLocations(
      document,
      { line: 1, character: 3 },
      posixDialect,
    ),
    [
      {
        uri: document.uri,
        range: {
          start: { line: 0, character: 1 },
          end: { line: 0, character: 3 },
        },
      },
    ],
  );
});

test("resolves definitions in a large flat script without overflowing", () => {
  const document = documentFor(`:target\nb target\n${"p\n".repeat(70_000)}`);

  assert.deepEqual(
    createDefinitionLocations(
      document,
      { line: 1, character: 4 },
      posixDialect,
    ),
    [
      {
        uri: document.uri,
        range: {
          start: { line: 0, character: 1 },
          end: { line: 0, character: 7 },
        },
      },
    ],
  );
});

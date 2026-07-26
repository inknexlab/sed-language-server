import assert from "node:assert/strict";
import test from "node:test";
import { ErrorCodes } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  createRenameWorkspaceEdit,
  prepareLabelRename,
} from "../src/rename.js";

const posixBre = { dialect: "posix", regex: "bre" };
const gnuBre = { dialect: "gnu", regex: "bre" };

function documentFor(source) {
  return TextDocument.create("file:///rename.sed", "sed", 1, source);
}

function assertInvalidRename(document, newName, syntax) {
  assert.throws(
    () =>
      createRenameWorkspaceEdit(
        document,
        { line: 0, character: 3 },
        syntax,
        newName,
      ),
    (error) => {
      assert.equal(error.code, ErrorCodes.InvalidParams);
      assert.match(error.message, /valid .* sed label/);
      return true;
    },
  );
}

test("prepares label renames from definitions and references", () => {
  const document = documentFor(":target\nb target\np\n");

  assert.deepEqual(
    prepareLabelRename(document, { line: 0, character: 3 }, posixBre),
    {
      start: { line: 0, character: 1 },
      end: { line: 0, character: 7 },
    },
  );
  assert.deepEqual(
    prepareLabelRename(document, { line: 1, character: 4 }, posixBre),
    {
      start: { line: 1, character: 2 },
      end: { line: 1, character: 8 },
    },
  );
  assert.equal(
    prepareLabelRename(document, { line: 2, character: 0 }, posixBre),
    null,
  );
});

test("renames matching label definitions and references in document order", () => {
  const document = documentFor(
    ":target\nb target\n:other\nt target\nb other\n",
  );

  assert.deepEqual(
    createRenameWorkspaceEdit(
      document,
      { line: 1, character: 4 },
      posixBre,
      "renamed",
    ),
    {
      changes: {
        [document.uri]: [
          {
            range: {
              start: { line: 0, character: 1 },
              end: { line: 0, character: 7 },
            },
            newText: "renamed",
          },
          {
            range: {
              start: { line: 1, character: 2 },
              end: { line: 1, character: 8 },
            },
            newText: "renamed",
          },
          {
            range: {
              start: { line: 3, character: 2 },
              end: { line: 3, character: 8 },
            },
            newText: "renamed",
          },
        ],
      },
    },
  );
});

test("renames GNU labels before comments and closing braces", () => {
  const document = documentFor("{:target # definition\nb target}");

  assert.deepEqual(
    createRenameWorkspaceEdit(
      document,
      { line: 1, character: 4 },
      gnuBre,
      "next",
    ),
    {
      changes: {
        [document.uri]: [
          {
            range: {
              start: { line: 0, character: 2 },
              end: { line: 0, character: 8 },
            },
            newText: "next",
          },
          {
            range: {
              start: { line: 1, character: 2 },
              end: { line: 1, character: 8 },
            },
            newText: "next",
          },
        ],
      },
    },
  );
});

test("rejects invalid label names for the selected syntax", () => {
  const document = documentFor(":target\nb target\n");

  assertInvalidRename(document, "", posixBre);
  assertInvalidRename(document, " new", posixBre);
  assertInvalidRename(document, "new\nname", posixBre);
  assertInvalidRename(document, "new ", gnuBre);
  assertInvalidRename(document, "new;name", gnuBre);
  assertInvalidRename(document, "new#name", gnuBre);
  assertInvalidRename(document, "new}name", gnuBre);
});

test("accepts a trailing blank in a POSIX label name", () => {
  const document = documentFor(":target\nb target\n");
  const edit = createRenameWorkspaceEdit(
    document,
    { line: 0, character: 3 },
    posixBre,
    "new ",
  );

  assert.deepEqual(
    edit.changes[document.uri].map(({ newText }) => newText),
    ["new ", "new "],
  );
});

test("rejects a rename to an existing label definition", () => {
  const document = documentFor(":target\nb target\n:other\nb other\n");

  assert.throws(
    () =>
      createRenameWorkspaceEdit(
        document,
        { line: 0, character: 3 },
        posixBre,
        "other",
      ),
    (error) => {
      assert.equal(error.code, ErrorCodes.InvalidParams);
      assert.match(error.message, /already defined/);
      return true;
    },
  );
});

test("only renames when the cursor selects a label", () => {
  const document = documentFor(":target\np\n");

  assert.equal(
    createRenameWorkspaceEdit(
      document,
      { line: 1, character: 0 },
      posixBre,
      "renamed",
    ),
    null,
  );
});

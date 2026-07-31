import assert from "node:assert/strict";
import test from "node:test";
import { TextDocument } from "vscode-languageserver-textdocument";
import { formattingEdits } from "../src/formatting.js";
import { SyntaxStore } from "../src/syntax.js";
import { documentFor } from "./support.js";

async function format(source, mode = "bre", options = {}) {
  const store = await SyntaxStore.create(mode);
  try {
    const snapshot = store.open(documentFor(source));
    const edits = formattingEdits(snapshot, options);
    return {
      edits,
      text:
        edits.length === 0
          ? source
          : TextDocument.applyEdits(snapshot.document, edits),
    };
  } finally {
    store.dispose();
  }
}

test("puts each command on a line and indents nested blocks", async () => {
  const source = "  1,2{;p;s/a/b/g;\n\n};q;p";
  const { text } = await format(source, "bre", {
    insertSpaces: true,
    tabSize: 2,
  });
  assert.equal(text, "1,2{\n  p\n  s/a/b/g\n\n}\nq\np\n");
});

test("uses tabs when the client requests tab indentation", async () => {
  const { text } = await format("{\n{\np\n}\n}\n", "ere", {
    insertSpaces: false,
    tabSize: 8,
  });
  assert.equal(text, "{\n\t{\n\t\tp\n\t}\n}\n");
});

test("preserves leading, interior, and trailing blank lines", async () => {
  const { text } = await format("\n\n p\n\n{\n\nq\n\n}\n\n");
  assert.equal(text, "\n\np\n\n{\n\n  q\n\n}\n\n");
});

test("does not rewrite multiline text payloads", async () => {
  const source = "  a\\\n  first\\\n second\n p";
  const { text } = await format(source);
  assert.equal(text, "a\\\n  first\\\n second\np\n");
});

test("does not rewrite escaped newlines inside a replacement", async () => {
  const source = " s/a/first\\\n second/;p";
  const { text } = await format(source);
  assert.equal(text, "s/a/first\\\n second/\np\n");
});

test("preserves the special meaning of an initial #n comment", async () => {
  assert.equal((await format("#n\n p;p")).text, "#n\np\np\n");
  assert.equal((await format(";#n\np")).text, " #n\np\n");
});

test("formats warning-bearing syntax but not structural errors", async () => {
  assert.equal((await format("/a**/p;p")).text, "/a**/p\np\n");
  for (const source of ["r\n", "p tail\n", "\0"]) {
    const result = await format(source);
    assert.deepEqual(result.edits, [], JSON.stringify(source));
    assert.equal(result.text, source);
  }
});

test("is idempotent in both regular-expression modes", async () => {
  const source = "1,2{\n  p\n\n  s/a/b/g\n}\n";
  for (const mode of ["bre", "ere"]) {
    const first = await format(source, mode, {
      insertSpaces: true,
      tabSize: 2,
    });
    assert.equal(first.text, source);
    assert.deepEqual(first.edits, []);
  }
});

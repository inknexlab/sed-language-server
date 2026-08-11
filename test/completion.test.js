import assert from "node:assert/strict";
import test from "node:test";
import { CompletionItemKind, MarkupKind } from "vscode-languageserver";
import { completionItems } from "../src/completion.js";
import { SyntaxStore } from "../src/parser.js";
import { documentFor } from "./helpers.js";

async function withSnapshot(source, callback) {
  const store = await SyntaxStore.create("bre");
  try {
    return callback(store.open(documentFor(source)));
  } finally {
    store.dispose();
  }
}

test("maps command completions to LSP items and negotiated documentation", async () => {
  await withSnapshot("", (snapshot) => {
    const position = { line: 0, character: 0 };
    const markdown = completionItems(
      snapshot,
      position,
      MarkupKind.Markdown,
    ).find(({ label }) => label === "p");
    assert.deepEqual(markdown, {
      label: "p",
      kind: CompletionItemKind.Keyword,
      detail: "Print",
      documentation: {
        kind: MarkupKind.Markdown,
        value:
          "```sed\n[address[,address]]p\n```\n\nWrites the pattern space to standard output.",
      },
      textEdit: { range: { start: position, end: position }, newText: "p" },
    });

    const legacy = completionItems(snapshot, position, null).find(
      ({ label }) => label === "p",
    );
    assert.equal(
      legacy.documentation,
      "[address[,address]]p\n\nWrites the pattern space to standard output.",
    );
  });
});

test("maps source offsets and label categories to UTF-16 LSP ranges", async () => {
  await withSnapshot(":😀label\nb 😀pa\n", (snapshot) => {
    assert.deepEqual(
      completionItems(snapshot, { line: 1, character: 4 }, MarkupKind.Markdown),
      [
        {
          label: "😀label",
          kind: CompletionItemKind.Reference,
          textEdit: {
            range: {
              start: { line: 1, character: 2 },
              end: { line: 1, character: 6 },
            },
            newText: "😀label",
          },
        },
      ],
    );
  });
});

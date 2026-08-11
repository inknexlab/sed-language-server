import assert from "node:assert/strict";
import test from "node:test";
import { MarkupKind } from "vscode-languageserver";
import { hover } from "../src/hover.js";
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

test("maps Hover content and source offsets to negotiated LSP values", async () => {
  await withSnapshot("a\\\ntext\n", (snapshot) => {
    const position = { line: 0, character: 0 };
    assert.deepEqual(hover(snapshot, position, MarkupKind.PlainText), {
      contents: {
        kind: MarkupKind.PlainText,
        value:
          "a — Append Text\n\n[address]a\\\ntext\n\nSchedules text for standard output before the next input fetch, before q, or at the end of the script.",
      },
      range: {
        start: position,
        end: { line: 0, character: 1 },
      },
    });
    assert.equal(
      hover(snapshot, position, null).contents,
      "### `a` — Append Text\n\n```sed\n[address]a\\\ntext\n```\n\nSchedules text for standard output before the next input fetch, before q, or at the end of the script.",
    );
  });
});

test("maps astral source offsets to UTF-16 Hover ranges", async () => {
  await withSnapshot("s/😀/x/g", (snapshot) => {
    assert.deepEqual(
      hover(snapshot, { line: 0, character: 7 }, MarkupKind.Markdown)?.range,
      {
        start: { line: 0, character: 7 },
        end: { line: 0, character: 8 },
      },
    );
  });
});

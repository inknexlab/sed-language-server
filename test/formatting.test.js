import assert from "node:assert/strict";
import test from "node:test";
import { formattingEdits } from "../src/formatting.js";
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

test("maps formatted source to one full-document LSP edit", async () => {
  await withSnapshot("p;#😀", (snapshot) => {
    assert.deepEqual(formattingEdits(snapshot, {}), [
      {
        range: {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 5 },
        },
        newText: "p\n#😀\n",
      },
    ]);
  });
});

test("returns no LSP edit when analysis leaves the source unchanged", async () => {
  await withSnapshot("p\n", (snapshot) => {
    assert.deepEqual(formattingEdits(snapshot, {}), []);
  });
});

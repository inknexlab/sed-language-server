import assert from "node:assert/strict";
import test from "node:test";
import { SyntaxStore } from "../src/parser.js";
import { definitions, references } from "../src/symbols.js";
import { documentFor } from "./helpers.js";

test("maps symbol offsets to URI-bearing UTF-16 LSP locations", async () => {
  const store = await SyntaxStore.create("bre");
  try {
    const snapshot = store.open(documentFor(":😀\nb 😀\n"));
    const definition = {
      uri: snapshot.document.uri,
      range: {
        start: { line: 0, character: 1 },
        end: { line: 0, character: 3 },
      },
    };
    const reference = {
      uri: snapshot.document.uri,
      range: {
        start: { line: 1, character: 2 },
        end: { line: 1, character: 4 },
      },
    };
    assert.deepEqual(definitions(snapshot, { line: 1, character: 3 }), [
      definition,
    ]);
    assert.deepEqual(references(snapshot, { line: 0, character: 2 }), [
      reference,
    ]);
    assert.deepEqual(references(snapshot, { line: 0, character: 2 }, true), [
      definition,
      reference,
    ]);
    assert.deepEqual(definitions(snapshot, { line: 1, character: 0 }), []);
    assert.deepEqual(references(snapshot, { line: 1, character: 0 }), []);
  } finally {
    store.dispose();
  }
});

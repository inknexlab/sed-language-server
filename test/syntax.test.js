import assert from "node:assert/strict";
import test from "node:test";
import { TextDocument } from "vscode-languageserver-textdocument";
import { SyntaxStore } from "../src/syntax.js";
import { documentFor, serializeNode } from "./support.js";

async function assertIncrementalMatchesFull({ mode, source, changes }) {
  const incrementalStore = await SyntaxStore.create(mode);
  const fullStore = await SyntaxStore.create(mode);
  try {
    const document = documentFor(source);
    incrementalStore.open(document);
    const updated = incrementalStore.update(document.uri, changes, 2);
    const fullDocument = TextDocument.update(documentFor(source), changes, 2);
    fullStore.open(fullDocument);
    assert.equal(updated.document.getText(), fullDocument.getText());
    assert.deepEqual(
      serializeNode(incrementalStore.snapshot(document.uri, 2).tree.rootNode),
      serializeNode(fullStore.snapshot(fullDocument.uri, 2).tree.rootNode),
    );
  } finally {
    incrementalStore.dispose();
    fullStore.dispose();
  }
}

test("applies sequential LSP changes incrementally in both modes", async () => {
  for (const mode of ["bre", "ere"]) {
    await assertIncrementalMatchesFull({
      mode,
      source: "s/a/b/g\np\n",
      changes: [
        {
          range: {
            start: { line: 0, character: 2 },
            end: { line: 0, character: 3 },
          },
          text: "[ab]",
        },
        {
          range: {
            start: { line: 1, character: 0 },
            end: { line: 1, character: 1 },
          },
          text: "1,2d",
        },
      ],
    });
  }
});

test("incremental parsing preserves Unicode and scanner state", async () => {
  for (const mode of ["bre", "ere"]) {
    await assertIncrementalMatchesFull({
      mode,
      source: ":😀\ns|a\\|b|c|\nb 😀\n",
      changes: [
        {
          range: {
            start: { line: 1, character: 2 },
            end: { line: 1, character: 6 },
          },
          text: "[a|]",
        },
        {
          range: {
            start: { line: 2, character: 2 },
            end: { line: 2, character: 4 },
          },
          text: "終",
        },
      ],
    });
  }
});

test("incremental parsing matches full parsing across recovery", async () => {
  for (const mode of ["bre", "ere"]) {
    await assertIncrementalMatchesFull({
      mode,
      source: "s/a/b\np\n",
      changes: [
        {
          range: {
            start: { line: 0, character: 5 },
            end: { line: 0, character: 5 },
          },
          text: "/",
        },
      ],
    });
  }
});

test("supports full-document replacement and versioned snapshots", async () => {
  const store = await SyntaxStore.create("bre");
  try {
    const document = documentFor("p\n", 4);
    store.open(document);
    const updated = store.update(document.uri, [{ text: "1,2d\n" }], 5);
    assert.equal(updated.document.getText(), "1,2d\n");
    assert.equal(store.snapshot(document.uri, 4), undefined);
    assert.equal(store.snapshot(document.uri, 5)?.document, updated.document);
    store.close(document.uri);
    assert.equal(store.snapshot(document.uri), undefined);
  } finally {
    store.dispose();
  }
});

test("keeps the previous snapshot when an update cannot be applied", async () => {
  const store = await SyntaxStore.create("bre");
  try {
    const document = documentFor("p\n", 4);
    const snapshot = store.open(document);
    assert.throws(() => store.update(document.uri, undefined, 5), TypeError);
    const retained = store.snapshot(document.uri, 4);
    assert.equal(retained?.document, snapshot.document);
    assert.equal(retained?.tree, snapshot.tree);
  } finally {
    store.dispose();
  }
});

test("rejects unsupported modes and use after disposal", async () => {
  await assert.rejects(
    SyntaxStore.create("other"),
    /Unsupported regular expression mode/,
  );
  const store = await SyntaxStore.create("bre");
  store.dispose();
  assert.throws(() => store.snapshot("file:///closed.sed"), /disposed/);
});

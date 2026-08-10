import assert from "node:assert/strict";
import test from "node:test";
import { definitions, references } from "../src/labels.js";
import { SyntaxStore } from "../src/parser.js";
import { documentFor } from "./helpers.js";

async function withSnapshot(mode, source, callback) {
  const store = await SyntaxStore.create(mode);
  try {
    return callback(store.open(documentFor(source)));
  } finally {
    store.dispose();
  }
}

test("finds every matching definition from a definition or reference", async () => {
  for (const mode of ["bre", "ere"]) {
    await withSnapshot(mode, ":target\nb target\n:target\n", (snapshot) => {
      const expected = [
        {
          uri: snapshot.document.uri,
          range: {
            start: { line: 0, character: 1 },
            end: { line: 0, character: 7 },
          },
        },
        {
          uri: snapshot.document.uri,
          range: {
            start: { line: 2, character: 1 },
            end: { line: 2, character: 7 },
          },
        },
      ];
      assert.deepEqual(
        definitions(snapshot, { line: 1, character: 3 }),
        expected,
      );
      assert.deepEqual(
        definitions(snapshot, { line: 0, character: 7 }),
        expected,
      );
    });
  }
});

test("does not link labels that differ by a trailing carriage return", async () => {
  await withSnapshot("bre", ":target\r\nb target\n", (snapshot) => {
    assert.deepEqual(definitions(snapshot, { line: 1, character: 3 }), []);
  });
});

test("returns references in document order and honors includeDeclaration", async () => {
  await withSnapshot("bre", ":outer\n{\nb outer\nt outer\n}\n", (snapshot) => {
    assert.deepEqual(
      references(snapshot, { line: 0, character: 2 }, false).map(
        ({ range }) => range.start,
      ),
      [
        { line: 2, character: 2 },
        { line: 3, character: 2 },
      ],
    );
    assert.deepEqual(
      references(snapshot, { line: 2, character: 3 }, true).map(
        ({ range }) => range.start,
      ),
      [
        { line: 0, character: 1 },
        { line: 2, character: 2 },
        { line: 3, character: 2 },
      ],
    );
  });
});

test("does not treat an omitted branch target as a label", async () => {
  await withSnapshot("bre", "b\nt\n", (snapshot) => {
    assert.deepEqual(definitions(snapshot, { line: 1, character: 1 }), []);
  });
});

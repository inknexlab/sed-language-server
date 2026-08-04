import assert from "node:assert/strict";
import test from "node:test";
import {
  definitions,
  prepareRename,
  RenameError,
  references,
  rename,
} from "../src/labels.js";
import { SyntaxStore } from "../src/parser.js";
import { documentFor } from "./support.js";

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

test("accepts the cursor immediately after a label", async () => {
  await withSnapshot("bre", ":名前\nb 名前\n", (snapshot) => {
    assert.deepEqual(prepareRename(snapshot, { line: 0, character: 3 }), {
      range: {
        start: { line: 0, character: 1 },
        end: { line: 0, character: 3 },
      },
      placeholder: "名前",
    });
    assert.deepEqual(prepareRename(snapshot, { line: 1, character: 4 }), {
      range: {
        start: { line: 1, character: 2 },
        end: { line: 1, character: 4 },
      },
      placeholder: "名前",
    });
  });
});

test("does not treat an omitted branch target as a label", async () => {
  await withSnapshot("bre", "b\nt\n", (snapshot) => {
    assert.equal(prepareRename(snapshot, { line: 0, character: 1 }), undefined);
    assert.deepEqual(definitions(snapshot, { line: 1, character: 1 }), []);
  });
});

test("renames every matching symbol with ordered non-overlapping edits", async () => {
  await withSnapshot("ere", ":old\nb old\nt old\n", (snapshot) => {
    assert.deepEqual(
      rename(snapshot, { line: 1, character: 3 }, "new; value "),
      {
        changes: {
          [snapshot.document.uri]: [
            {
              range: {
                start: { line: 0, character: 1 },
                end: { line: 0, character: 4 },
              },
              newText: "new; value ",
            },
            {
              range: {
                start: { line: 1, character: 2 },
                end: { line: 1, character: 5 },
              },
              newText: "new; value ",
            },
            {
              range: {
                start: { line: 2, character: 2 },
                end: { line: 2, character: 5 },
              },
              newText: "new; value ",
            },
          ],
        },
      },
    );
  });
});

test("rejects names that cannot be one grammar label", async () => {
  await withSnapshot("bre", ":old\n", (snapshot) => {
    const position = { line: 0, character: 2 };
    for (const name of ["", "\0", "a\rb", "a\nb", " leading", "\tleading"]) {
      assert.throws(
        () => rename(snapshot, position, name),
        RenameError,
        JSON.stringify(name),
      );
    }
  });
});

test("rejects collisions with another definition", async () => {
  await withSnapshot("bre", ":old\n:new\nb old\n", (snapshot) => {
    assert.throws(
      () => rename(snapshot, { line: 2, character: 3 }, "new"),
      /already defined/,
    );
    assert.throws(
      () => rename(snapshot, { line: 0, character: 0 }, "name"),
      /not on a sed label/,
    );
  });
});

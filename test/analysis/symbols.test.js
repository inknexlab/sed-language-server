import assert from "node:assert/strict";
import test from "node:test";
import { definitions, references } from "../../src/analysis/symbols.js";
import { offsetAt, withAnalysisSnapshot } from "./helpers.js";

async function withSnapshot(mode, source, callback) {
  return withAnalysisSnapshot(mode, source, callback);
}

test("finds every matching definition from a definition or reference", async () => {
  for (const mode of ["bre", "ere"]) {
    await withSnapshot(mode, ":target\nb target\n:target\n", (snapshot) => {
      const expected = [
        { startOffset: 1, endOffset: 7 },
        { startOffset: 18, endOffset: 24 },
      ];
      assert.deepEqual(
        definitions(
          snapshot,
          offsetAt(snapshot.source, { line: 1, character: 3 }),
        ),
        expected,
      );
      assert.deepEqual(
        definitions(
          snapshot,
          offsetAt(snapshot.source, { line: 0, character: 7 }),
        ),
        expected,
      );
    });
  }
});

test("does not link labels that differ by a trailing carriage return", async () => {
  await withSnapshot("bre", ":target\r\nb target\n", (snapshot) => {
    assert.deepEqual(
      definitions(
        snapshot,
        offsetAt(snapshot.source, { line: 1, character: 3 }),
      ),
      [],
    );
  });
});

test("returns references in document order and honors includeDeclaration", async () => {
  await withSnapshot("bre", ":outer\n{\nb outer\nt outer\n}\n", (snapshot) => {
    assert.deepEqual(
      references(
        snapshot,
        offsetAt(snapshot.source, { line: 0, character: 2 }),
        false,
      ),
      [
        { startOffset: 11, endOffset: 16 },
        { startOffset: 19, endOffset: 24 },
      ],
    );
    assert.deepEqual(
      references(
        snapshot,
        offsetAt(snapshot.source, { line: 2, character: 3 }),
        true,
      ),
      [
        { startOffset: 1, endOffset: 6 },
        { startOffset: 11, endOffset: 16 },
        { startOffset: 19, endOffset: 24 },
      ],
    );
  });
});

test("does not treat an omitted branch target as a label", async () => {
  await withSnapshot("bre", "b\nt\n", (snapshot) => {
    assert.deepEqual(
      definitions(
        snapshot,
        offsetAt(snapshot.source, { line: 1, character: 1 }),
      ),
      [],
    );
  });
});

test("validates public symbol query arguments", async () => {
  await withSnapshot("bre", ":target\nb target\n", (snapshot) => {
    assert.throws(() => definitions(snapshot, 0.5), /must be an integer/);
    assert.throws(
      () => references(snapshot, 11, "yes"),
      /includeDeclaration must be a boolean/,
    );
  });
});

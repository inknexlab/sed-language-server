import assert from "node:assert/strict";
import test from "node:test";
import { SedAnalysis } from "@inknexlab/sed-language-server/analysis";
import { DocumentStore } from "../../src/lsp/documents.js";
import { documentFor } from "../support.js";

async function withStore(run, mode = "bre") {
  const analysis = await SedAnalysis.create(mode);
  const store = new DocumentStore(analysis);
  try {
    return await run(store, analysis);
  } finally {
    store.dispose();
    await analysis.dispose();
  }
}

test("applies sequential LSP edits against each intermediate UTF-16 document", async () => {
  for (const mode of ["bre", "ere"]) {
    await withStore((store) => {
      const document = documentFor("s/😀x/y/\n");
      store.open(document);
      const updated = store.update(
        document.uri,
        [
          {
            range: {
              end: { character: 5, line: 0 },
              start: { character: 4, line: 0 },
            },
            text: "犬cat",
          },
          {
            range: {
              end: { character: 8, line: 0 },
              start: { character: 5, line: 0 },
            },
            text: "dog",
          },
        ],
        2,
      );
      assert.equal(updated.getText(), "s/😀犬dog/y/\n", mode);
      const lease = store.acquire(document.uri);
      assert.notEqual(lease, undefined);
      assert.equal(lease.snapshot.source, updated.getText());
      lease.dispose();
    }, mode);
  }
});

test("canonicalizes CRLF positions before later UTF-16 edits", async () => {
  await withStore((store) => {
    const document = documentFor("p\rq 😀x\n");
    store.open(document);
    const updated = store.update(
      document.uri,
      [
        {
          range: {
            end: { character: 0, line: 1 },
            start: { character: 0, line: 1 },
          },
          text: "\n",
        },
        {
          range: {
            end: { character: 5, line: 1 },
            start: { character: 4, line: 1 },
          },
          text: "犬",
        },
      ],
      2,
    );
    assert.equal(updated.getText(), "p\r\nq 😀犬\n");
    assert.equal(updated.offsetAt({ character: 0, line: 1 }), 3);
    assert.deepEqual(updated.positionAt(2), { character: 1, line: 0 });
    assert.deepEqual(updated.positionAt(3), { character: 0, line: 1 });
  });
});

test("orders a reversed change range like the client applied it", async () => {
  await withStore((store) => {
    const document = documentFor("abcdef\n");
    store.open(document);
    const updated = store.update(
      document.uri,
      [
        {
          range: {
            end: { character: 1, line: 0 },
            start: { character: 5, line: 0 },
          },
          text: "Q",
        },
      ],
      2,
    );
    assert.equal(updated.getText(), "aQf\n");
    const lease = store.acquire(document.uri);
    assert.notEqual(lease, undefined);
    assert.equal(lease.snapshot.source, "aQf\n");
    lease.dispose();
  });
});

test("owns the current document through replacement, empty updates, and close", async () => {
  await withStore((store) => {
    const document = documentFor("p\n", 4);
    const opened = store.open(document);
    assert.notEqual(opened, document);
    assert.equal(store.current(document.uri), opened);

    const replaced = store.update(document.uri, [{ text: "1,2d\n" }], 5);
    assert.equal(replaced.getText(), "1,2d\n");
    assert.equal(store.current(document.uri), replaced);

    const advanced = store.update(document.uri, [], 6);
    assert.equal(advanced.version, 6);
    assert.equal(advanced.getText(), replaced.getText());
    assert.equal(store.current(document.uri), advanced);

    store.close(document.uri);
    assert.equal(store.current(document.uri), undefined);
  });
});

test("retains a stable request lease across document replacement", async () => {
  await withStore(async (store, analysis) => {
    const document = documentFor(":😀\n", 4);
    store.open(document);
    const lease = store.acquire(document.uri);
    assert.notEqual(lease, undefined);
    assert.equal(store.acquire("file:///unopened.sed"), undefined);

    store.update(document.uri, [{ text: "p\n" }], 5);

    assert.equal(lease.document.getText(), ":😀\n");
    assert.equal(lease.snapshot.source, ":😀\n");
    assert.deepEqual(
      (await analysis.diagnostics(lease.snapshot)).map(({ code }) => code),
      ["nonportable-label"],
    );
    lease.dispose();
    lease.dispose();
    assert.throws(() => lease.snapshot.source, /live sed analysis snapshot/);
  });
});

test("keeps failed updates transactional and disposes only owned handles", async () => {
  await withStore((store) => {
    const document = documentFor("p\n", 4);
    const opened = store.open(document);
    assert.throws(() => store.update(document.uri, undefined, 5), TypeError);
    assert.equal(store.current(document.uri), opened);

    const lease = store.acquire(document.uri);
    assert.notEqual(lease, undefined);
    store.dispose();
    store.dispose();
    assert.equal(lease.snapshot.source, "p\n");
    assert.throws(() => store.current(document.uri), /disposed/);
    lease.dispose();
    assert.throws(() => lease.snapshot.source, /live sed analysis snapshot/);
  });
});

test("rejects updates for unopened documents", async () => {
  await withStore((store) => {
    assert.throws(
      () => store.update("file:///unopened.sed", [], 2),
      /Cannot update unopened document/,
    );
  });
});

test("rejects a content change that is neither a full nor a ranged edit", async () => {
  const position = { character: 1, line: 0 };
  for (const change of [
    { range: { start: position }, text: "X" },
    { range: { end: position }, text: "X" },
    { range: { start: position, end: null }, text: "X" },
    { range: { start: position, end: { character: -1, line: 0 } }, text: "X" },
    { range: null, text: "X" },
  ]) {
    await withStore((store) => {
      const document = documentFor("p\nq\nd\n");
      const opened = store.open(document);
      assert.throws(() => store.update(document.uri, [change], 2), TypeError);
      assert.equal(store.current(document.uri), opened);
      assert.equal(opened.getText(), "p\nq\nd\n");
    });
  }
});

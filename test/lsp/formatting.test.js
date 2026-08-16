import assert from "node:assert/strict";
import test from "node:test";
import { SedAnalysis } from "@inknexlab/sed-language-server/analysis";
import { formatting } from "../../src/lsp/formatting.js";
import { documentFor } from "../support.js";

const defaultOptions = { insertSpaces: true, tabSize: 2 };

async function withSnapshot(source, callback) {
  const analysis = await SedAnalysis.create("bre");
  const snapshot = analysis.parse(source);
  try {
    const document = documentFor(source);
    return await callback(analysis, { document, snapshot });
  } finally {
    snapshot.dispose();
    await analysis.dispose();
  }
}

function format(analysis, lease, options = defaultOptions) {
  return formatting(analysis, lease, options);
}

test("maps formatted source to one full-document LSP edit", async () => {
  await withSnapshot("p;#😀", async (analysis, lease) => {
    assert.deepEqual(await format(analysis, lease), [
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
  await withSnapshot("p\n", async (analysis, lease) => {
    assert.deepEqual(await format(analysis, lease), []);
  });
});

test("maps an empty formatted source to a full-document deletion", async () => {
  await withSnapshot(";", async (analysis, lease) => {
    assert.deepEqual(
      await format(analysis, lease, {
        insertFinalNewline: false,
        insertSpaces: true,
        tabSize: 2,
      }),
      [
        {
          range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 1 },
          },
          newText: "",
        },
      ],
    );
  });
});

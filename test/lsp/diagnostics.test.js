import assert from "node:assert/strict";
import test from "node:test";
import { SedAnalysis } from "@inknexlab/sed-language-server/analysis";
import { DiagnosticSeverity } from "vscode-languageserver";
import { diagnostics } from "../../src/lsp/diagnostics.js";
import { documentFor } from "../support.js";

async function diagnosticsFor(source, mode = "bre") {
  const analysis = await SedAnalysis.create(mode);
  const snapshot = analysis.parse(source);
  try {
    const document = documentFor(source);
    return await diagnostics(analysis, { document, snapshot });
  } finally {
    snapshot.dispose();
    await analysis.dispose();
  }
}

test("maps shared diagnostic offsets and severities to LSP diagnostics", async () => {
  assert.deepEqual(await diagnosticsFor(":😀\n"), [
    {
      range: {
        start: { line: 0, character: 1 },
        end: { line: 0, character: 3 },
      },
      severity: DiagnosticSeverity.Warning,
      code: "nonportable-label",
      source: "sed-language-server",
      message:
        "This label contains a character outside the portable filename character set.",
    },
  ]);
});

test("rejects severities outside the sed analysis contract", async () => {
  const document = documentFor("p\n");
  const analysis = {
    diagnostics: async () => [
      {
        code: "unsupported",
        endOffset: 1,
        message: "Unsupported severity.",
        severity: "information",
        startOffset: 0,
      },
    ],
  };
  await assert.rejects(
    diagnostics(analysis, { document, snapshot: {} }),
    /Unsupported sed diagnostic severity: information/,
  );
});

test("keeps the analysis order when CRLF offsets project to one LSP position", async () => {
  const values = await diagnosticsFor(",/\r\n");
  assert.deepEqual(
    values.map(({ code, range }) => ({ code, range })),
    [
      "missing-function",
      "unterminated-regular-expression",
      "omitted-address",
    ].map((code) => ({
      code,
      range: {
        start: { line: 0, character: 2 },
        end: { line: 0, character: 2 },
      },
    })),
  );
});

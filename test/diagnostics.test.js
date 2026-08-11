import assert from "node:assert/strict";
import test from "node:test";
import { DiagnosticSeverity } from "vscode-languageserver";
import { diagnostics } from "../src/diagnostics.js";
import { SyntaxStore } from "../src/parser.js";
import { documentFor } from "./helpers.js";

async function diagnosticsFor(source, mode = "bre") {
  const store = await SyntaxStore.create(mode);
  try {
    return diagnostics(store.open(documentFor(source)));
  } finally {
    store.dispose();
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

test("preserves shared semantic diagnostics in both regex modes", async () => {
  for (const [mode, source] of [
    ["bre", "s/\\(a\\)/\\2/\n"],
    ["ere", "s/(a)/\\2/\n"],
  ]) {
    const matching = (await diagnosticsFor(source, mode)).find(
      ({ code }) => code === "unmatched-replacement-backreference",
    );
    assert.equal(matching?.severity, DiagnosticSeverity.Warning, mode);
    assert.equal(matching?.source, "sed-language-server", mode);
  }
});

test("orders diagnostics after CRLF offsets are projected to LSP positions", async () => {
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

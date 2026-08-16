import { DiagnosticSeverity } from "vscode-languageserver";
import { rangeForOffsets } from "./documents.js";

const severityByName = Object.freeze({
  error: DiagnosticSeverity.Error,
  warning: DiagnosticSeverity.Warning,
});

function severityFor(name) {
  const severity = severityByName[name];
  if (severity === undefined) {
    throw new Error(`Unsupported sed diagnostic severity: ${name}`);
  }
  return severity;
}

// The provider already orders its diagnostics by source offset, and projecting
// offsets to positions preserves that order, so the sequence is kept as given.
export async function diagnostics(
  analysis,
  { document, snapshot },
  { signal } = {},
) {
  return (await analysis.diagnostics(snapshot, { signal })).map(
    ({ startOffset, endOffset, severity, ...value }) => ({
      ...value,
      range: rangeForOffsets(document, startOffset, endOffset),
      severity: severityFor(severity),
      source: "sed-language-server",
    }),
  );
}

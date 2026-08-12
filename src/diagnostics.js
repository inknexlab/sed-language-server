import { diagnostics as analyzeDiagnostics } from "@inknexlab/sed-language-server/analysis";
import { DiagnosticSeverity } from "vscode-languageserver";

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

function compareDiagnostics(left, right) {
  return (
    left.range.start.line - right.range.start.line ||
    left.range.start.character - right.range.start.character ||
    left.range.end.line - right.range.end.line ||
    left.range.end.character - right.range.end.character ||
    left.severity - right.severity ||
    String(left.code).localeCompare(String(right.code))
  );
}

export function diagnostics(snapshot) {
  const source = snapshot.document.getText();
  return analyzeDiagnostics({
    mode: snapshot.mode,
    source,
    tree: snapshot.tree,
  })
    .map(({ startOffset, endOffset, severity, ...value }) => ({
      ...value,
      range: {
        start: snapshot.document.positionAt(startOffset),
        end: snapshot.document.positionAt(endOffset),
      },
      severity: severityFor(severity),
      source: "sed-language-server",
    }))
    .sort(compareDiagnostics);
}

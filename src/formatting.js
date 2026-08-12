import { format as analyzeFormat } from "@inknexlab/sed-language-server/analysis";

export function formattingEdits(snapshot, options) {
  const { document, mode, tree } = snapshot;
  const source = document.getText();
  const formatted = analyzeFormat({ mode, source, tree }, options);
  if (formatted === undefined) {
    return [];
  }
  return [
    {
      range: {
        start: { line: 0, character: 0 },
        end: document.positionAt(source.length),
      },
      newText: formatted,
    },
  ];
}

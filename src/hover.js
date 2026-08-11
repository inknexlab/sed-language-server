import { hover as analyzeHover } from "@inknexlab/sed-language-server/analysis";
import { MarkupKind } from "vscode-languageserver";
import { hoverDocumentation } from "./analysis/catalog.js";

export function hover(snapshot, position, contentKind) {
  const { document, mode, tree } = snapshot;
  const documentationKind =
    contentKind === null ? MarkupKind.Markdown : contentKind;
  const result = analyzeHover(
    { mode, source: document.getText(), tree },
    document.offsetAt(position),
  );
  if (result === undefined) {
    return undefined;
  }
  return {
    contents:
      contentKind === null
        ? hoverDocumentation(result.documentation, documentationKind)
        : {
            kind: documentationKind,
            value: hoverDocumentation(result.documentation, documentationKind),
          },
    range: {
      start: document.positionAt(result.startOffset),
      end: document.positionAt(result.endOffset),
    },
  };
}

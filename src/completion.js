import { completions as analyzeCompletions } from "@inknexlab/sed-language-server/analysis";
import { CompletionItemKind, MarkupKind } from "vscode-languageserver";
import { referenceDocumentation } from "./analysis/catalog.js";

const itemKindByCategory = Object.freeze({
  command: CompletionItemKind.Keyword,
  label: CompletionItemKind.Reference,
  substitutionFlag: CompletionItemKind.Keyword,
});

function completionItem(document, completion, documentationKind) {
  const kind = itemKindByCategory[completion.category];
  if (kind === undefined) {
    throw new Error(`Unsupported completion category: ${completion.category}`);
  }
  const item = {
    label: completion.label,
    kind,
    textEdit: {
      range: {
        start: document.positionAt(completion.startOffset),
        end: document.positionAt(completion.endOffset),
      },
      newText: completion.newText,
    },
  };
  if (completion.detail !== undefined) {
    item.detail = completion.detail;
  }
  if (completion.documentation !== undefined) {
    const rendered = referenceDocumentation(
      completion.documentation,
      documentationKind === null ? MarkupKind.PlainText : documentationKind,
    );
    item.documentation =
      documentationKind === null
        ? rendered
        : { kind: documentationKind, value: rendered };
  }
  return item;
}

export function completionItems(snapshot, position, documentationKind) {
  const { document, mode, tree } = snapshot;
  return analyzeCompletions(
    { mode, source: document.getText(), tree },
    document.offsetAt(position),
  ).map((completion) =>
    completionItem(document, completion, documentationKind),
  );
}

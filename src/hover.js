import { hover as analyzeHover } from "@inknexlab/sed-language-server/analysis";
import { MarkupKind } from "vscode-languageserver";

function maximumBacktickRun(value) {
  let current = 0;
  let maximum = 0;
  for (const character of value) {
    current = character === "`" ? current + 1 : 0;
    maximum = Math.max(maximum, current);
  }
  return maximum;
}

function inlineCode(value) {
  const backticks = maximumBacktickRun(value);
  if (backticks === 0) {
    return `\`${value}\``;
  }
  const fence = "`".repeat(backticks + 1);
  return `${fence} ${value} ${fence}`;
}

function referenceDocumentation(reference, kind) {
  if (kind !== MarkupKind.Markdown && kind !== MarkupKind.PlainText) {
    throw new TypeError(`Unsupported markup kind: ${String(kind)}`);
  }
  return kind === MarkupKind.Markdown
    ? `\`\`\`sed\n${reference.synopsis}\n\`\`\`\n\n${reference.description}`
    : `${reference.synopsis}\n\n${reference.description}`;
}

function hoverDocumentation(documentation, kind) {
  const reference = referenceDocumentation(documentation, kind);
  return kind === MarkupKind.Markdown
    ? `### ${inlineCode(documentation.display)} — ${documentation.title}\n\n${reference}`
    : `${documentation.display} — ${documentation.title}\n\n${reference}`;
}

export function hover(snapshot, position, contentKind = null) {
  const { document, mode, tree } = snapshot;
  const documentationKind = contentKind ?? MarkupKind.Markdown;
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

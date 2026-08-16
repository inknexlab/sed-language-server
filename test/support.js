import { TextDocument } from "vscode-languageserver-textdocument";

let documentNumber = 0;

export function documentFor(source, version = 1) {
  documentNumber += 1;
  return TextDocument.create(
    `file:///test-${documentNumber}.sed`,
    "sed",
    version,
    source,
  );
}

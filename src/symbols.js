import {
  definitions as analyzeDefinitions,
  references as analyzeReferences,
} from "@inknexlab/sed-language-server/analysis";

function analysisSnapshot({ document, mode, tree }) {
  return { mode, source: document.getText(), tree };
}

function locations(document, ranges) {
  return ranges.map(({ startOffset, endOffset }) => ({
    range: {
      end: document.positionAt(endOffset),
      start: document.positionAt(startOffset),
    },
    uri: document.uri,
  }));
}

export function definitions(snapshot, position) {
  const { document } = snapshot;
  return locations(
    document,
    analyzeDefinitions(analysisSnapshot(snapshot), document.offsetAt(position)),
  );
}

export function references(snapshot, position, includeDeclaration = false) {
  const { document } = snapshot;
  return locations(
    document,
    analyzeReferences(
      analysisSnapshot(snapshot),
      document.offsetAt(position),
      includeDeclaration,
    ),
  );
}

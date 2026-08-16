import { fullDocumentRange } from "./documents.js";

export async function formatting(
  analysis,
  { document, snapshot },
  options,
  { signal } = {},
) {
  const formatted = await analysis.format(snapshot, options, { signal });
  if (formatted === undefined) {
    return [];
  }
  return [
    {
      newText: formatted,
      range: fullDocumentRange(document),
    },
  ];
}

const emptyData = Object.freeze([]);
const semanticTokensLegend = Object.freeze({
  tokenModifiers: Object.freeze([]),
  tokenTypes: Object.freeze([]),
});
const tokenRecordSize = 5;

// Sed contributes no token of its own, so the capability is only worth
// advertising to a client that keeps its own syntax highlighting.
export function semanticTokenConfiguration(capability) {
  const full = capability?.requests?.full;
  if (
    capability === null ||
    typeof capability !== "object" ||
    Array.isArray(capability) ||
    capability.augmentsSyntaxTokens !== true ||
    !Array.isArray(capability.formats) ||
    !capability.formats.includes("relative") ||
    (full !== true &&
      (full === null || typeof full !== "object" || Array.isArray(full)))
  ) {
    return undefined;
  }
  return Object.freeze({
    delta: full !== true && full.delta === true,
    legend: semanticTokensLegend,
  });
}

function recordsEqual(left, leftStart, right, rightStart) {
  for (let index = 0; index < tokenRecordSize; index += 1) {
    if (left[leftStart + index] !== right[rightStart + index]) {
      return false;
    }
  }
  return true;
}

// The single edit spans everything between the shared record-aligned prefix and
// suffix, so applying it to the previous data reproduces the current data.
function tokenEdits(previous, current) {
  let prefix = 0;
  const sharedLength = Math.min(previous.length, current.length);
  while (
    prefix < sharedLength &&
    recordsEqual(previous, prefix, current, prefix)
  ) {
    prefix += tokenRecordSize;
  }

  let suffix = 0;
  while (
    suffix < sharedLength - prefix &&
    recordsEqual(
      previous,
      previous.length - suffix - tokenRecordSize,
      current,
      current.length - suffix - tokenRecordSize,
    )
  ) {
    suffix += tokenRecordSize;
  }

  if (prefix === previous.length && prefix === current.length) {
    return Object.freeze([]);
  }

  const replacement = current.slice(prefix, current.length - suffix);
  const edit = {
    deleteCount: previous.length - prefix - suffix,
    start: prefix,
  };
  if (replacement.length > 0) {
    edit.data = Object.freeze(replacement);
  }
  return Object.freeze([Object.freeze(edit)]);
}

function copySemanticTokenData(data) {
  if (!Array.isArray(data) || data.length % tokenRecordSize !== 0) {
    throw new TypeError("Semantic token data must contain complete records.");
  }
  return Object.freeze([...data]);
}

// Keeps the last successful result per URI so a delta request can reference it.
export class SemanticTokenResults {
  #nextResultId = 1n;
  #results = new Map();

  #commit(uri, data) {
    const result = Object.freeze({
      data: copySemanticTokenData(data),
      resultId: String(this.#nextResultId),
    });
    this.#nextResultId += 1n;
    this.#results.set(uri, result);
    return result;
  }

  clear(uri) {
    this.#results.delete(uri);
  }

  clearAll() {
    this.#results.clear();
  }

  full(uri, data) {
    return this.#commit(uri, data);
  }

  delta(uri, previousResultId, data) {
    const previous = this.#results.get(uri);
    const current = this.#commit(uri, data);
    if (previous?.resultId !== previousResultId) {
      return current;
    }
    return Object.freeze({
      edits: tokenEdits(previous.data, current.data),
      resultId: current.resultId,
    });
  }
}

export async function semanticTokens(analysis, { snapshot }, { signal } = {}) {
  const candidates = await analysis.semanticTokens(snapshot, { signal });
  if (!Array.isArray(candidates) || candidates.length !== 0) {
    throw new TypeError(
      "Sed Analysis must return an empty Semantic Tokens list.",
    );
  }
  return { data: emptyData };
}

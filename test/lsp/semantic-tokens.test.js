import assert from "node:assert/strict";
import test from "node:test";
import {
  SemanticTokenResults,
  semanticTokenConfiguration,
  semanticTokens,
} from "../../src/lsp/semantic-tokens.js";

function capability(full, augmentsSyntaxTokens = true) {
  return {
    augmentsSyntaxTokens,
    formats: ["relative"],
    requests: { full },
  };
}

test("negotiates only augmenting full-document Semantic Tokens", () => {
  const legend = { tokenModifiers: [], tokenTypes: [] };
  assert.deepEqual(semanticTokenConfiguration(capability(true)), {
    delta: false,
    legend,
  });
  assert.deepEqual(semanticTokenConfiguration(capability({ delta: true })), {
    delta: true,
    legend,
  });
  const configuration = semanticTokenConfiguration(capability(true));
  assert.equal(Object.isFrozen(configuration.legend), true);
  assert.equal(Object.isFrozen(configuration.legend.tokenModifiers), true);
  assert.equal(Object.isFrozen(configuration.legend.tokenTypes), true);
  for (const value of [
    undefined,
    capability(true, false),
    { ...capability(true), formats: [] },
    capability(false),
    { ...capability(true), requests: { range: true } },
  ]) {
    assert.equal(semanticTokenConfiguration(value), undefined);
  }
});

test("tracks only result IDs for the empty Semantic Tokens vocabulary", () => {
  const results = new SemanticTokenResults();
  const uri = "file:///tokens.sed";
  const first = results.full(uri, []);
  assert.deepEqual(first.data, []);
  assert.equal(typeof first.resultId, "string");

  const unchanged = results.delta(uri, first.resultId, []);
  assert.deepEqual(unchanged.edits, []);
  assert.notEqual(unchanged.resultId, first.resultId);

  assert.deepEqual(
    results.delta("file:///other.sed", unchanged.resultId, []).data,
    [],
  );
  results.clear(uri);
  assert.deepEqual(results.delta(uri, unchanged.resultId, []).data, []);
  const current = results.full(uri, []);
  results.clearAll();
  assert.deepEqual(results.delta(uri, current.resultId, []).data, []);
});

test("converts and validates the Analysis empty token list", async () => {
  const snapshot = Object.freeze({ marker: "snapshot" });
  const signal = new AbortController().signal;
  const calls = [];
  const analysis = {
    async semanticTokens(actualSnapshot, options) {
      calls.push({ actualSnapshot, options });
      return Object.freeze([]);
    },
  };

  assert.deepEqual(await semanticTokens(analysis, { snapshot }, { signal }), {
    data: [],
  });
  assert.deepEqual(calls, [{ actualSnapshot: snapshot, options: { signal } }]);

  await assert.rejects(
    semanticTokens(
      {
        async semanticTokens() {
          return [{ kind: "command" }];
        },
      },
      { snapshot },
    ),
    /must return an empty Semantic Tokens list/,
  );
});

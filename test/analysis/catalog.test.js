import assert from "node:assert/strict";
import test from "node:test";
import {
  commandReferenceForVerb,
  commandReferences,
  substitutionFlagReferenceForType,
  substitutionFlagReferences,
} from "../../src/analysis/catalog.js";

test("exposes immutable command references through verb lookup", () => {
  const references = commandReferences();
  assert.equal(Object.isFrozen(references), true);
  for (const reference of references) {
    assert.equal(Object.isFrozen(reference), true, reference.verb);
    assert.equal(commandReferenceForVerb(reference.verb), reference);
  }
  assert.equal(commandReferenceForVerb("unknown"), undefined);
});

test("exposes ordered immutable substitution flag references by node type", () => {
  const references = substitutionFlagReferences();
  assert.equal(Object.isFrozen(references), true);
  assert.deepEqual(
    references.map(({ nodeType, spelling, terminal }) => ({
      nodeType,
      spelling,
      terminal,
    })),
    [
      { nodeType: "occurrence_flag", spelling: null, terminal: false },
      { nodeType: "global_flag", spelling: "g", terminal: false },
      { nodeType: "case_insensitive_flag", spelling: "i", terminal: false },
      { nodeType: "print_flag", spelling: "p", terminal: false },
      { nodeType: "substitution_flag", spelling: "w", terminal: true },
    ],
  );
  for (const reference of references) {
    assert.equal(Object.isFrozen(reference), true, reference.nodeType);
    assert.equal(
      substitutionFlagReferenceForType(reference.nodeType),
      reference,
    );
  }
  assert.equal(substitutionFlagReferenceForType("unknown"), undefined);
});

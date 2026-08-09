import assert from "node:assert/strict";
import test from "node:test";
import { MarkupKind } from "vscode-languageserver";
import {
  commandReferenceForVerb,
  commandReferences,
  referenceDocumentation,
  substitutionFlagReferenceForType,
  substitutionFlagReferences,
} from "../src/catalog.js";

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

test("renders reference documentation in the requested markup kind", () => {
  const reference = {
    synopsis: "syntax",
    description: "Keeps *literal punctuation* and renders `code` plainly.",
  };
  const markdown =
    "```sed\nsyntax\n```\n\nKeeps *literal punctuation* and renders `code` plainly.";
  const plain =
    "syntax\n\nKeeps *literal punctuation* and renders code plainly.";
  assert.deepEqual(referenceDocumentation(reference, MarkupKind.Markdown), {
    kind: MarkupKind.Markdown,
    value: markdown,
  });
  assert.deepEqual(referenceDocumentation(reference, MarkupKind.PlainText), {
    kind: MarkupKind.PlainText,
    value: plain,
  });
  assert.equal(referenceDocumentation(reference, null), plain);
  assert.throws(
    () => referenceDocumentation(reference),
    /Unsupported markup kind/,
  );
});

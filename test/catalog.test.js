import assert from "node:assert/strict";
import test from "node:test";
import { MarkupKind } from "vscode-languageserver";
import {
  commandReferenceForVerb,
  commandReferences,
  referenceDocumentation,
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

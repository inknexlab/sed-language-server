import assert from "node:assert/strict";
import test from "node:test";
import {
  grammarManifest,
  regularExpressionModes,
  SyntaxStore,
} from "../src/syntax.js";
import { documentFor, only } from "./support.js";

test("loads exactly the pinned POSIX BRE and ERE grammars", async (t) => {
  assert.deepEqual(regularExpressionModes(), ["bre", "ere"]);
  assert.equal(
    grammarManifest().revision,
    "fe85f809435c35a4e9fc01b8dccbcdda3678d583",
  );

  for (const mode of regularExpressionModes()) {
    await t.test(mode.toUpperCase(), async () => {
      const store = await SyntaxStore.create(mode);
      t.after(() => store.dispose());
      const document = documentFor("1,2s/a/b/g\n");
      const rootNode = store.open(document).tree.rootNode;
      const command = only(rootNode, "editing_command");
      assert.equal(
        command.childForFieldName("addresses")?.type,
        "address_clause",
      );
      assert.equal(
        command.childForFieldName("function")?.namedChild(0)?.type,
        "substitute_function",
      );
      assert.equal(rootNode.hasError, false);
    });
  }
});

test("the manifest exposes structured issue outcomes per grammar", () => {
  const { bre, ere } = grammarManifest().languages;
  assert.deepEqual(Object.keys(bre.outcomes).sort(), [
    "implementation_defined_syntax",
    "implementation_option_syntax",
    "incomplete_syntax",
    "nonconforming_syntax",
    "undefined_syntax",
    "unspecified_syntax",
  ]);
  assert.equal(ere.outcomes.implementation_defined_syntax, undefined);
  assert.ok(bre.outcomes.undefined_syntax.includes("malformed_interval"));
  assert.ok(
    ere.outcomes.incomplete_syntax.includes("incomplete_regular_expression"),
  );
});

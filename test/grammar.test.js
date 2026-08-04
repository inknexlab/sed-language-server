import assert from "node:assert/strict";
import test from "node:test";
import {
  grammarManifest,
  regularExpressionModes,
  SyntaxStore,
} from "../src/parser.js";
import { documentFor, only } from "./support.js";

test("loads exactly the pinned POSIX BRE and ERE grammars", async (t) => {
  assert.deepEqual(regularExpressionModes(), ["bre", "ere"]);
  assert.equal(
    grammarManifest().revision,
    "38b635ec26e6fd403e250b2932706cac15f36311",
  );

  for (const mode of regularExpressionModes()) {
    await t.test(mode.toUpperCase(), async () => {
      const store = await SyntaxStore.create(mode);
      t.after(() => store.dispose());
      const document = documentFor("1,3!s|a|b|g\n");
      const rootNode = store.open(document).tree.rootNode;
      const command = only(rootNode, "editing_command");
      const addresses = command.childForFieldName("addresses");
      const negation = command.childForFieldName("negation");
      const functionWrapper = command.childForFieldName("function");
      const substitute = functionWrapper?.namedChild(0);

      assert.equal(addresses?.type, "address_clause");
      assert.equal(addresses.childForFieldName("first")?.type, "address");
      assert.equal(addresses.childForFieldName("second")?.type, "address");
      assert.equal(negation?.type, "negation");
      assert.equal(functionWrapper?.type, "function");
      assert.equal(substitute?.type, "substitute_function");
      assert.equal(
        substitute?.childForFieldName("expression")?.type,
        mode === "bre" ? "basic_reg_exp" : "extended_reg_exp",
      );
      assert.deepEqual(
        ["opening", "middle", "closing"].map(
          (field) => substitute?.childForFieldName(field)?.type,
        ),
        ["delimiter", "delimiter", "delimiter"],
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

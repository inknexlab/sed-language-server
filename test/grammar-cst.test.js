import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { SyntaxStore } from "../src/parser.js";
import { documentFor } from "./support.js";

const variantIds = ["bre", "ere"];
let stores = {};

before(async () => {
  stores = Object.fromEntries(
    await Promise.all(
      variantIds.map(async (mode) => [mode, await SyntaxStore.create(mode)]),
    ),
  );
});

after(() => {
  for (const store of Object.values(stores)) {
    store.dispose();
  }
});

function parse(mode, source) {
  return stores[mode].open(documentFor(source)).tree;
}

function nodes(tree, type) {
  return tree.rootNode.descendantsOfType(type);
}

function only(tree, type) {
  const matches = nodes(tree, type);
  assert.equal(matches.length, 1, tree.rootNode.toString());
  return matches[0];
}

function issueRecords(tree) {
  return nodes(tree, "syntax_issue").map((issue) => {
    const outcome = issue.namedChild(0);
    const reason = outcome?.namedChild(0);
    return {
      outcome: outcome?.type,
      reason: reason?.type,
      text: reason?.text,
    };
  });
}

function issueReasons(tree) {
  return issueRecords(tree).map(({ reason }) => reason);
}

function assertNoNativeError(tree) {
  assert.equal(tree.rootNode.hasError, false, tree.rootNode.toString());
}

function assertPortable(tree) {
  assertNoNativeError(tree);
  assert.deepEqual(issueRecords(tree), [], tree.rootNode.toString());
}

function selectedFunctionTypes(tree) {
  return nodes(tree, "editing_command").map((command) => {
    const wrapper = command.childForFieldName("function");
    return wrapper?.namedChild(0)?.type;
  });
}

test("every POSIX editing function remains a specific function node", () => {
  const cases = [
    ["{p;}\n", "block_function"],
    ["a\\\ntext\n", "append_function"],
    ["b label\n", "branch_function"],
    ["c\\\ntext\n", "change_function"],
    ["d\n", "delete_function"],
    ["D\n", "delete_first_line_function"],
    ["g\n", "get_function"],
    ["G\n", "get_append_function"],
    ["h\n", "hold_function"],
    ["H\n", "hold_append_function"],
    ["i\\\ntext\n", "insert_function"],
    ["l\n", "list_function"],
    ["n\n", "next_function"],
    ["N\n", "next_append_function"],
    ["p\n", "print_function"],
    ["P\n", "print_first_line_function"],
    ["q\n", "quit_function"],
    ["r input\n", "read_function"],
    ["s/a/b/\n", "substitute_function"],
    ["t label\n", "test_function"],
    ["w output\n", "write_function"],
    ["x\n", "exchange_function"],
    ["y/a/b/\n", "translate_function"],
    [":label\n", "label_function"],
    ["=\n", "line_number_function"],
    ["# comment\n", "comment_function"],
  ];

  for (const [source, expected] of cases) {
    const tree = parse("bre", source);
    assertPortable(tree);
    assert.equal(selectedFunctionTypes(tree)[0], expected, source);
  }
});

test("only script-leading #n comments expose default-output suppression", () => {
  const positiveCases = [
    ["#n", null],
    ["#n\np\n", null],
    ["#not; p\np\n", "ot; p"],
    ["#n\r\np\n", "\r"],
  ];
  const negativeCases = [
    "# n\n",
    " #n\n",
    ";#n\n",
    "\n#n\n",
    "p\n#n\n",
    "{\n#n\n}\n",
    "#N\n",
  ];

  for (const variant of variantIds) {
    for (const [source, suffix] of positiveCases) {
      const tree = parse(variant, source);
      assertPortable(tree);
      const suppression = only(tree, "default_output_suppression");
      const comment = suppression.parent;

      assert.equal(suppression.text, "n", source);
      assert.deepEqual(
        [suppression.startIndex, suppression.endIndex],
        [1, 2],
        source,
      );
      assert.equal(comment?.type, "comment", source);
      assert.deepEqual(
        [
          comment?.childForFieldName("suppression")?.type,
          comment?.childForFieldName("suppression")?.startIndex,
          comment?.childForFieldName("suppression")?.endIndex,
        ],
        ["default_output_suppression", 1, 2],
        source,
      );
      assert.equal(
        comment?.namedChildren.find(({ type }) => type === "comment_text")
          ?.text ?? null,
        suffix,
        source,
      );
    }

    for (const source of negativeCases) {
      const tree = parse(variant, source);
      assertPortable(tree);
      assert.deepEqual(nodes(tree, "default_output_suppression"), [], source);
    }
  }
});

test("substitution, translation, and text operands expose their atoms", () => {
  const substitution = parse("bre", "s|a|x&\\0\\1\\||g\n");
  assertPortable(substitution);
  assert.deepEqual(
    only(substitution, "replacement").namedChildren.map(({ type }) => type),
    [
      "replacement_literal",
      "matched_text_reference",
      "replacement_backreference",
      "replacement_backreference",
      "replacement_escaped_delimiter",
    ],
  );

  const replacementEscapes = parse("bre", "s|a|\\&\\\\|\n");
  assertPortable(replacementEscapes);
  assert.deepEqual(
    nodes(replacementEscapes, "replacement_escape").map(({ text }) => text),
    ["\\&", "\\\\"],
  );

  const escapedReplacementNewline = parse("bre", "s|a|first\\\nsecond|\n");
  assertPortable(escapedReplacementNewline);
  assert.deepEqual(
    nodes(escapedReplacementNewline, "escaped_newline").map(({ text }) => text),
    ["\\\n"],
  );

  const translation = parse("bre", "y|a\\n\\||b\\\\c|\n");
  assertPortable(translation);
  assert.deepEqual(
    nodes(translation, "translation_string").map((string) =>
      string.namedChildren.map(({ type }) => type),
    ),
    [
      [
        "translation_literal",
        "translation_escape",
        "translation_escaped_delimiter",
      ],
      ["translation_literal", "translation_escape", "translation_literal"],
    ],
  );

  const text = parse("bre", "a\\\nfirst\\\\second\\\nthird\n");
  assertPortable(text);
  assert.deepEqual(
    only(text, "text").namedChildren.map(({ type }) => type),
    [
      "text_literal",
      "text_backslash_escape",
      "text_literal",
      "text_escaped_newline",
      "text_literal",
      "text_terminator",
    ],
  );
});

test("substitution flags stay ordered before a terminal write flag", () => {
  for (const variant of variantIds) {
    const tree = parse(variant, "s/a/b/gipw output\n");
    assertPortable(tree);
    const flags = only(tree, "substitution_flags");
    assert.deepEqual(
      flags.namedChildren.map(({ type }) => type),
      ["global_flag", "case_insensitive_flag", "print_flag", "write_flag"],
    );
    assert.equal(only(tree, "wfile").text, "output");
  }
});

test("positive substitution occurrences retain leading zeros", () => {
  for (const variant of variantIds) {
    const positive = parse(variant, "s/a/b/001\n");
    assertPortable(positive);
    assert.equal(only(positive, "occurrence_flag").text, "001");

    const zero = parse(variant, "s/a/b/000\n");
    assertNoNativeError(zero);
    assert.deepEqual(
      issueRecords(zero).map(({ outcome, reason, text }) => [
        outcome,
        reason,
        text,
      ]),
      [["nonconforming_syntax", "zero_substitution_occurrence", "000"]],
    );
  }
});

test("a continued text operand requires a following physical line", () => {
  for (const variant of variantIds) {
    const incomplete = parse(variant, "a\\\ntext\\\n");
    assertNoNativeError(incomplete);
    assert.deepEqual(
      issueRecords(incomplete).map(({ outcome, reason }) => [outcome, reason]),
      [["incomplete_syntax", "missing_text"]],
    );
    assert.equal(
      only(incomplete, "text_terminator").namedChild(0)?.type,
      "text_eof",
    );

    assertPortable(parse(variant, "a\\\ntext\\\n\n"));
  }
});

test("BRE nodes mirror the POSIX production hierarchy", () => {
  const tree = parse("bre", "s#^\\(ab*\\)\\{2,3\\}\\1$#x#\n");
  assertPortable(tree);

  const expression = only(tree, "substitute_function").childForFieldName(
    "expression",
  );
  assert.equal(expression?.type, "basic_reg_exp");
  const branch = expression.namedChild(0);
  assert.equal(branch?.type, "bre_branch");
  const leftExpression = branch.childForFieldName("left")?.namedChild(0);
  const rightExpression = branch.childForFieldName("right");
  assert.equal(
    leftExpression?.childForFieldName("left_anchor")?.type,
    "left_anchor",
  );
  assert.equal(
    leftExpression?.childForFieldName("expression")?.type,
    "simple_bre",
  );
  assert.equal(
    rightExpression?.childForFieldName("right_anchor")?.type,
    "right_anchor",
  );
  assert.ok(nodes(tree, "bre_branch").length > 0);
  assert.ok(nodes(tree, "bre_expression").length > 0);
  assert.ok(nodes(tree, "simple_bre").length > 0);
  assert.ok(nodes(tree, "nondupl_bre").length > 0);
  assert.ok(nodes(tree, "one_char_or_coll_elem_bre").length > 0);
  assert.equal(
    nodes(tree, "back_open_parenthesis")[0]?.parent?.childForFieldName(
      "expression",
    )?.type,
    "basic_reg_exp",
  );
  assert.deepEqual(
    nodes(tree, "backreference").map(({ text }) => text),
    ["\\1"],
  );

  const interval = nodes(tree, "bre_dupl_symbol").find((node) =>
    node.childForFieldName("minimum"),
  );
  assert.ok(interval, tree.rootNode.toString());
  assert.deepEqual(
    ["opening", "minimum", "separator", "maximum", "closing"].map(
      (field) => interval.childForFieldName(field)?.text,
    ),
    ["\\{", "2", ",", "3", "\\}"],
  );

  const repeatedAnchorCharacter = parse("bre", "/^^/p\n");
  assertPortable(repeatedAnchorCharacter);
  assert.deepEqual(
    nodes(repeatedAnchorCharacter, "left_anchor").map(({ text }) => text),
    ["^"],
  );
  assert.deepEqual(
    nodes(repeatedAnchorCharacter, "ordinary_character").map(
      ({ text }) => text,
    ),
    ["^"],
  );

  const repeatedSubexpressionAnchor = parse("bre", "/\\(^^\\)/p\n");
  assertNoNativeError(repeatedSubexpressionAnchor);
  assert.deepEqual(issueReasons(repeatedSubexpressionAnchor), [
    "bre_subexpression_left_anchor",
  ]);
  assert.deepEqual(
    nodes(repeatedSubexpressionAnchor, "ordinary_character").map(
      ({ text }) => text,
    ),
    ["^"],
  );
});

test("BRE delimiter escapes take precedence over BRE operators", () => {
  const substitution = parse("bre", "s|\\||x|\n");
  assertPortable(substitution);
  assert.equal(only(substitution, "escaped_delimiter").text, "\\|");

  const address = parse("bre", "\\|\\||p\n");
  assertPortable(address);
  assert.equal(only(address, "escaped_delimiter").text, "\\|");

  const anchor = parse("bre", "s|$\\||x|\n");
  assertPortable(anchor);
  assert.deepEqual(
    nodes(anchor, "ordinary_character").map(({ text }) => text),
    ["$"],
  );
  assert.equal(nodes(anchor, "right_anchor").length, 0);

  const interval = parse("bre", "s}a\\{1\\}}x}\n");
  assertNoNativeError(interval);
  assert.deepEqual(
    issueRecords(interval).map(({ outcome, reason }) => [outcome, reason]),
    [["undefined_syntax", "malformed_interval"]],
  );
  assert.equal(only(interval, "escaped_delimiter").text, "\\}");
});

test("BRE interval closes remain visible outside interval recovery", () => {
  const unmatched = parse("bre", "/\\}/p\n");
  assertNoNativeError(unmatched);
  assert.deepEqual(issueRecords(unmatched), [
    {
      outcome: "undefined_syntax",
      reason: "unmatched_interval_close",
      text: "",
    },
  ]);
  assert.equal(only(unmatched, "back_close_brace").text, "\\}");
  assert.equal(nodes(unmatched, "quoted_character").length, 0);

  const delimiterClose = parse("bre", "s}a\\}}x}\n");
  assertPortable(delimiterClose);
  assert.equal(only(delimiterClose, "escaped_delimiter").text, "\\}");
  assert.equal(nodes(delimiterClose, "back_close_brace").length, 0);

  const quotedEreClose = parse("ere", "/\\}/p\n");
  assertPortable(quotedEreClose);
  assert.equal(only(quotedEreClose, "quoted_character").text, "\\}");
});

test("BRE duplication recovery preserves conditional tokens and intervals", () => {
  const adjacent = parse("bre", "/a*\\+b/p\n");
  assertNoNativeError(adjacent);
  assert.deepEqual(
    issueRecords(adjacent).map(({ outcome, reason }) => [outcome, reason]),
    [
      ["undefined_syntax", "adjacent_duplication_symbol"],
      ["implementation_defined_syntax", "bre_plus_escape"],
    ],
  );
  assert.equal(only(adjacent, "back_plus").text, "\\+");

  const adjacentInterval = parse("bre", "/a*\\{2\\}/p\n");
  assertNoNativeError(adjacentInterval);
  assert.deepEqual(issueReasons(adjacentInterval), [
    "adjacent_duplication_symbol",
  ]);
  const adjacentOperator = only(
    adjacentInterval,
    "adjacent_bre_dupl_symbol",
  ).childForFieldName("operator");
  assert.equal(adjacentOperator?.type, "bre_dupl_symbol");
  assert.deepEqual(
    ["opening", "minimum", "closing"].map(
      (field) => adjacentOperator.childForFieldName(field)?.text,
    ),
    ["\\{", "2", "\\}"],
  );

  const leadingInterval = parse("bre", "/\\{2\\}/p\n");
  assertNoNativeError(leadingInterval);
  assert.deepEqual(issueReasons(leadingInterval), [
    "leading_duplication_symbol",
  ]);
  const leadingOperator = only(
    leadingInterval,
    "leading_bre_dupl_symbol",
  ).childForFieldName("operator");
  assert.equal(leadingOperator?.type, "bre_dupl_symbol");
  assert.deepEqual(
    ["opening", "minimum", "closing"].map(
      (field) => leadingOperator.childForFieldName(field)?.text,
    ),
    ["\\{", "2", "\\}"],
  );
});

test("ERE nodes expose alternation, duplication, and repetition modifiers", () => {
  const tree = parse("ere", "s#^(ab|c)+?d{2,3}?$#x#\n");
  assertPortable(tree);

  assert.ok(nodes(tree, "extended_reg_exp").length > 0);
  assert.ok(nodes(tree, "ere_branch").length > 0);
  assert.ok(nodes(tree, "ere_expression").length > 0);
  assert.deepEqual(
    nodes(tree, "ere_alternation_operator").map(({ text }) => text),
    ["|"],
  );
  assert.deepEqual(
    nodes(tree, "repetition_modifier").map(({ text }) => text),
    ["?", "?"],
  );
  assert.deepEqual(
    nodes(tree, "repetition_modifier").map((modifier) => {
      const modifierSymbol = modifier.parent;
      const expression = modifierSymbol?.parent;
      const operand = expression?.childForFieldName("operand");
      return {
        modifierSymbol: modifierSymbol?.type,
        expression: expression?.type,
        operand: operand?.type,
        baseOperator: operand?.childForFieldName("operator")?.text,
        modifierOperator: modifier.childForFieldName("operator")?.type,
      };
    }),
    [
      {
        modifierSymbol: "ere_dupl_symbol",
        expression: "ere_expression",
        operand: "ere_expression",
        baseOperator: "+",
        modifierOperator: "zero_or_one_operator",
      },
      {
        modifierSymbol: "ere_dupl_symbol",
        expression: "ere_expression",
        operand: "ere_expression",
        baseOperator: "{2,3}",
        modifierOperator: "zero_or_one_operator",
      },
    ],
  );

  const interval = nodes(tree, "ere_dupl_symbol").find((node) =>
    node.childForFieldName("minimum"),
  );
  assert.ok(interval, tree.rootNode.toString());
  assert.deepEqual(
    ["opening", "minimum", "separator", "maximum", "closing"].map(
      (field) => interval.childForFieldName(field)?.text,
    ),
    ["{", "2", ",", "3", "}"],
  );

  const unmatchedClose = parse("ere", "/)/p\n");
  assertPortable(unmatchedClose);
  assert.deepEqual(
    nodes(unmatchedClose, "ordinary_character").map(({ text }) => text),
    [")"],
  );
});

test("ERE duplication recovery preserves every operator and interval", () => {
  const cases = [
    {
      source: "/a**/p\n",
      operators: ["*", "*"],
      modifiers: [],
    },
    {
      source: "/a*+?/p\n",
      operators: ["*", "+", "?"],
      modifiers: ["?"],
    },
    {
      source: "/a*??/p\n",
      operators: ["*", "?", "?"],
      modifiers: ["?"],
    },
    {
      source: "/a*{2}?/p\n",
      operators: ["*", "{2}", "?"],
      modifiers: ["?"],
    },
  ];

  for (const { source, operators, modifiers } of cases) {
    const tree = parse("ere", source);
    assertNoNativeError(tree);
    assert.deepEqual(
      issueRecords(tree).map(({ outcome, reason }) => [outcome, reason]),
      [["undefined_syntax", "adjacent_duplication_symbol"]],
      tree.rootNode.toString(),
    );
    assert.deepEqual(
      nodes(tree, "ere_dupl_symbol").map(({ text }) => text),
      operators,
      tree.rootNode.toString(),
    );
    assert.deepEqual(
      nodes(tree, "repetition_modifier").map(({ text }) => text),
      modifiers,
      tree.rootNode.toString(),
    );
  }

  for (const source of ["/{2}/p\n", "/*?/p\n"]) {
    const tree = parse("ere", source);
    assertNoNativeError(tree);
    assert.deepEqual(
      issueReasons(tree),
      ["leading_duplication_symbol"],
      tree.rootNode.toString(),
    );
  }

  const leadingInterval = parse("ere", "/{2}/p\n");
  const leadingOperator = only(
    leadingInterval,
    "leading_ere_dupl_symbol",
  ).childForFieldName("operator");
  assert.equal(leadingOperator?.type, "ere_dupl_symbol");
  assert.deepEqual(
    ["opening", "minimum", "closing"].map(
      (field) => leadingOperator.childForFieldName(field)?.text,
    ),
    ["{", "2", "}"],
  );

  const adjacentInterval = parse("ere", "/a*{2}/p\n");
  const interval = nodes(adjacentInterval, "ere_dupl_symbol").find(
    (node) => node.childForFieldName("minimum") !== null,
  );
  assert.ok(interval, adjacentInterval.rootNode.toString());
  assert.deepEqual(
    ["opening", "minimum", "closing"].map(
      (field) => interval.childForFieldName(field)?.text,
    ),
    ["{", "2", "}"],
  );
});

test("bracket expressions expose every POSIX list and term production", () => {
  const tree = parse("bre", "/[^]a-c[:alpha:][.].][=a=]-]/p\n");
  assertPortable(tree);

  const bracket = only(tree, "bracket_expression");
  assert.equal(bracket.childForFieldName("list")?.type, "nonmatching_list");
  assert.equal(only(tree, "range_expression").text, "a-c");

  const characterClass = only(tree, "character_class");
  assert.deepEqual(
    ["opening", "name", "closing"].map(
      (field) => characterClass.childForFieldName(field)?.text,
    ),
    ["[:", "alpha", ":]"],
  );

  const collatingSymbol = only(tree, "collating_symbol");
  assert.deepEqual(
    ["opening", "element", "closing"].map((field) => {
      const value = collatingSymbol.childForFieldName(field);
      return [value?.type, value?.text];
    }),
    [
      ["open_dot", "[."],
      ["meta_char", "]"],
      ["dot_close", ".]"],
    ],
  );

  const equivalenceClass = only(tree, "equivalence_class");
  assert.deepEqual(
    ["opening", "element", "closing"].map((field) => {
      const value = equivalenceClass.childForFieldName(field);
      return [value?.type, value?.text];
    }),
    [
      ["open_equal", "[="],
      ["coll_elem_single", "a"],
      ["equal_close", "=]"],
    ],
  );
  assert.equal(
    only(tree, "bracket_list").childForFieldName("trailing_hyphen")?.text,
    "-",
  );
});

test("collating terms expose the POSIX lexical alternatives", () => {
  for (const variant of variantIds) {
    const tree = parse(variant, "/[[.a.]][[.ch.]][[.-.]][[=a=]][[=ch=]]/p\n");
    assertPortable(tree);
    assert.deepEqual(
      nodes(tree, "collating_symbol").map((node) => {
        const element = node.childForFieldName("element");
        return [element?.type, element?.text];
      }),
      [
        ["coll_elem_single", "a"],
        ["coll_elem_multi", "ch"],
        ["meta_char", "-"],
      ],
    );
    assert.deepEqual(
      nodes(tree, "equivalence_class").map((node) => {
        const element = node.childForFieldName("element");
        return [element?.type, element?.text];
      }),
      [
        ["coll_elem_single", "a"],
        ["coll_elem_multi", "ch"],
      ],
    );
  }
});

test("range expressions retain both POSIX ending alternatives", () => {
  for (const variant of variantIds) {
    const tree = parse(variant, "/[%--][--@][a--@][a-]/p\n");
    assertPortable(tree);
    const ranges = nodes(tree, "range_expression");
    assert.deepEqual(
      ranges.map(({ text }) => text),
      ["%--", "--@", "a--"],
    );

    for (const range of [ranges[0], ranges[2]]) {
      assert.equal(range.childForFieldName("end"), null);
      assert.equal(
        range.childForFieldName("ending_hyphen")?.type,
        "range_end_hyphen",
      );
    }

    assert.equal(ranges[1].childForFieldName("end")?.type, "end_range");
    assert.equal(ranges[1].childForFieldName("ending_hyphen"), null);
    assert.equal(
      nodes(tree, "bracket_list").at(-1)?.childForFieldName("trailing_hyphen")
        ?.type,
      "trailing_hyphen",
    );
  }
});

test("syntax issues have stable outcome and reason layers", () => {
  const cases = [
    [
      "ere",
      "/[a-[:alpha:]]/p\n",
      "undefined_syntax",
      "character_class_range_end",
    ],
    [
      "ere",
      "/[[:alpha:]-z]/p\n",
      "undefined_syntax",
      "character_class_range_start",
    ],
    [
      "bre",
      "/[a-[=b=]]/p\n",
      "unspecified_syntax",
      "equivalence_class_range_end",
    ],
    ["bre", "/[[.x]/p\n", "undefined_syntax", "malformed_bracket_term"],
    [
      "bre",
      "/\\?/p\n",
      "implementation_defined_syntax",
      "bre_question_mark_escape",
    ],
    [
      "bre",
      "/[[=a=]-z]/p\n",
      "unspecified_syntax",
      "equivalence_class_range_start",
    ],
    ["bre", ",p\n", "undefined_syntax", "omitted_address"],
    ["bre", "1! p\n", "unspecified_syntax", "blanks_after_negation"],
    [
      "bre",
      "rfile\n",
      "implementation_option_syntax",
      "omitted_file_separator",
    ],
    ["bre", "a\\\ntext\\", "unspecified_syntax", "unspecified_text_escape"],
    ["bre", "1,2q\n", "nonconforming_syntax", "excess_addresses"],
    ["bre", "r\n", "incomplete_syntax", "missing_rfile"],
  ];

  for (const [variant, source, outcome, reason] of cases) {
    const tree = parse(variant, source);
    assertNoNativeError(tree);
    assert.ok(
      issueRecords(tree).some(
        (issue) => issue.outcome === outcome && issue.reason === reason,
      ),
      `${source}\n${tree.rootNode.toString()}`,
    );
  }
});

test("known recovery shapes preserve the following command", () => {
  const cases = [
    ["bre", ",p\np\n", "omitted_address"],
    ["bre", "1 2p\np\n", "missing_address_separator"],
    ["bre", "1 ,2p\np\n", "blanks_around_address_separator"],
    ["bre", "1, 2p\np\n", "blanks_around_address_separator"],
    ["bre", "1 , 2p\np\n", "blanks_around_address_separator"],
    ["bre", "1,2,3p\n", "additional_address"],
    ["bre", "1,2 3p\n", "additional_address"],
    ["bre", "1,2,p\n", "additional_address"],
    ["bre", "1,2q\np\n", "excess_addresses"],
    ["bre", "k tail\np\n", "unknown_function"],
    ["bre", "bfoo\np\n", "unexpected_command_text"],
    ["bre", "b;p\n", "forbidden_command_separator"],
    ["bre", "bfoo;p\n", "forbidden_command_separator"],
    ["bre", "b;;p\n", "forbidden_command_separator"],
    ["bre", "!!p\np\n", "duplicate_negation"],
    ["bre", "r \np\n", "missing_rfile"],
    ["bre", "s/a/b/w \np\n", "missing_wfile"],
    ["bre", "a \\\np\n", "missing_text_introducer"],
    ["bre", "s\\\np\n", "invalid_delimiter"],
    ["bre", "/[\np\n", "missing_bracket_list"],
    ["bre", "/[[.]/p\np\n", "malformed_bracket_term"],
    ["bre", "/a\\{1,2,3\\}/p\np\n", "malformed_interval"],
    ["bre", "\\2a\\{12p\n", "malformed_interval"],
    ["ere", "/[a-m-o]/p\np\n", "shared_range_endpoint"],
    ["ere", "/(\np\n", "missing_subexpression"],
    ["ere", "/(a\np\n", "unclosed_subexpression"],
    ["ere", "/a\\\np\n", "incomplete_regular_expression_escape"],
    ["ere", "\\2a{12p\n", "malformed_interval"],
    ["bre", "y/a/b\\\np\n", "undefined_translation_escape"],
  ];

  for (const [variant, source, reason] of cases) {
    const tree = parse(variant, source);
    assertNoNativeError(tree);
    assert.ok(
      issueRecords(tree).some((issue) => issue.reason === reason),
      `${source}\n${tree.rootNode.toString()}`,
    );
    assert.equal(selectedFunctionTypes(tree).at(-1), "print_function", source);
  }

  const recoveredBlock = parse("bre", "{b;;p;}\n");
  assertNoNativeError(recoveredBlock);
  assert.deepEqual(selectedFunctionTypes(recoveredBlock), [
    "block_function",
    "branch_function",
    "print_function",
  ]);
  assert.ok(
    issueRecords(recoveredBlock).some(
      ({ reason }) => reason === "forbidden_command_separator",
    ),
  );

  const excessAddress = only(parse("bre", "1,2,3p\n"), "excess_address");
  assert.deepEqual(
    ["separator", "address"].map(
      (field) => excessAddress.childForFieldName(field)?.text,
    ),
    [",", "3"],
  );
});

test("brace recovery preserves command structure", () => {
  for (const variant of variantIds) {
    const block = parse(variant, "{ }\np\n");
    assertNoNativeError(block);
    assert.deepEqual(issueReasons(block), ["missing_command_separator"]);
    assert.deepEqual(selectedFunctionTypes(block), [
      "block_function",
      "print_function",
    ]);
    assert.equal(
      only(block, "block_function")
        .childForFieldName("commands")
        ?.descendantsOfType("editing_command").length,
      0,
    );

    const unmatched = parse(variant, "p}\np\n");
    assertNoNativeError(unmatched);
    assert.deepEqual(issueReasons(unmatched), [
      "missing_command_separator",
      "unmatched_closing_brace",
    ]);
    assert.deepEqual(selectedFunctionTypes(unmatched), [
      "print_function",
      "print_function",
    ]);

    const unclosed = parse(variant, "{ ");
    assertNoNativeError(unclosed);
    assert.deepEqual(issueReasons(unclosed), [
      "missing_command_separator",
      "missing_closing_brace",
    ]);
  }
});

test("address recovery preserves omitted and excess addresses", () => {
  for (const variant of variantIds) {
    const omitted = parse(variant, "1,   p\np\n");
    assertNoNativeError(omitted);
    assert.deepEqual(issueReasons(omitted), [
      "blanks_around_address_separator",
      "omitted_address",
    ]);
    assert.deepEqual(selectedFunctionTypes(omitted), [
      "print_function",
      "print_function",
    ]);

    const separated = parse(variant, "1,2 , 3p\n");
    assertNoNativeError(separated);
    assert.deepEqual(issueReasons(separated), [
      "additional_address",
      "blanks_around_address_separator",
    ]);
    assert.equal(only(separated, "excess_address").text, " , 3");

    for (const source of ["1,2,3q\n", "1,2,3:foo\n"]) {
      const excessive = parse(variant, source);
      assertNoNativeError(excessive);
      assert.deepEqual(issueReasons(excessive), [
        "additional_address",
        "excess_addresses",
      ]);
    }
  }
});

test("address separators expose concrete comma tokens independently from recovery", () => {
  const cases = [
    ["1,2p\n", [1, 2], []],
    ["1 ,2p\n", [2, 3], ["blanks_around_address_separator"]],
    ["1, 2p\n", [1, 2], ["blanks_around_address_separator"]],
    ["1 2p\n", undefined, ["missing_address_separator"]],
  ];

  for (const variant of variantIds) {
    for (const [source, tokenRange, reasons] of cases) {
      const tree = parse(variant, source);
      assertNoNativeError(tree);
      assert.deepEqual(issueReasons(tree), reasons, source);

      const token = only(tree, "address_separator").childForFieldName("token");
      if (tokenRange === undefined) {
        assert.equal(token, null, source);
      } else {
        assert.equal(token?.type, "address_separator_token", source);
        assert.equal(token?.text, ",", source);
        assert.deepEqual(
          [token?.startIndex, token?.endIndex],
          tokenRange,
          source,
        );
      }
    }
  }
});

test("POSIX ambiguity is exposed instead of selecting an implementation", () => {
  for (const [source, positionIssue] of [
    ["/\\?/p\n", "leading_duplication_symbol"],
    ["/a*\\?/p\n", "adjacent_duplication_symbol"],
  ]) {
    const tree = parse("bre", source);
    assertNoNativeError(tree);
    assert.deepEqual(
      issueRecords(tree),
      [
        {
          outcome: "undefined_syntax",
          reason: positionIssue,
          text: "",
        },
        {
          outcome: "implementation_defined_syntax",
          reason: "bre_question_mark_escape",
          text: "",
        },
      ],
      tree.rootNode.toString(),
    );
    assert.equal(only(tree, "back_qm").text, "\\?");
  }

  const breAlternation = parse("bre", "/a\\|b/p\n");
  assert.equal(
    only(breAlternation, "context_address")
      .childForFieldName("expression")
      ?.childForFieldName("operator")?.type,
    "bre_alternation_operator",
  );
  assert.equal(only(breAlternation, "back_bar").text, "\\|");

  const duplicationAfterBreAlternation = parse("bre", "/a\\|*/p\n");
  assertNoNativeError(duplicationAfterBreAlternation);
  assert.deepEqual(
    issueRecords(duplicationAfterBreAlternation).map(({ outcome, reason }) => [
      outcome,
      reason,
    ]),
    [["implementation_defined_syntax", "bre_vertical_line_escape"]],
  );
  assert.deepEqual(
    nodes(duplicationAfterBreAlternation, "ordinary_character").map(
      ({ text }) => text,
    ),
    ["a", "*"],
  );

  for (const variant of variantIds) {
    for (const source of ["/[.a.]/p\n", "/[=a=]/p\n", "/[:alpha:]/p\n"]) {
      const tree = parse(variant, source);
      assertNoNativeError(tree);
      assert.ok(
        issueRecords(tree).some(
          ({ outcome, reason }) =>
            outcome === "unspecified_syntax" &&
            reason === "ambiguous_bracket_expression",
        ),
        tree.rootNode.toString(),
      );
    }

    assertPortable(parse(variant, "/[::][_:.]/p\n"));
  }

  const specialRegexDelimiter = parse("ere", "\\*a\\**p\n");
  assertNoNativeError(specialRegexDelimiter);
  assert.ok(
    issueRecords(specialRegexDelimiter).some(
      ({ outcome, reason }) =>
        outcome === "unspecified_syntax" &&
        reason === "special_delimiter_escape",
    ),
  );

  const ampersandReplacementDelimiter = parse("bre", "s&a&\\&&\n");
  assertNoNativeError(ampersandReplacementDelimiter);
  assert.ok(
    issueRecords(ampersandReplacementDelimiter).some(
      ({ outcome, reason }) =>
        outcome === "unspecified_syntax" &&
        reason === "replacement_ampersand_delimiter_escape",
    ),
  );
});

test("semantic constraints remain outside the parser", () => {
  const cases = [
    ["bre", "/\\9/p\n"],
    ["bre", "y/aa/b/\n"],
    ["bre", ":same\n:same\nb absent\n"],
    ["bre", "s/a/b/g2\n"],
    ["bre", "//p\ns//x/\n"],
    ["bre", "/a\\{3,2\\}/p\n"],
    ["bre", "/a\\{999999999999999999999999\\}/p\n"],
    ["ere", "/a{3,2}/p\n"],
  ];

  for (const [variant, source] of cases) {
    assertPortable(parse(variant, source));
  }
});

test("ordinary regular-expression characters are individual code points", () => {
  for (const variant of variantIds) {
    const tree = parse(variant, "/😺犬/p\n");
    assertPortable(tree);
    assert.deepEqual(
      nodes(tree, "ordinary_character").map(({ text }) => text),
      ["😺", "犬"],
    );
  }
});

test("a non-ASCII delimiter remains one delimiter token", () => {
  for (const variant of variantIds) {
    const tree = parse(variant, "s😺猫😺犬😺g\n");
    assertPortable(tree);
    assert.deepEqual(
      nodes(tree, "delimiter").map(({ text }) => text),
      ["😺", "😺", "😺"],
    );
  }
});

test("empty physical lines and leading semicolons do not duplicate nodes", () => {
  const tree = parse("bre", " \t\n;;;p\n\n");
  assertPortable(tree);
  assert.equal(nodes(tree, "empty_command").length, 3);
  assert.equal(nodes(tree, "command_separator").length, 6);
  assert.deepEqual(selectedFunctionTypes(tree), ["print_function"]);
});

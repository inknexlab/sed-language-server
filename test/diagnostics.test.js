import assert from "node:assert/strict";
import test from "node:test";
import { DiagnosticSeverity } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { createDiagnostics } from "../src/diagnostics.js";
import { invalidateSyntaxTreeCache, syntaxTreeFor } from "../src/syntax.js";

const posixBre = { dialect: "posix", regex: "bre" };
const posixEre = { dialect: "posix", regex: "ere" };
const gnuBre = { dialect: "gnu", regex: "bre" };
const gnuEre = { dialect: "gnu", regex: "ere" };

function documentFor(source) {
  return TextDocument.create("file:///diagnostics.sed", "sed", 1, source);
}

function diagnosticsFor(source, syntax = posixBre) {
  return createDiagnostics(documentFor(source), syntax);
}

function summariesFor(source, syntax = posixBre) {
  return diagnosticsFor(source, syntax).map(({ code, message, range }) => ({
    code,
    message,
    range,
  }));
}

test("accepts valid scripts in each selected syntax variant", () => {
  assert.deepEqual(summariesFor(":loop\ns/foo/bar/g\nb loop\n", posixBre), []);
  assert.deepEqual(summariesFor("s/(foo)+/bar/g\n", posixEre), []);
  assert.deepEqual(summariesFor("0~2p\nz\nT loop\n:loop\n", gnuBre), []);
  assert.deepEqual(summariesFor("s/(a|b)+/\\1/\n", gnuEre), []);
});

test("bundles the current regular expression CST in every Wasm grammar", () => {
  const document = documentFor("s#^a.\\.\\n[^a-z]$#x#");
  const expectedParts = [
    ["regex_beginning_anchor", "^"],
    ["regex_literal", "a"],
    ["regex_wildcard", "."],
    ["regex_quoted_escape", "\\."],
    ["regex_newline_escape", "\\n"],
    ["bracket_expression", "[^a-z]"],
    ["regex_end_anchor", "$"],
  ];

  for (const syntax of [posixBre, posixEre, gnuBre, gnuEre]) {
    const tree = syntaxTreeFor(document, syntax);
    const regex = tree.rootNode.descendantsOfType("regex")[0];
    assert.deepEqual(
      regex.namedChildren.map((node) => [node.type, node.text]),
      expectedParts,
      `${syntax.dialect}-${syntax.regex}`,
    );

    const bracket = regex.descendantsOfType("bracket_expression")[0];
    assert.deepEqual(
      bracket.namedChildren.map((node) => [node.type, node.text]),
      [
        ["regex_bracket_delimiter", "["],
        ["regex_bracket_negation", "^"],
        ["regex_bracket_literal", "a"],
        ["regex_bracket_hyphen", "-"],
        ["regex_bracket_literal", "z"],
        ["regex_bracket_delimiter", "]"],
      ],
      `${syntax.dialect}-${syntax.regex}`,
    );
    assert.equal(
      bracket.childForFieldName("opening_delimiter").type,
      "regex_bracket_delimiter",
    );
    assert.equal(
      bracket.childForFieldName("negation").type,
      "regex_bracket_negation",
    );
    assert.equal(
      bracket.childForFieldName("closing_delimiter").type,
      "regex_bracket_delimiter",
    );
  }

  invalidateSyntaxTreeCache(document);
});

test("uses separate POSIX and GNU grammars", () => {
  assert.deepEqual(diagnosticsFor("z\n", posixBre), [
    {
      severity: DiagnosticSeverity.Error,
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
      message: "Unknown sed command: `z`.",
      code: "invalid-command",
      source: "sed-language-server",
    },
  ]);
  assert.deepEqual(diagnosticsFor("z\n", gnuBre), []);
});

test("enforces command address limits", () => {
  assert.deepEqual(summariesFor("1,2q"), [
    {
      code: "too-many-addresses",
      message: "The `q` command accepts at most one address.",
      range: {
        start: { line: 0, character: 2 },
        end: { line: 0, character: 3 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("1:label"), [
    {
      code: "too-many-addresses",
      message: "The `:` command does not accept an address.",
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("1,2a\\\ntext"), [
    {
      code: "too-many-addresses",
      message: "The `a` command accepts at most one address.",
      range: {
        start: { line: 0, character: 2 },
        end: { line: 0, character: 3 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("1,2Q", gnuBre), [
    {
      code: "too-many-addresses",
      message: "The `Q` command accepts at most one address.",
      range: {
        start: { line: 0, character: 2 },
        end: { line: 0, character: 3 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("1,2c\\\ntext"), []);
  assert.deepEqual(summariesFor("1,2a text", gnuBre), []);
  assert.deepEqual(summariesFor("1,2r file", gnuBre), []);
  assert.deepEqual(summariesFor("# comment"), []);
  assert.deepEqual(summariesFor("1# comment"), [
    {
      code: "too-many-addresses",
      message: "The `#` command does not accept an address.",
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("1# comment", gnuBre), [
    {
      code: "too-many-addresses",
      message: "The `#` command does not accept an address.",
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
    },
  ]);
});

test("accepts GNU zero addresses only in their defined contexts", () => {
  const expected = [
    {
      code: "invalid-address",
      message: "Address `0` is only valid in `0,/RE/`, `0r file`, or `0~N`.",
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
    },
  ];

  assert.deepEqual(summariesFor("0p", gnuBre), expected);
  assert.deepEqual(summariesFor("0,2p", gnuBre), expected);
  assert.deepEqual(summariesFor("0,/value/p", gnuBre), []);
  assert.deepEqual(summariesFor("0,\\%value%p", gnuBre), []);
  assert.deepEqual(summariesFor("0r file", gnuBre), []);
  assert.deepEqual(summariesFor("0~2p", gnuBre), []);
});

test("reports concrete POSIX errors without comparing dialects", () => {
  assert.deepEqual(summariesFor("0~2p\n", posixBre), [
    {
      code: "invalid-address",
      message: "Invalid address syntax: `0~2`.",
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 3 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("1,+2p\n", posixBre), [
    {
      code: "missing-address",
      message: "Expected an address after `,`.",
      range: {
        start: { line: 0, character: 2 },
        end: { line: 0, character: 3 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("s/a/b/I\n", posixBre), [
    {
      code: "invalid-substitution-flag",
      message: "Unknown substitution flag: `I`.",
      range: {
        start: { line: 0, character: 6 },
        end: { line: 0, character: 7 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("{\nd}\n", posixBre), [
    {
      code: "missing-command-separator",
      message: "Expected a newline or `;` before `}`.",
      range: {
        start: { line: 1, character: 1 },
        end: { line: 1, character: 2 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("0p\n", posixBre), [
    {
      code: "invalid-address",
      message: "Invalid address syntax: `0`.",
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("0a", posixBre), [
    {
      code: "invalid-address",
      message: "Invalid address syntax: `0`.",
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("{0}", posixBre), [
    {
      code: "invalid-address",
      message: "Invalid address syntax: `0`.",
      range: {
        start: { line: 0, character: 1 },
        end: { line: 0, character: 2 },
      },
    },
  ]);
});

test("converts grammar recovery nodes into specific diagnostics", () => {
  assert.deepEqual(summariesFor("p junk"), [
    {
      code: "unexpected-text",
      message: "Unexpected text after `p`: `junk`.",
      range: {
        start: { line: 0, character: 2 },
        end: { line: 0, character: 6 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("s/a/b/x\n"), [
    {
      code: "invalid-substitution-flag",
      message: "Unknown substitution flag: `x`.",
      range: {
        start: { line: 0, character: 6 },
        end: { line: 0, character: 7 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("s/foo\n"), [
    {
      code: "unterminated-regular-expression",
      message: 'Expected delimiter "/" to close the regular expression.',
      range: {
        start: { line: 0, character: 1 },
        end: { line: 0, character: 5 },
      },
    },
  ]);
});

test("expands empty recovery markers over the malformed text", () => {
  assert.deepEqual(
    summariesFor(
      "sd/^name:\\([[:alpha:]][[:alpha:]]*\\)$/name=[\\1] original=&/\n",
    ),
    [
      {
        code: "unterminated-regular-expression",
        message: 'Expected delimiter "d" to close the regular expression.',
        range: {
          start: { line: 0, character: 1 },
          end: { line: 0, character: 59 },
        },
      },
    ],
  );
  assert.deepEqual(summariesFor("s/[abc/x/\n"), [
    {
      code: "unclosed-bracket-expression",
      message: "Expected `]` to close this bracket expression.",
      range: {
        start: { line: 0, character: 2 },
        end: { line: 0, character: 9 },
      },
    },
  ]);
});

test("groups only contiguous invalid substitution flags", () => {
  assert.deepEqual(summariesFor("s/a/b/uplicate=\\1/\ns/x/y/xgy\n"), [
    {
      code: "invalid-substitution-flag",
      message: "Unknown substitution flag: `u`.",
      range: {
        start: { line: 0, character: 6 },
        end: { line: 0, character: 7 },
      },
    },
    {
      code: "invalid-substitution-flag",
      message: "Unknown substitution flag: `l`.",
      range: {
        start: { line: 0, character: 8 },
        end: { line: 0, character: 9 },
      },
    },
    {
      code: "invalid-substitution-flag",
      message: "Unknown substitution flags: `c`, `a`, `t`, `e`, `=`, `\\`.",
      range: {
        start: { line: 0, character: 10 },
        end: { line: 0, character: 16 },
      },
    },
    {
      code: "invalid-substitution-flag",
      message: "Unknown substitution flag: `/`.",
      range: {
        start: { line: 0, character: 17 },
        end: { line: 0, character: 18 },
      },
    },
    {
      code: "invalid-substitution-flag",
      message: "Unknown substitution flag: `x`.",
      range: {
        start: { line: 1, character: 6 },
        end: { line: 1, character: 7 },
      },
    },
    {
      code: "invalid-substitution-flag",
      message: "Unknown substitution flag: `y`.",
      range: {
        start: { line: 1, character: 8 },
        end: { line: 1, character: 9 },
      },
    },
  ]);
});

test("keeps recovery diagnostics on the offending text", () => {
  assert.deepEqual(summariesFor("k junk\n"), [
    {
      code: "invalid-command",
      message: "Unknown sed command: `k`.",
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("/foo\\"), [
    {
      code: "incomplete-escape",
      message: "Expected a character after `\\`.",
      range: {
        start: { line: 0, character: 4 },
        end: { line: 0, character: 5 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("1,,p\n", gnuBre), [
    {
      code: "missing-address",
      message: "Expected an address after `,`.",
      range: {
        start: { line: 0, character: 2 },
        end: { line: 0, character: 3 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("1~x\n"), [
    {
      code: "invalid-address",
      message: "Unexpected text after address `1`: `~x`.",
      range: {
        start: { line: 0, character: 1 },
        end: { line: 0, character: 3 },
      },
    },
  ]);
});

test("keeps adjacent errors separate", () => {
  assert.deepEqual(summariesFor("s/a/b/x}"), [
    {
      code: "invalid-substitution-flag",
      message: "Unknown substitution flag: `x`.",
      range: {
        start: { line: 0, character: 6 },
        end: { line: 0, character: 7 },
      },
    },
    {
      code: "unmatched-closing-brace",
      message: "Unexpected `}`; no block is open.",
      range: {
        start: { line: 0, character: 7 },
        end: { line: 0, character: 8 },
      },
    },
  ]);
});

test("reports regular expression semantic errors", () => {
  assert.deepEqual(summariesFor("s/a/\\2/"), [
    {
      code: "invalid-backreference",
      message: "Back-reference `\\2` has no matching regular expression group.",
      range: {
        start: { line: 0, character: 4 },
        end: { line: 0, character: 6 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("s/\\(a/x/"), [
    {
      code: "invalid-regular-expression",
      message: "Expected `\\)` to close this regular expression group.",
      range: {
        start: { line: 0, character: 2 },
        end: { line: 0, character: 4 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("s/[z-a]/x/"), []);
  assert.deepEqual(summariesFor("s//x/"), [
    {
      code: "missing-previous-regular-expression",
      message:
        "An empty regular expression requires a previous regular expression.",
      range: {
        start: { line: 0, character: 1 },
        end: { line: 0, character: 3 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("/a/p\ns//x/"), []);
  assert.deepEqual(summariesFor("s/\\(a\\)\\1/\\1/\ns/[a-z]/x/"), []);
});

test("reports invalid quantifiers, intervals, and POSIX character classes", () => {
  assert.deepEqual(summariesFor("s/*a/x/", posixBre), []);
  assert.deepEqual(summariesFor("s/*a/x/", posixEre), [
    {
      code: "invalid-regular-expression",
      message: "Regular expression operator `*` has no preceding expression.",
      range: {
        start: { line: 0, character: 2 },
        end: { line: 0, character: 3 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("s/*a/x/", gnuBre), [
    {
      code: "invalid-regular-expression",
      message: "Regular expression operator `*` has no preceding expression.",
      range: {
        start: { line: 0, character: 2 },
        end: { line: 0, character: 3 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("s/a{word}/x/", posixEre), []);
  assert.deepEqual(summariesFor("s/😀**/x/", posixEre), [
    {
      code: "invalid-regular-expression",
      message: "Regular expression operator `*` has no preceding expression.",
      range: {
        start: { line: 0, character: 5 },
        end: { line: 0, character: 6 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("s/a{2,1}/x/", posixEre), [
    {
      code: "invalid-regular-expression",
      message: "Invalid regular expression interval: `{2,1}`.",
      range: {
        start: { line: 0, character: 3 },
        end: { line: 0, character: 8 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("s/a{256}/x/", posixEre), [
    {
      code: "invalid-regular-expression",
      message: "Invalid regular expression interval: `{256}`.",
      range: {
        start: { line: 0, character: 3 },
        end: { line: 0, character: 8 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("s/a\\{255\\}/x/", posixBre), []);
  assert.deepEqual(summariesFor("s/a\\{256\\}/x/", posixBre), [
    {
      code: "invalid-regular-expression",
      message: "Invalid regular expression interval: `\\{256\\}`.",
      range: {
        start: { line: 0, character: 3 },
        end: { line: 0, character: 10 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("s/a{32767}/x/", gnuEre), []);
  assert.deepEqual(summariesFor("s/a{32768}/x/", gnuEre), [
    {
      code: "invalid-regular-expression",
      message: "Invalid regular expression interval: `{32768}`.",
      range: {
        start: { line: 0, character: 3 },
        end: { line: 0, character: 10 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("s/[[:bogus:]]/x/", posixEre), [
    {
      code: "invalid-regular-expression",
      message: "Unknown POSIX character class: `[:bogus:]`.",
      range: {
        start: { line: 0, character: 3 },
        end: { line: 0, character: 12 },
      },
    },
  ]);
});

test("tracks escaped regular expression addresses in regex history and validation", () => {
  assert.deepEqual(summariesFor("\\%%p", gnuBre), [
    {
      code: "missing-previous-regular-expression",
      message:
        "An empty regular expression requires a previous regular expression.",
      range: {
        start: { line: 0, character: 1 },
        end: { line: 0, character: 3 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("\\%value%p\ns//x/", gnuBre), []);
  assert.deepEqual(summariesFor("\\%*a%p", gnuEre), [
    {
      code: "invalid-regular-expression",
      message: "Regular expression operator `*` has no preceding expression.",
      range: {
        start: { line: 0, character: 2 },
        end: { line: 0, character: 3 },
      },
    },
  ]);
});

test("applies GNU escapes before analyzing regular expression syntax", () => {
  assert.deepEqual(summariesFor("s/\\x28a\\x29/\\1/", gnuEre), []);
  assert.deepEqual(summariesFor("s/\\x5c\\x28a\\x5c\\x29/\\1/", gnuBre), []);
  assert.deepEqual(summariesFor("s/\\x29/x/", gnuEre), [
    {
      code: "invalid-regular-expression",
      message: "Unexpected `\\x29`; no regular expression group is open.",
      range: {
        start: { line: 0, character: 2 },
        end: { line: 0, character: 6 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("s/a\\c;2,1}/x/", gnuEre), [
    {
      code: "invalid-regular-expression",
      message: "Invalid regular expression interval: `\\c;2,1}`.",
      range: {
        start: { line: 0, character: 3 },
        end: { line: 0, character: 10 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("s/\\x5babc/x/", gnuEre), [
    {
      code: "unclosed-bracket-expression",
      message: "Expected `]` to close this bracket expression.",
      range: {
        start: { line: 0, character: 2 },
        end: { line: 0, character: 9 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("s/\\x5c/x/", gnuBre), [
    {
      code: "incomplete-escape",
      message: "Expected a character after `\\`.",
      range: {
        start: { line: 0, character: 2 },
        end: { line: 0, character: 6 },
      },
    },
  ]);
});

test("decodes escaped numeric delimiters in GNU regular expressions", () => {
  assert.deepEqual(summariesFor("s4\\x\\44x4", gnuBre), []);
  assert.deepEqual(summariesFor("s8\\x2\\8a\\x298\\18", gnuEre), []);
  assert.deepEqual(summariesFor("s0\\d4\\0a\\d410\\10", gnuEre), []);
  assert.deepEqual(summariesFor("s0\\o5\\0a\\o510\\10", gnuEre), []);
});

test("validates ERE groups and pattern back-references by dialect", () => {
  assert.deepEqual(summariesFor("s/(a)\\1/\\1/", gnuEre), []);
  assert.deepEqual(summariesFor("s/(a)\\1/\\1/", posixEre), [
    {
      code: "unsupported-pattern-backreference",
      message: "Pattern back-references are not supported.",
      range: {
        start: { line: 0, character: 5 },
        end: { line: 0, character: 7 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("s(\\(a(x(", gnuEre), [
    {
      code: "invalid-regular-expression",
      message: "Expected `)` to close this regular expression group.",
      range: {
        start: { line: 0, character: 2 },
        end: { line: 0, character: 4 },
      },
    },
  ]);
});

test("tracks nested groups and back-references in GNU BRE and ERE", () => {
  assert.deepEqual(summariesFor("s/\\(\\(a\\)\\2\\)/\\1/", gnuBre), []);
  assert.deepEqual(summariesFor("s/((a)\\2)/\\1/", gnuEre), []);
});

test("keeps inactive group spellings literal and separates cached BRE and ERE trees", () => {
  assert.deepEqual(summariesFor("s/(a)/\\1/", posixBre), [
    {
      code: "invalid-backreference",
      message: "Back-reference `\\1` has no matching regular expression group.",
      range: {
        start: { line: 0, character: 6 },
        end: { line: 0, character: 8 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("s/(a)/\\1/", gnuEre), []);
  assert.deepEqual(summariesFor("s/\\(a\\)/\\1/", gnuEre), [
    {
      code: "invalid-backreference",
      message: "Back-reference `\\1` has no matching regular expression group.",
      range: {
        start: { line: 0, character: 8 },
        end: { line: 0, character: 10 },
      },
    },
  ]);
});

test("handles unmatched group closes according to the selected syntax", () => {
  assert.deepEqual(summariesFor("s/a\\)/x/", posixBre), [
    {
      code: "invalid-regular-expression",
      message: "Unexpected `\\)`; no regular expression group is open.",
      range: {
        start: { line: 0, character: 3 },
        end: { line: 0, character: 5 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("s/a)/x/", posixEre), []);
  assert.deepEqual(summariesFor("s/a)/x/", gnuEre), [
    {
      code: "invalid-regular-expression",
      message: "Unexpected `)`; no regular expression group is open.",
      range: {
        start: { line: 0, character: 3 },
        end: { line: 0, character: 4 },
      },
    },
  ]);
});

test("reports translation and numeric semantic errors", () => {
  assert.deepEqual(summariesFor("y/ab/c/", gnuBre), [
    {
      code: "mismatched-translation-length",
      message:
        "The `y` command requires source and destination strings of equal length (2 and 1).",
      range: {
        start: { line: 0, character: 1 },
        end: { line: 0, character: 7 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("s/a/b/0"), [
    {
      code: "invalid-substitution-occurrence",
      message: "The substitution occurrence must be greater than zero.",
      range: {
        start: { line: 0, character: 6 },
        end: { line: 0, character: 7 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("50~0p", gnuBre), []);
  assert.deepEqual(summariesFor("1,~0p", gnuBre), []);
  assert.deepEqual(summariesFor("0~0p", gnuBre), [
    {
      code: "invalid-address",
      message: "Address `0` is only valid in `0,/RE/`, `0r file`, or `0~N`.",
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("y/\\n/x/"), []);
  assert.deepEqual(summariesFor("y/\\x41/B/", gnuBre), []);
  assert.deepEqual(summariesFor("y/\\o101/B/", gnuBre), []);
  assert.deepEqual(summariesFor("y/\\d065/B/", gnuBre), []);
  assert.deepEqual(summariesFor("y/\\cA/B/", gnuBre), []);
});

test("rejects GNU substitution flags that may only occur once", () => {
  assert.deepEqual(summariesFor("s/a/b/gg", gnuBre), [
    {
      code: "invalid-substitution-flag",
      message: "The `g` substitution flag may only be specified once.",
      range: {
        start: { line: 0, character: 7 },
        end: { line: 0, character: 8 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("s/a/b/pp", gnuBre), [
    {
      code: "invalid-substitution-flag",
      message: "The `p` substitution flag may only be specified once.",
      range: {
        start: { line: 0, character: 7 },
        end: { line: 0, character: 8 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("s/a/b/1 2", gnuBre), [
    {
      code: "invalid-substitution-flag",
      message: "A substitution occurrence may only be specified once.",
      range: {
        start: { line: 0, character: 8 },
        end: { line: 0, character: 9 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("s/a/b/iIimMmee", gnuBre), []);
});

test("rejects GNU regex modifiers on an empty reused pattern", () => {
  assert.deepEqual(summariesFor("/a/p\ns//x/I", gnuBre), [
    {
      code: "invalid-regular-expression",
      message: "Modifier `I` cannot be used with an empty regular expression.",
      range: {
        start: { line: 1, character: 5 },
        end: { line: 1, character: 6 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("/a/p\n//Mp", gnuBre), [
    {
      code: "invalid-regular-expression",
      message: "Modifier `M` cannot be used with an empty regular expression.",
      range: {
        start: { line: 1, character: 2 },
        end: { line: 1, character: 3 },
      },
    },
  ]);
});

test("reports missing GNU address and text arguments on concrete characters", () => {
  assert.deepEqual(summariesFor("0~", gnuBre), [
    {
      code: "missing-step-value",
      message: "Expected a step value after `~`.",
      range: {
        start: { line: 0, character: 1 },
        end: { line: 0, character: 2 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("1,+p", gnuBre), [
    {
      code: "missing-line-offset",
      message: "Expected a line offset after `+`.",
      range: {
        start: { line: 0, character: 2 },
        end: { line: 0, character: 3 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("1,~p", gnuBre), [
    {
      code: "missing-step-value",
      message: "Expected a step value after `~`.",
      range: {
        start: { line: 0, character: 2 },
        end: { line: 0, character: 3 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("1c", gnuBre), [
    {
      code: "missing-text-argument",
      message: "The `c` command requires a text argument.",
      range: {
        start: { line: 0, character: 1 },
        end: { line: 0, character: 2 },
      },
    },
  ]);
});

test("reports missing command arguments with actionable messages", () => {
  assert.deepEqual(summariesFor("s\n"), [
    {
      code: "missing-delimiter",
      message: "Expected a delimiter after `s`.",
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("r\n"), [
    {
      code: "missing-file-argument",
      message: "The `r` command requires a file name.",
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
    },
  ]);
  assert.deepEqual(summariesFor(":\n"), [
    {
      code: "missing-label-argument",
      message: "Expected a label name after `:`.",
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("s/a/b/w\n"), [
    {
      code: "missing-file-argument",
      message: "The `w` substitution flag requires a file name.",
      range: {
        start: { line: 0, character: 6 },
        end: { line: 0, character: 7 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("a\n"), [
    {
      code: "missing-text-argument",
      message: "Expected `\\` and text after `a`.",
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("1i"), [
    {
      code: "missing-text-argument",
      message: "Expected `\\` and text after `i`.",
      range: {
        start: { line: 0, character: 1 },
        end: { line: 0, character: 2 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("!"), [
    {
      code: "missing-command",
      message: "Expected a sed command after `!`.",
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("1!\n"), [
    {
      code: "missing-command",
      message: "Expected a sed command after `!`.",
      range: {
        start: { line: 0, character: 1 },
        end: { line: 0, character: 2 },
      },
    },
  ]);
});

test("uses dialect and command context in recovery messages", () => {
  const posixTextExpected = [
    {
      code: "missing-text-argument",
      message: "Expected `\\` and text after `a`.",
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
    },
  ];
  assert.deepEqual(summariesFor("a text"), posixTextExpected);
  assert.deepEqual(summariesFor("a hello"), posixTextExpected);

  assert.deepEqual(summariesFor("a", gnuBre), [
    {
      code: "missing-text-argument",
      message: "The `a` command requires a text argument.",
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("p;:", gnuBre), [
    {
      code: "missing-label-argument",
      message: "Expected a label name after `:`.",
      range: {
        start: { line: 0, character: 2 },
        end: { line: 0, character: 3 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("p;w", gnuBre), [
    {
      code: "missing-file-argument",
      message: "The `w` command requires a file name.",
      range: {
        start: { line: 0, character: 2 },
        end: { line: 0, character: 3 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("s/a/b/w"), [
    {
      code: "missing-file-argument",
      message: "The `w` substitution flag requires a file name.",
      range: {
        start: { line: 0, character: 6 },
        end: { line: 0, character: 7 },
      },
    },
  ]);
});

test("keeps delimiter and control escape messages readable", () => {
  assert.deepEqual(summariesFor("s`foo"), [
    {
      code: "unterminated-regular-expression",
      message: 'Expected delimiter "`" to close the regular expression.',
      range: {
        start: { line: 0, character: 1 },
        end: { line: 0, character: 5 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("s/\\c\\/x/", gnuBre), [
    {
      code: "invalid-control-escape",
      message: "The `\\c` escape must be followed by an unescaped character.",
      range: {
        start: { line: 0, character: 2 },
        end: { line: 0, character: 6 },
      },
    },
  ]);
});

test("reports unclosed blocks consistently in both dialects", () => {
  const expected = [
    {
      code: "unclosed-block",
      message: "Expected `}` to close this block.",
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
    },
  ];

  assert.deepEqual(summariesFor("{p\n", posixBre), expected);
  assert.deepEqual(summariesFor("{p\n", gnuBre), expected);
  assert.deepEqual(summariesFor("d;}", posixBre), [
    {
      code: "unmatched-closing-brace",
      message: "Unexpected `}`; no block is open.",
      range: {
        start: { line: 0, character: 2 },
        end: { line: 0, character: 3 },
      },
    },
  ]);
});

test("reports duplicate and undefined labels", () => {
  assert.deepEqual(diagnosticsFor(":known\n:known\nb missing\n"), [
    {
      severity: DiagnosticSeverity.Error,
      code: "duplicate-label",
      message: "Duplicate sed label: `known`.",
      range: {
        start: { line: 1, character: 1 },
        end: { line: 1, character: 6 },
      },
      source: "sed-language-server",
    },
    {
      severity: DiagnosticSeverity.Warning,
      code: "undefined-label",
      message:
        "No definition for sed label `missing` was found in this document.",
      range: {
        start: { line: 2, character: 2 },
        end: { line: 2, character: 9 },
      },
      source: "sed-language-server",
    },
  ]);
  assert.deepEqual(summariesFor(":known\n:known\n", gnuBre), []);
});

test("uses GNU comment and block boundaries for labels", () => {
  assert.deepEqual(
    summariesFor(":known # definition\nb known # reference\n", gnuBre),
    [],
  );
  assert.deepEqual(summariesFor("{:known}", gnuBre), []);
});

test("reports label errors alongside syntax errors", () => {
  assert.deepEqual(summariesFor(":x\n:x\nb missing\nz\n"), [
    {
      code: "duplicate-label",
      message: "Duplicate sed label: `x`.",
      range: {
        start: { line: 1, character: 1 },
        end: { line: 1, character: 2 },
      },
    },
    {
      code: "undefined-label",
      message:
        "No definition for sed label `missing` was found in this document.",
      range: {
        start: { line: 2, character: 2 },
        end: { line: 2, character: 9 },
      },
    },
    {
      code: "invalid-command",
      message: "Unknown sed command: `z`.",
      range: {
        start: { line: 3, character: 0 },
        end: { line: 3, character: 1 },
      },
    },
  ]);
});

test("prefers a specific recovery marker over a missing node at the same range", () => {
  assert.deepEqual(summariesFor("s/a/b\n", gnuBre), [
    {
      code: "unterminated-replacement",
      message: 'Expected delimiter "/" to close the replacement.',
      range: {
        start: { line: 0, character: 3 },
        end: { line: 0, character: 5 },
      },
    },
  ]);
});

test("reports parser ERROR nodes when no recovery marker is available", () => {
  assert.deepEqual(summariesFor("1,\n"), [
    {
      code: "missing-address",
      message: "Expected an address after `,`.",
      range: {
        start: { line: 0, character: 1 },
        end: { line: 0, character: 2 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("1"), [
    {
      code: "missing-command",
      message: "Expected a sed command after address `1`.",
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
    },
  ]);
});

test("preserves UTF-16 LSP ranges across Unicode and CRLF input", () => {
  assert.deepEqual(summariesFor("# 😀\r\nz\r\n"), [
    {
      code: "invalid-command",
      message: "Unknown sed command: `z`.",
      range: {
        start: { line: 1, character: 0 },
        end: { line: 1, character: 1 },
      },
    },
  ]);
});

test("does not reuse a cached tree after the document changes", () => {
  const uri = "file:///changing-diagnostics.sed";
  const invalidDocument = TextDocument.create(uri, "sed", 1, "z\n");
  const validDocument = TextDocument.create(uri, "sed", 2, "p\n");

  assert.equal(createDiagnostics(invalidDocument, posixBre).length, 1);
  assert.deepEqual(createDiagnostics(validDocument, posixBre), []);

  invalidateSyntaxTreeCache(validDocument);
});

test("normalizes many adjacent recovery issues without quadratic work", {
  timeout: 2000,
}, () => {
  assert.equal(diagnosticsFor("s/a\n".repeat(4000)).length, 4000);
});

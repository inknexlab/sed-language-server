import assert from "node:assert/strict";
import test from "node:test";
import { DiagnosticSeverity } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
import { createDiagnostics } from "../src/diagnostics.js";
import { invalidateSyntaxTreeCache } from "../src/syntax.js";

const posixDialect = "posix";
const gnuDialect = "gnu";

function documentFor(source) {
  return TextDocument.create("file:///diagnostics.sed", "sed", 1, source);
}

function diagnosticsFor(source, dialect = posixDialect) {
  return createDiagnostics(documentFor(source), dialect);
}

function summariesFor(source, dialect = posixDialect) {
  return diagnosticsFor(source, dialect).map(({ code, message, range }) => ({
    code,
    message,
    range,
  }));
}

test("accepts valid scripts in each selected dialect", () => {
  assert.deepEqual(
    summariesFor(":loop\ns/foo/bar/g\nb loop\n", posixDialect),
    [],
  );
  assert.deepEqual(summariesFor("0~2p\nz\nT loop\n:loop\n", gnuDialect), []);
});

test("uses separate POSIX and GNU grammars", () => {
  assert.deepEqual(diagnosticsFor("z\n", posixDialect), [
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
  assert.deepEqual(diagnosticsFor("z\n", gnuDialect), []);
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
  assert.deepEqual(summariesFor("1,2Q", gnuDialect), [
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
  assert.deepEqual(summariesFor("1,2a text", gnuDialect), []);
  assert.deepEqual(summariesFor("1,2r file", gnuDialect), []);
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

  assert.deepEqual(summariesFor("0p", gnuDialect), expected);
  assert.deepEqual(summariesFor("0,2p", gnuDialect), expected);
  assert.deepEqual(summariesFor("0,/value/p", gnuDialect), []);
  assert.deepEqual(summariesFor("0r file", gnuDialect), []);
  assert.deepEqual(summariesFor("0~2p", gnuDialect), []);
});

test("reports concrete POSIX errors without comparing dialects", () => {
  assert.deepEqual(summariesFor("0~2p\n", posixDialect), [
    {
      code: "invalid-address",
      message: "Invalid address syntax: `0~2`.",
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 3 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("1,+2p\n", posixDialect), [
    {
      code: "missing-address",
      message: "Expected an address after `,`.",
      range: {
        start: { line: 0, character: 2 },
        end: { line: 0, character: 3 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("s/a/b/I\n", posixDialect), [
    {
      code: "invalid-substitution-flag",
      message: "Unknown substitution flag: `I`.",
      range: {
        start: { line: 0, character: 6 },
        end: { line: 0, character: 7 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("{\nd}\n", posixDialect), [
    {
      code: "missing-command-separator",
      message: "Expected a newline or `;` before `}`.",
      range: {
        start: { line: 1, character: 1 },
        end: { line: 1, character: 2 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("0p\n", posixDialect), [
    {
      code: "invalid-address",
      message: "Invalid address syntax: `0`.",
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("0a", posixDialect), [
    {
      code: "invalid-address",
      message: "Invalid address syntax: `0`.",
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("{0}", posixDialect), [
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
  assert.deepEqual(summariesFor("1,,p\n", gnuDialect), [
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
  assert.deepEqual(summariesFor("s/[z-a]/x/"), [
    {
      code: "invalid-regular-expression",
      message: "Invalid character range: `z-a`.",
      range: {
        start: { line: 0, character: 3 },
        end: { line: 0, character: 6 },
      },
    },
  ]);
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

test("reports translation and numeric semantic errors", () => {
  assert.deepEqual(summariesFor("y/ab/c/", gnuDialect), [
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
  assert.deepEqual(summariesFor("1~0p", gnuDialect), [
    {
      code: "invalid-step-value",
      message: "The address step must be greater than zero.",
      range: {
        start: { line: 0, character: 2 },
        end: { line: 0, character: 3 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("y/\\n/x/"), []);
});

test("reports missing GNU address and text arguments on concrete characters", () => {
  assert.deepEqual(summariesFor("0~", gnuDialect), [
    {
      code: "missing-step-value",
      message: "Expected a step value after `~`.",
      range: {
        start: { line: 0, character: 1 },
        end: { line: 0, character: 2 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("1,+p", gnuDialect), [
    {
      code: "missing-line-offset",
      message: "Expected a line offset after `+`.",
      range: {
        start: { line: 0, character: 2 },
        end: { line: 0, character: 3 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("1,~p", gnuDialect), [
    {
      code: "missing-step-value",
      message: "Expected a step value after `~`.",
      range: {
        start: { line: 0, character: 2 },
        end: { line: 0, character: 3 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("1c", gnuDialect), [
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

  assert.deepEqual(summariesFor("a", gnuDialect), [
    {
      code: "missing-text-argument",
      message: "The `a` command requires a text argument.",
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 1 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("p;:", gnuDialect), [
    {
      code: "missing-label-argument",
      message: "Expected a label name after `:`.",
      range: {
        start: { line: 0, character: 2 },
        end: { line: 0, character: 3 },
      },
    },
  ]);
  assert.deepEqual(summariesFor("p;w", gnuDialect), [
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
  assert.deepEqual(summariesFor("s/\\c\\/x/", gnuDialect), [
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

  assert.deepEqual(summariesFor("{p\n", posixDialect), expected);
  assert.deepEqual(summariesFor("{p\n", gnuDialect), expected);
  assert.deepEqual(summariesFor("d;}", posixDialect), [
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
  assert.deepEqual(summariesFor(":known\n:known\nb missing\n"), [
    {
      code: "duplicate-label",
      message: "Duplicate sed label: `known`.",
      range: {
        start: { line: 1, character: 1 },
        end: { line: 1, character: 6 },
      },
    },
    {
      code: "undefined-label",
      message: "Undefined sed label: `missing`.",
      range: {
        start: { line: 2, character: 2 },
        end: { line: 2, character: 9 },
      },
    },
  ]);
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
      message: "Undefined sed label: `missing`.",
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
  assert.deepEqual(summariesFor("s/a/b\n", gnuDialect), [
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

  assert.equal(createDiagnostics(invalidDocument, posixDialect).length, 1);
  assert.deepEqual(createDiagnostics(validDocument, posixDialect), []);

  invalidateSyntaxTreeCache(validDocument);
});

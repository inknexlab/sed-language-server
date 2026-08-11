import assert from "node:assert/strict";
import test from "node:test";
import {
  diagnosticMessages,
  diagnosticSeverities,
  diagnostics,
  syntaxDiagnostics,
} from "../../src/analysis/diagnostics.js";
import { grammarManifest, SedParser } from "../../src/analysis/parser.js";

async function diagnosticsFor(source, mode = "bre", syntaxOnly = false) {
  const parser = await SedParser.create(mode);
  const tree = parser.parse(source);
  try {
    const snapshot = { mode, source, tree };
    return syntaxOnly ? syntaxDiagnostics(snapshot) : diagnostics(snapshot);
  } finally {
    tree.delete();
    parser.delete();
  }
}

function codes(values) {
  return values.map(({ code }) => code);
}

test("returns UTF-16 source offsets without LSP range conversion", async () => {
  const matching = (await diagnosticsFor(":😀\n")).find(
    ({ code }) => code === "nonportable-label",
  );
  assert.deepEqual(
    [matching?.startOffset, matching?.endOffset, matching?.severity],
    [1, 3, "warning"],
  );
});

test("defines one diagnostic message and severity for every grammar issue", () => {
  const outcomes = new Set(
    Object.values(grammarManifest().languages).flatMap(({ outcomes }) =>
      Object.keys(outcomes),
    ),
  );
  const reasons = new Set(
    Object.values(grammarManifest().languages).flatMap(({ outcomes }) =>
      Object.values(outcomes).flat(),
    ),
  );
  assert.deepEqual(
    Object.keys(diagnosticMessages()).sort(),
    [...reasons].sort(),
  );
  assert.deepEqual(
    Object.keys(diagnosticSeverities()).sort(),
    [...outcomes].sort(),
  );
  for (const message of Object.values(diagnosticMessages())) {
    assert.equal(typeof message, "string");
  }
});

test("maps syntax issue outcomes to the selected severities", async () => {
  const cases = [
    ["/a\\?/p\n", "bre-question-mark-escape", "warning"],
    ["rfile\n", "omitted-file-separator", "warning"],
    ["r\n", "missing-rfile", "error"],
    ["1,2q\n", "excess-addresses", "error"],
    [",p\n", "omitted-address", "warning"],
    ["1! p\n", "blanks-after-negation", "warning"],
  ];
  for (const [source, code, severity] of cases) {
    const matching = (await diagnosticsFor(source, "bre", true)).find(
      (value) => value.code === code,
    );
    assert.equal(matching?.severity, severity, source);
  }
});

test("anchors zero-width recovery to its local source artifact", async () => {
  const values = await diagnosticsFor("/a**/p\n", "bre", true);
  assert.deepEqual(values, [
    {
      startOffset: 3,
      endOffset: 4,
      severity: "warning",
      code: "adjacent-duplication-symbol",
      message:
        "Adjacent regular-expression duplication symbols have undefined behavior.",
    },
  ]);
});

test("deduplicates nested native errors without hiding independent recovery", async () => {
  assert.deepEqual(codes(await diagnosticsFor("\0", "bre", true)), [
    "syntax-error",
  ]);
  assert.deepEqual(codes(await diagnosticsFor("1!/\0", "bre", true)), [
    "unknown-function",
    "syntax-error",
  ]);
  assert.deepEqual(codes(await diagnosticsFor("}a}", "bre", true)), [
    "unmatched-closing-brace",
    "missing-syntax",
    "missing-text-introducer",
    "syntax-error",
  ]);
});

test("reports every issue in a long incomplete command list", async () => {
  const values = await diagnosticsFor("r\n".repeat(1000), "bre", true);
  assert.equal(values.length, 1000);
  assert.ok(values.every(({ code }) => code === "missing-rfile"));
});

test("validates BRE pattern back-references against preceding groups", async () => {
  assert.ok(
    codes(await diagnosticsFor("s/\\1/x/\n")).includes(
      "invalid-pattern-backreference",
    ),
  );
  assert.ok(
    codes(await diagnosticsFor("s/\\(a\\1\\)/x/\n")).includes(
      "invalid-pattern-backreference",
    ),
  );
  assert.ok(
    codes(await diagnosticsFor("s/a\\?\\2/x/\n")).includes(
      "invalid-pattern-backreference",
    ),
  );
  assert.equal(
    codes(await diagnosticsFor("s/\\(a\\)\\1/x/\n")).includes(
      "invalid-pattern-backreference",
    ),
    false,
  );
});

test("validates replacement back-references in BRE and ERE modes", async () => {
  assert.deepEqual(await diagnosticsFor("s/a/\\0/\n"), [
    {
      startOffset: 4,
      endOffset: 6,
      severity: "warning",
      code: "unmatched-replacement-backreference",
      message:
        "Replacement back-reference \\0 has no corresponding POSIX regular-expression subexpression.",
    },
  ]);
  assert.deepEqual(await diagnosticsFor("q\ns/a/\\0/\n"), [
    {
      startOffset: 6,
      endOffset: 8,
      severity: "warning",
      code: "unmatched-replacement-backreference",
      message:
        "Replacement back-reference \\0 has no corresponding POSIX regular-expression subexpression.",
    },
  ]);

  const cases = [
    ["bre", "s/\\(a\\)/\\2/\n"],
    ["ere", "s/(a)/\\2/\n"],
  ];
  for (const [mode, source] of cases) {
    assert.ok(
      codes(await diagnosticsFor(source, mode)).includes(
        "unmatched-replacement-backreference",
      ),
      `${mode}: ${source}`,
    );
  }
  assert.equal(
    codes(await diagnosticsFor("s/\\(a\\)/\\1/\n", "bre")).includes(
      "unmatched-replacement-backreference",
    ),
    false,
  );
  assert.equal(
    codes(await diagnosticsFor("s/(a)/\\1/\n", "ere")).includes(
      "unmatched-replacement-backreference",
    ),
    false,
  );
});

test("checks interval values without integer precision loss", async () => {
  const source =
    "s/a\\{256\\}/x/\ns/b\\{999999999999999999999999999999\\}/x/\ns/c\\{3,2\\}/x/\n";
  assert.deepEqual(
    codes(await diagnosticsFor(source)).filter((code) =>
      ["nonportable-duplication-count", "reversed-interval"].includes(code),
    ),
    [
      "nonportable-duplication-count",
      "nonportable-duplication-count",
      "reversed-interval",
    ],
  );
});

test("reports only encoding-independent regular-expression overflow", async () => {
  for (const [expression, expected] of [
    ["a".repeat(256), false],
    ["a".repeat(257), true],
    ["é".repeat(128), false],
    ["é".repeat(129), false],
    ["é".repeat(257), true],
  ]) {
    assert.equal(
      codes(await diagnosticsFor(`/${expression}/p\n`)).includes(
        "long-regular-expression",
      ),
      expected,
      expression.length,
    );
  }
});

test("reports the unspecified global and occurrence flag combination", async () => {
  assert.ok(
    codes(await diagnosticsFor("s/a/b/g2047\n")).includes(
      "global-occurrence-combination",
    ),
  );
  assert.equal(
    codes(await diagnosticsFor("s/a/b/2047\n")).includes(
      "global-occurrence-combination",
    ),
    false,
  );
});

test("decodes translation strings before comparing and finding duplicates", async () => {
  assert.ok(
    codes(await diagnosticsFor("y/a/xy/\n")).includes(
      "translation-length-mismatch",
    ),
  );
  assert.ok(
    codes(await diagnosticsFor("y/a\\na/xyz/\n")).includes(
      "duplicate-translation-source-character",
    ),
  );
  assert.deepEqual(
    codes(await diagnosticsFor("y/a\\n/xy/\n")).filter(
      (code) =>
        code.startsWith("translation-") ||
        code.startsWith("duplicate-translation-"),
    ),
    [],
  );
  const malformed = codes(await diagnosticsFor("y/a\\q/b/\n"));
  assert.ok(malformed.includes("undefined-translation-escape"));
  assert.equal(malformed.includes("translation-length-mismatch"), false);
});

test("checks label portability, length, definitions, and references", async () => {
  const source = ":é\n:abcdefghi\n:dup\n:dup\nb absent\nt dup\n";
  assert.deepEqual(
    codes(await diagnosticsFor(source)).filter((code) =>
      [
        "nonportable-label",
        "long-label",
        "duplicate-label",
        "undefined-label",
      ].includes(code),
    ),
    [
      "nonportable-label",
      "long-label",
      "duplicate-label",
      "duplicate-label",
      "undefined-label",
    ],
  );
});

test("reports only encoding-independent label overflow", async () => {
  assert.equal(
    codes(await diagnosticsFor(":ééééé\n")).includes("long-label"),
    false,
  );
  assert.equal(
    codes(await diagnosticsFor(":ééééééééé\n")).includes("long-label"),
    true,
  );
});

test("warns when the script introduces an eleventh distinct wfile", async () => {
  const source = [
    "w file-1",
    "w file-2",
    "w file-3",
    "w file-4",
    "w file-5",
    "w file-6",
    "w file-7",
    "w file-8",
    "w file-9",
    "w file-10",
    "w file-1",
    "s/a/b/w file-11",
    "",
  ].join("\n");
  const matching = (await diagnosticsFor(source)).filter(
    ({ code }) => code === "excess-portable-wfile",
  );
  assert.equal(matching.length, 1);
  assert.deepEqual(
    [matching[0].startOffset, matching[0].endOffset],
    [source.indexOf("file-11"), source.indexOf("file-11") + 7],
  );
});

test("tracks prior regular expressions through blocks and branches", async () => {
  assert.ok(
    codes(await diagnosticsFor("s//x/\n")).includes(
      "empty-regular-expression-without-previous",
    ),
  );
  assert.equal(
    codes(await diagnosticsFor("s/a/x/\ns//y/\n")).includes(
      "empty-regular-expression-without-previous",
    ),
    false,
  );
  assert.equal(
    codes(await diagnosticsFor("/a/{\ns//x/\n}\n")).includes(
      "empty-regular-expression-without-previous",
    ),
    false,
  );
  assert.ok(
    codes(await diagnosticsFor("b target\ns/a/x/\n:target\ns//y/\n")).includes(
      "empty-regular-expression-without-previous",
    ),
  );
  assert.ok(
    codes(await diagnosticsFor("1,/a/s//x/\n")).includes(
      "empty-regular-expression-without-previous",
    ),
  );
  assert.equal(
    codes(await diagnosticsFor("/a/,2s//x/\n")).includes(
      "empty-regular-expression-without-previous",
    ),
    false,
  );
  assert.ok(
    codes(
      await diagnosticsFor("/\\(b\\)/p\n/\\(a\\)\\(a\\)/,5s//\\2/\n"),
    ).includes("unmatched-replacement-backreference"),
  );
});

test("stops at a quit command selected on the first input line", async () => {
  assert.equal(
    codes(await diagnosticsFor("1q\ns//x/\n")).includes(
      "empty-regular-expression-without-previous",
    ),
    false,
  );
  for (const source of ["2q\ns//x/\n", "n\n1q\ns//x/\n"]) {
    assert.equal(
      codes(await diagnosticsFor(source)).includes(
        "empty-regular-expression-without-previous",
      ),
      true,
      source,
    );
  }
});

test("does not evaluate a second range address after a last-line start", async () => {
  assert.equal(
    codes(await diagnosticsFor("/^\\(.*\\)$/p\n$,/b/p\ns//\\1/\n")).includes(
      "unmatched-replacement-backreference",
    ),
    false,
  );
});

test("accepts a script containing only blank command-list content", async () => {
  assert.deepEqual(await diagnosticsFor(" "), []);
});

test("does not reinterpret an incomplete delimiter sequence as an empty RE", async () => {
  for (const source of ["s\n", "s/\n", "/\np\n"]) {
    assert.equal(
      codes(await diagnosticsFor(source)).includes(
        "empty-regular-expression-without-previous",
      ),
      false,
      JSON.stringify(source),
    );
  }
});

test("treats a negated zero-address command as never selected", async () => {
  assert.ok(
    codes(await diagnosticsFor("!s/a/x/\ns//y/\n")).includes(
      "empty-regular-expression-without-previous",
    ),
  );
  assert.ok(
    codes(await diagnosticsFor("!d\ns//y/\n")).includes(
      "empty-regular-expression-without-previous",
    ),
  );
  assert.equal(
    codes(await diagnosticsFor("!b target\ns/a/x/\n:target\ns//y/\n")).includes(
      "empty-regular-expression-without-previous",
    ),
    false,
  );
  assert.equal(
    codes(await diagnosticsFor("!s//\\1/\np\n")).some((code) =>
      [
        "empty-regular-expression-without-previous",
        "unmatched-replacement-backreference",
      ].includes(code),
    ),
    false,
  );
});

test("only follows a test branch after a possible substitution", async () => {
  assert.equal(
    codes(await diagnosticsFor("t target\ns/a/x/\n:target\ns//y/\n")).includes(
      "empty-regular-expression-without-previous",
    ),
    false,
  );
  assert.ok(
    codes(
      await diagnosticsFor(
        "s/a/x/\nt target\ns/\\(b\\)/x/\n:target\ns//\\1/\n",
      ),
    ).includes("unmatched-replacement-backreference"),
  );
});

test("uses possible prior group counts for an empty substitution expression", async () => {
  assert.equal(
    codes(await diagnosticsFor("s/\\(a\\)/x/\ns//\\1/\n")).includes(
      "unmatched-replacement-backreference",
    ),
    false,
  );
  assert.ok(
    codes(
      await diagnosticsFor("b target\ns/\\(a\\)/x/\n:target\ns//\\1/\n"),
    ).includes("unmatched-replacement-backreference"),
  );
});

test("preserves every possible flow through duplicate label definitions", async () => {
  const source = [
    "b target",
    ":target",
    "s/\\(a\\)/x/",
    "b end",
    ":target",
    "s/\\(a\\)\\(b\\)/x/",
    ":end",
    "s//\\2/",
    "",
  ].join("\n");
  assert.equal(
    codes(await diagnosticsFor(source)).includes(
      "unmatched-replacement-backreference",
    ),
    true,
  );
});

test("handles many duplicate labels and branches without a quadratic graph", {
  timeout: 3000,
}, async () => {
  const count = 2000;
  const source = `${":target\n".repeat(count)}${"b target\n".repeat(count)}`;
  assert.equal(
    codes(await diagnosticsFor(source)).filter(
      (code) => code === "duplicate-label",
    ).length,
    count,
  );
});

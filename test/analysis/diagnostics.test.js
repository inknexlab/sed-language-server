import assert from "node:assert/strict";
import test from "node:test";
import { SedAnalysis } from "@inknexlab/sed-language-server/analysis";
import {
  diagnosticMessages,
  diagnosticSeverities,
} from "../../src/analysis/diagnostics.js";
import { grammarManifest } from "../../src/analysis/engine.js";

async function diagnosticsFor(source, mode = "bre") {
  const analysis = await SedAnalysis.create(mode);
  const snapshot = analysis.parse(source);
  try {
    return await analysis.diagnostics(snapshot);
  } finally {
    snapshot.dispose();
    await analysis.dispose();
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
    const matching = (await diagnosticsFor(source, "bre")).find(
      (value) => value.code === code,
    );
    assert.equal(matching?.severity, severity, source);
  }
});

test("preserves the grammar range for zero-width recovery", async () => {
  const values = await diagnosticsFor("/a**/p\n", "bre");
  assert.deepEqual(values, [
    {
      startOffset: 3,
      endOffset: 3,
      severity: "warning",
      code: "adjacent-duplication-symbol",
      message:
        "Adjacent regular-expression duplication symbols have undefined behavior.",
    },
  ]);
});

test("does not move missing syntax to a neighboring source token", async () => {
  for (const [source, code, offset] of [
    ["ra\n", "omitted-file-separator", 1],
    [",,p\n", "additional-address", 1],
    ["r\n", "missing-rfile", 1],
  ]) {
    const matching = (await diagnosticsFor(source, "bre")).find(
      (value) => value.code === code,
    );
    assert.deepEqual(
      [matching?.startOffset, matching?.endOffset],
      [offset, offset],
      source,
    );
  }
});

test("reports native errors and independent structured recovery", async () => {
  assert.deepEqual(codes(await diagnosticsFor("\0", "bre")), ["syntax-error"]);
  assert.deepEqual(codes(await diagnosticsFor("1!/\0", "bre")), [
    "unknown-function",
    "syntax-error",
  ]);
  assert.deepEqual(codes(await diagnosticsFor("}a}", "bre")), [
    "unmatched-closing-brace",
    "missing-command-separator",
    "missing-command-separator",
    "missing-text-introducer",
    "unmatched-closing-brace",
  ]);
});

test("reports the innermost native syntax error", async () => {
  assert.deepEqual(await diagnosticsFor("s\0p", "bre"), [
    {
      startOffset: 1,
      endOffset: 2,
      severity: "error",
      code: "syntax-error",
      message: "Syntax error.",
    },
  ]);
});

test("deduplicates indistinguishable syntax diagnostics", async () => {
  assert.deepEqual(codes(await diagnosticsFor("{{", "bre")), [
    "missing-closing-brace",
    "missing-command-separator",
  ]);
});

test("reports every issue in a long incomplete command list", async () => {
  const values = await diagnosticsFor("r\n".repeat(1000), "bre");
  assert.equal(values.length, 1000);
  assert.ok(values.every(({ code }) => code === "missing-rfile"));
});

test("cancels diagnostics while traversing one large regular expression", async () => {
  const analysis = await SedAnalysis.create("bre");
  const snapshot = analysis.parse(`/${"a".repeat(20_000)}/p\n`);
  const controller = new AbortController();
  try {
    const pending = analysis.diagnostics(snapshot, {
      signal: controller.signal,
    });
    setImmediate(() => controller.abort());
    await assert.rejects(pending, { name: "AbortError" });
  } finally {
    snapshot.dispose();
    await analysis.dispose();
  }
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

  assert.ok(
    codes(await diagnosticsFor("q\ns/a/\\1/\n")).includes(
      "unmatched-replacement-backreference",
    ),
  );

  const manyRanges = "2,3d\n".repeat(2000);
  assert.equal(
    codes(await diagnosticsFor(`${manyRanges}s/\\(a\\)/\\1/\n`)).includes(
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

test("rejects zero as a substitution occurrence flag", async () => {
  for (const source of ["s/a/b/0\n", "s/a/b/00\n", "s/a/b/g0\n"]) {
    const matching = (await diagnosticsFor(source)).filter(
      ({ code }) =>
        code === "invalid-substitution-flag" ||
        code === "global-occurrence-combination",
    );
    assert.deepEqual(matching, [
      {
        startOffset: source.indexOf("0"),
        endOffset: source.lastIndexOf("0") + 1,
        severity: "error",
        code: "invalid-substitution-flag",
        message: "This is not a POSIX substitution flag.",
      },
    ]);
  }

  for (const source of ["s/a/b/1\n", "s/a/b/2047\n"]) {
    assert.equal(
      codes(await diagnosticsFor(source)).includes("invalid-substitution-flag"),
      false,
    );
  }
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

  const independentlyMalformed = codes(await diagnosticsFor("y/aa/b\\q/\n"));
  assert.ok(
    independentlyMalformed.includes("duplicate-translation-source-character"),
  );
  assert.ok(independentlyMalformed.includes("undefined-translation-escape"));
  assert.equal(
    independentlyMalformed.includes("translation-length-mismatch"),
    false,
  );

  assert.equal(
    codes(await diagnosticsFor("y/é/ab/\n")).includes(
      "translation-length-mismatch",
    ),
    false,
  );
});

test("treats complete empty translation strings as zero characters", async () => {
  for (const [source, expected] of [
    ["y//a/\n", ["translation-length-mismatch"]],
    ["y/a//\n", ["translation-length-mismatch"]],
    [
      "y/aa//\n",
      ["duplicate-translation-source-character", "translation-length-mismatch"],
    ],
    ["y///\n", []],
  ]) {
    assert.deepEqual(
      codes(await diagnosticsFor(source)).filter(
        (code) =>
          code.startsWith("translation-") ||
          code.startsWith("duplicate-translation-"),
      ),
      expected,
      source,
    );
  }
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

test("uses labels preserved through structured recovery", async () => {
  const labelCodes = (source) =>
    codes(source).filter((code) =>
      ["duplicate-label", "undefined-label"].includes(code),
    );
  assert.deepEqual(labelCodes(await diagnosticsFor("b t\n{;:t")), []);
  assert.deepEqual(labelCodes(await diagnosticsFor("{;b t")), [
    "undefined-label",
  ]);
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

test("retains context-address expressions only when the command is applied", async () => {
  for (const [mode, source] of [
    ["bre", "/a/q\ns//x/\n"],
    ["ere", "/a/q\ns//x/\n"],
    ["bre", "/a/!q\ns//x/\n"],
  ]) {
    assert.ok(
      codes(await diagnosticsFor(source, mode)).includes(
        "empty-regular-expression-without-previous",
      ),
      `${mode}: ${source}`,
    );
  }

  assert.deepEqual(
    codes(await diagnosticsFor("/\\(a\\)/q\ns//\\1/\n")).filter((code) =>
      [
        "empty-regular-expression-without-previous",
        "unmatched-replacement-backreference",
      ].includes(code),
    ),
    [
      "empty-regular-expression-without-previous",
      "unmatched-replacement-backreference",
    ],
  );
});

test("checks every context address that is evaluated", async () => {
  assert.ok(
    codes(await diagnosticsFor("1,//!p\n")).includes(
      "empty-regular-expression-without-previous",
    ),
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

test("tracks exact numeric addresses across input cycles", async () => {
  assert.equal(
    codes(await diagnosticsFor("1d\n2q\ns//x/\n")).includes(
      "empty-regular-expression-without-previous",
    ),
    false,
  );
});

test("does not select a zero line-number address", async () => {
  for (const source of ["0s//x/\n", "00s//x/\n"]) {
    assert.equal(
      codes(await diagnosticsFor(source)).includes(
        "empty-regular-expression-without-previous",
      ),
      false,
      source,
    );
  }
  assert.ok(
    codes(await diagnosticsFor("0!s//x/\n")).includes(
      "empty-regular-expression-without-previous",
    ),
  );
});

test("preserves input-line strides without enumerating address values", async () => {
  const hugeOdd = "9".repeat(301);
  const hugeEven = `${hugeOdd.slice(0, -1)}8`;
  for (const [source, expected] of [
    ["n\n5!d\ns//x/\n", false],
    ["n\n4!d\ns//x/\n", true],
    [`n\n${hugeOdd}!d\ns//x/\n`, false],
    [`n\n${hugeEven}!d\ns//x/\n`, true],
  ]) {
    assert.equal(
      codes(await diagnosticsFor(source)).includes(
        "empty-regular-expression-without-previous",
      ),
      expected,
      source,
    );
  }
});

test("counts both input reads when final n or N starts the next cycle", async () => {
  for (const command of ["n", "N"]) {
    assert.ok(
      codes(await diagnosticsFor(`2s/a/x/\n3s//y/\n${command}\n`)).includes(
        "empty-regular-expression-without-previous",
      ),
      command,
    );
    assert.equal(
      codes(await diagnosticsFor(`2s//\\1/\n${command}\n`)).includes(
        "unmatched-replacement-backreference",
      ),
      false,
      command,
    );
  }
});

test("tracks two-address ranges across cycles and same-line restarts", async () => {
  for (const [source, expected] of [
    ["1,$d\ns//x/\n", false],
    ["2,$d\ns//x/\n", true],
    ["1,1d\ns//x/\n", true],
    [":again\n1,1b again\n2q\ns//x/\n", true],
    ["1N\n2,2D\n3q\ns//x/\n", true],
  ]) {
    assert.equal(
      codes(await diagnosticsFor(source)).includes(
        "empty-regular-expression-without-previous",
      ),
      expected,
      source,
    );
  }
});

test("closes a numeric range at the first evaluated line at or after its end", async () => {
  assert.ok(
    codes(await diagnosticsFor("2d\n1,2d\ns//x/\n")).includes(
      "empty-regular-expression-without-previous",
    ),
  );
});

test("keeps a last-line range active during a same-line restart", async () => {
  assert.ok(
    codes(await diagnosticsFor(":again\n$,//p\nb again\n")).includes(
      "empty-regular-expression-without-previous",
    ),
  );
});

test("does not evaluate a second range address after a last-line start", async () => {
  assert.equal(
    codes(await diagnosticsFor("s/^\\(.*\\)$/&/\n$,/b/p\ns//\\1/\n")).includes(
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

test("budgets only changed states across independent address ranges", async () => {
  const ranges = Array.from(
    { length: 31 },
    (_, index) => `/a${index}/,${index * 3 + 3}s/x/y/`,
  );
  const groupedRanges = Array.from(
    { length: 31 },
    (_, index) => `/\\(a${index}\\)/,${index * 3 + 3}s/\\(x\\)/y/`,
  );
  assert.deepEqual(
    await diagnosticsFor(["s/q/w/", ...ranges, "s//x/", ""].join("\n")),
    [],
  );
  assert.deepEqual(
    await diagnosticsFor(
      ["s/\\(q\\)/w/", ...groupedRanges, "s//\\1/", ""].join("\n"),
    ),
    [],
  );
  assert.ok(
    codes(await diagnosticsFor([...ranges, "s//x/", ""].join("\n"))).includes(
      "empty-regular-expression-without-previous",
    ),
  );
});

test("falls back to coarse flow facts after many address ranges", async () => {
  const ranges = Array(128).fill("/x/,/y/d");
  assert.deepEqual(
    await diagnosticsFor(["s/a/b/", ...ranges, "s//z/", ""].join("\n")),
    [],
  );

  const groupedRanges = Array(128).fill("/\\(x\\)/,/\\(y\\)/d");
  assert.deepEqual(
    await diagnosticsFor(
      ["s/\\(a\\)/b/", ...groupedRanges, "s//\\1/", ""].join("\n"),
    ),
    [],
  );

  assert.ok(
    codes(await diagnosticsFor([...ranges, "s//z/", ""].join("\n"))).includes(
      "empty-regular-expression-without-previous",
    ),
  );
});

test("handles many duplicate labels and branches without a quadratic graph", {
  timeout: 3000,
}, async () => {
  const count = 2000;
  const source = `${":target\n".repeat(count)}s//x/\n${"b target\n".repeat(count)}`;
  const values = codes(await diagnosticsFor(source));
  assert.equal(
    values.filter((code) => code === "duplicate-label").length,
    count,
  );
  assert.ok(values.includes("empty-regular-expression-without-previous"));
});

test("analyzes a large diagnostic-free script in one CST pass", {
  timeout: 3000,
}, async () => {
  assert.deepEqual(await diagnosticsFor("y/a/b/\n".repeat(50_000)), []);
});

test("collapses inert numeric selections before regular-expression flow", {
  timeout: 3000,
}, async () => {
  const commands = Array.from(
    { length: 2000 },
    (_, index) => `${index + 1}p`,
  ).join("\n");
  assert.deepEqual(await diagnosticsFor(`${commands}\n`), []);
  assert.equal(
    codes(await diagnosticsFor(`${commands}\ns//x/\n`)).includes(
      "empty-regular-expression-without-previous",
    ),
    true,
  );
});

test("bounds flow through many relevant numeric addresses", {
  timeout: 3000,
}, async () => {
  const commands = Array.from(
    { length: 2000 },
    (_, index) => `${index + 2}q`,
  ).join("\n");
  assert.equal(
    codes(await diagnosticsFor(`${commands}\ns//x/\n`)).includes(
      "empty-regular-expression-without-previous",
    ),
    true,
  );
});

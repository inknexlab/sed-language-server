import assert from "node:assert/strict";
import test from "node:test";
import { CompletionItemKind, MarkupKind } from "vscode-languageserver";
import { completionItems as provideCompletionItems } from "../src/completion.js";
import { SyntaxStore } from "../src/parser.js";
import { documentFor } from "./helpers.js";

async function withSnapshot(mode, source, callback) {
  const store = await SyntaxStore.create(mode);
  try {
    return callback(store.open(documentFor(source)));
  } finally {
    store.dispose();
  }
}

function completionItems(snapshot, position) {
  return provideCompletionItems(snapshot, position, MarkupKind.Markdown);
}

function labelItem(label, range) {
  return {
    label,
    kind: CompletionItemKind.Reference,
    textEdit: { range, newText: label },
  };
}

const allCommandVerbs = [
  "{",
  "a",
  "b",
  "c",
  "d",
  "D",
  "g",
  "G",
  "h",
  "H",
  "i",
  "l",
  "n",
  "N",
  "p",
  "P",
  "q",
  "r",
  "s",
  "t",
  "w",
  "x",
  "y",
  ":",
  "=",
  "#",
];

const oneAddressCommandVerbs = allCommandVerbs.filter(
  (verb) => verb !== ":" && verb !== "#",
);

const twoAddressCommandVerbs = [
  "{",
  "b",
  "c",
  "d",
  "D",
  "g",
  "G",
  "h",
  "H",
  "l",
  "n",
  "N",
  "p",
  "P",
  "s",
  "t",
  "w",
  "x",
  "y",
];

const substitutionFlags = [
  {
    label: "g",
    detail: "Global",
    synopsis: "s/RE/replacement/g",
    description:
      "Replaces all non-overlapping instances of RE rather than only the first.",
  },
  {
    label: "i",
    detail: "Case-Insensitive",
    synopsis: "s/RE/replacement/i",
    description: "Matches RE case-insensitively.",
  },
  {
    label: "p",
    detail: "Print on Substitution",
    synopsis: "s/RE/replacement/p",
    description:
      "Writes the pattern space to standard output if a replacement was made.",
  },
  {
    label: "w",
    detail: "Write on Substitution",
    synopsis: "s/RE/replacement/w wfile",
    description:
      "Appends the pattern space to wfile if a replacement was made.",
  },
];

const allSubstitutionFlagLabels = substitutionFlags.map(({ label }) => label);

function assertCommandItems(items, verbs, editRange) {
  assert.deepEqual(
    items.map(({ label }) => label),
    verbs,
  );
  for (const completion of items) {
    assert.equal(completion.kind, CompletionItemKind.Keyword);
    assert.equal(typeof completion.detail, "string");
    assert.equal(completion.documentation.kind, MarkupKind.Markdown);
    assert.deepEqual(completion.textEdit, {
      range: editRange,
      newText: completion.label,
    });
  }
}

function substitutionFlagDocumentation(reference, kind) {
  const plain = `${reference.synopsis}\n\n${reference.description}`;
  if (kind === null) {
    return plain;
  }
  return {
    kind,
    value:
      kind === MarkupKind.Markdown
        ? `\`\`\`sed\n${reference.synopsis}\n\`\`\`\n\n${reference.description}`
        : plain,
  };
}

function substitutionFlagItems(
  labels,
  editRange,
  documentationKind = MarkupKind.Markdown,
) {
  return substitutionFlags
    .filter(({ label }) => labels.includes(label))
    .map((reference) => ({
      label: reference.label,
      kind: CompletionItemKind.Keyword,
      detail: reference.detail,
      documentation: substitutionFlagDocumentation(
        reference,
        documentationKind,
      ),
      textEdit: {
        range: editRange,
        newText: reference.label,
      },
    }));
}

function range(line, start, end = start) {
  return {
    start: { line, character: start },
    end: { line, character: end },
  };
}

test("completes every POSIX command verb at an empty script", async () => {
  for (const mode of ["bre", "ere"]) {
    await withSnapshot(mode, "", (snapshot) => {
      const editRange = range(0, 0);
      const items = completionItems(snapshot, editRange.start);
      assertCommandItems(items, allCommandVerbs, editRange);
      assert.deepEqual(
        items.find(({ label }) => label === "p"),
        {
          label: "p",
          kind: CompletionItemKind.Keyword,
          detail: "Print",
          documentation: {
            kind: MarkupKind.Markdown,
            value:
              "```sed\n[address[,address]]p\n```\n\nWrites the pattern space to standard output.",
          },
          textEdit: { range: editRange, newText: "p" },
        },
      );
      assert.equal(
        items.find(({ label }) => label === "a").documentation.value,
        "```sed\n[address]a\\\ntext\n```\n\nSchedules text for standard output before the next input fetch, before `q`, or at the end of the script.",
      );
    });
  }
});

test("renders command documentation as plain text", async () => {
  await withSnapshot("bre", "", (snapshot) => {
    const item = provideCompletionItems(
      snapshot,
      { line: 0, character: 0 },
      MarkupKind.PlainText,
    ).find(({ label }) => label === "D");
    assert.deepEqual(item.documentation, {
      kind: MarkupKind.PlainText,
      value:
        "[address[,address]]D\n\nDeletes through the first newline and restarts the cycle without reading input, or acts like d when no newline exists.",
    });
  });
});

test("completes every fixed substitution flag with exact documentation", async () => {
  for (const mode of ["bre", "ere"]) {
    await withSnapshot(mode, "s/a/b/", (snapshot) => {
      const editRange = range(0, 6);
      assert.deepEqual(
        completionItems(snapshot, editRange.start),
        substitutionFlagItems(allSubstitutionFlagLabels, editRange),
      );
    });
  }
});

test("renders substitution flag documentation in the negotiated representation", async () => {
  await withSnapshot("bre", "s/a/b/", (snapshot) => {
    const position = { line: 0, character: 6 };
    const editRange = { start: position, end: position };
    for (const documentationKind of [MarkupKind.PlainText, null]) {
      assert.deepEqual(
        provideCompletionItems(snapshot, position, documentationKind),
        substitutionFlagItems(
          allSubstitutionFlagLabels,
          editRange,
          documentationKind,
        ),
      );
    }
  });
});

test("uses a UTF-16 insertion range after an alternate substitution delimiter", async () => {
  await withSnapshot("ere", "s|😀|x|", (snapshot) => {
    const editRange = range(0, 7);
    assert.deepEqual(
      completionItems(snapshot, editRange.start),
      substitutionFlagItems(allSubstitutionFlagLabels, editRange),
    );
  });
});

test("filters existing substitution flags at valid insertion boundaries", async () => {
  const cases = [
    {
      source: "s/a/b/g",
      position: { line: 0, character: 7 },
      labels: ["i", "p", "w"],
    },
    {
      source: "s/a/b/gp",
      position: { line: 0, character: 7 },
      labels: ["i"],
    },
    {
      source: "s/a/b/gp",
      position: { line: 0, character: 8 },
      labels: ["i", "w"],
    },
    {
      source: "s/a/b/gip",
      position: { line: 0, character: 9 },
      labels: ["w"],
    },
    {
      source: "s/a/b/001",
      position: { line: 0, character: 9 },
      labels: allSubstitutionFlagLabels,
    },
    {
      source: "s/a/b/w output",
      position: { line: 0, character: 6 },
      labels: ["g", "i", "p"],
    },
  ];
  for (const { source, position, labels } of cases) {
    await withSnapshot("bre", source, (snapshot) => {
      const editRange = { start: position, end: position };
      assert.deepEqual(
        completionItems(snapshot, position),
        substitutionFlagItems(labels, editRange),
        JSON.stringify({ source, position }),
      );
    });
  }
});

test("only offers the write flag before EOF or a physical line ending", async () => {
  const cases = [
    {
      source: "s/a/b/\n",
      position: { line: 0, character: 6 },
      labels: allSubstitutionFlagLabels,
    },
    {
      source: "s/a/b/\r\n",
      position: { line: 0, character: 6 },
      labels: allSubstitutionFlagLabels,
    },
    {
      source: "s/a/b/;p",
      position: { line: 0, character: 6 },
      labels: ["g", "i", "p"],
    },
    {
      source: "{s/a/b/}",
      position: { line: 0, character: 7 },
      labels: ["g", "i", "p"],
    },
  ];
  for (const { source, position, labels } of cases) {
    await withSnapshot("bre", source, (snapshot) => {
      const editRange = { start: position, end: position };
      assert.deepEqual(
        completionItems(snapshot, position),
        substitutionFlagItems(labels, editRange),
        JSON.stringify({ source, position }),
      );
    });
  }
});

test("does not complete outside a valid substitution flag insertion boundary", async () => {
  const cases = [
    { source: "s/a/b/z", position: { line: 0, character: 7 } },
    { source: "s/a/b/000", position: { line: 0, character: 9 } },
    { source: "s/a/b", position: { line: 0, character: 5 } },
    { source: "s/a/b/123", position: { line: 0, character: 7 } },
    { source: "s/a/b/123", position: { line: 0, character: 8 } },
    { source: "s/a/b/w output", position: { line: 0, character: 7 } },
    { source: "s/a/b/w output", position: { line: 0, character: 8 } },
    { source: "s/a/b/w output", position: { line: 0, character: 9 } },
    { source: "s/a/b/w output", position: { line: 0, character: 12 } },
    { source: "s/a/b/", position: { line: 0, character: 2 } },
    { source: "s/a/b/", position: { line: 0, character: 4 } },
    { source: "s/a/b/", position: { line: 0, character: 5 } },
  ];
  for (const { source, position } of cases) {
    await withSnapshot("bre", source, (snapshot) => {
      assert.deepEqual(
        completionItems(snapshot, position),
        [],
        JSON.stringify({ source, position }),
      );
    });
  }
});

test("completes blank command slots at concrete command boundaries", async () => {
  const cases = [
    { source: "  ", position: { line: 0, character: 2 } },
    { source: "p; ", position: { line: 0, character: 3 } },
    { source: "p\n  \n", position: { line: 1, character: 2 } },
    { source: "{}", position: { line: 0, character: 1 } },
    { source: "{ }", position: { line: 0, character: 2 } },
    { source: "{\n  \n}", position: { line: 1, character: 2 } },
    { source: "1,2{}", position: { line: 0, character: 4 } },
  ];
  for (const { source, position } of cases) {
    await withSnapshot("bre", source, (snapshot) => {
      assertCommandItems(completionItems(snapshot, position), allCommandVerbs, {
        start: position,
        end: position,
      });
    });
  }
});

test("completes a deeply nested command slot", {
  timeout: 5000,
}, async () => {
  const depth = 5000;
  const source = `${"{\n".repeat(depth)}  \n${"}\n".repeat(depth)}`;
  await withSnapshot("bre", source, (snapshot) => {
    const position = { line: depth, character: 2 };
    assertCommandItems(completionItems(snapshot, position), allCommandVerbs, {
      start: position,
      end: position,
    });
  });
});

test("filters command verbs by the structural address count", async () => {
  const cases = [
    {
      source: "1",
      position: { line: 0, character: 1 },
      verbs: oneAddressCommandVerbs,
    },
    {
      source: "1,",
      position: { line: 0, character: 2 },
      verbs: twoAddressCommandVerbs,
    },
    {
      source: ",2",
      position: { line: 0, character: 2 },
      verbs: twoAddressCommandVerbs,
    },
    {
      source: "1 2",
      position: { line: 0, character: 3 },
      verbs: twoAddressCommandVerbs,
    },
    {
      source: "1,2! ",
      position: { line: 0, character: 5 },
      verbs: twoAddressCommandVerbs,
    },
    {
      source: "/😀/ ",
      position: { line: 0, character: 5 },
      verbs: oneAddressCommandVerbs,
    },
  ];
  for (const { source, position, verbs } of cases) {
    await withSnapshot("bre", source, (snapshot) => {
      assertCommandItems(completionItems(snapshot, position), verbs, {
        start: position,
        end: position,
      });
    });
  }
});

test("does not complete after excess addresses or inside an unfinished context address", async () => {
  const cases = [
    { source: "1,2,3", position: { line: 0, character: 5 } },
    { source: "/a", position: { line: 0, character: 2 } },
    { source: "1,/a", position: { line: 0, character: 4 } },
  ];
  for (const { source, position } of cases) {
    await withSnapshot("bre", source, (snapshot) => {
      assert.deepEqual(completionItems(snapshot, position), []);
    });
  }
});

test("does not reinterpret completed or invalid syntax as an empty command slot", async () => {
  const cases = [
    { source: "p", position: { line: 0, character: 0 } },
    { source: "p", position: { line: 0, character: 1 } },
    { source: "z", position: { line: 0, character: 1 } },
    { source: "😀", position: { line: 0, character: 2 } },
    { source: "p ", position: { line: 0, character: 2 } },
    { source: "b;", position: { line: 0, character: 2 } },
    { source: "  p", position: { line: 0, character: 2 } },
    { source: "}", position: { line: 0, character: 0 } },
    { source: "# p", position: { line: 0, character: 2 } },
    { source: "s/a/b/", position: { line: 0, character: 3 } },
    { source: "a\\\ntext\n", position: { line: 1, character: 2 } },
    { source: "r file\n", position: { line: 0, character: 4 } },
    { source: "  \r\n", position: { line: 0, character: 2 } },
    { source: "{p;} ", position: { line: 0, character: 5 } },
  ];
  for (const { source, position } of cases) {
    await withSnapshot("bre", source, (snapshot) => {
      assert.deepEqual(
        completionItems(snapshot, position),
        [],
        JSON.stringify({ source, position }),
      );
    });
  }
});

test("completes unique label definitions in source order for empty branch and test operands", async () => {
  const source = ":first\n:second\n:first\nb \nt \n";
  for (const mode of ["bre", "ere"]) {
    await withSnapshot(mode, source, (snapshot) => {
      const branchRange = range(3, 2);
      assert.deepEqual(completionItems(snapshot, branchRange.start), [
        labelItem("first", branchRange),
        labelItem("second", branchRange),
      ]);
      const testRange = range(4, 2);
      assert.deepEqual(completionItems(snapshot, testRange.start), [
        labelItem("first", testRange),
        labelItem("second", testRange),
      ]);
    });
  }
});

test("replaces the complete label operand from any position within it", async () => {
  await withSnapshot("bre", ":target\nb tar\nt stale\n", (snapshot) => {
    const branchRange = range(1, 2, 5);
    assert.deepEqual(completionItems(snapshot, { line: 1, character: 3 }), [
      labelItem("target", branchRange),
    ]);
    const testRange = range(2, 2, 7);
    assert.deepEqual(completionItems(snapshot, { line: 2, character: 7 }), [
      labelItem("target", testRange),
    ]);
  });
});

test("only completes inside a space-separated branch or test operand", async () => {
  await withSnapshot(
    "bre",
    ":target\nb\nb\t\nb target\n:other\np\ns/x/x/\nb  \n",
    (snapshot) => {
      for (const position of [
        { line: 0, character: 2 },
        { line: 1, character: 1 },
        { line: 2, character: 2 },
        { line: 3, character: 0 },
        { line: 3, character: 1 },
        { line: 4, character: 1 },
        { line: 5, character: 0 },
        { line: 6, character: 2 },
      ]) {
        assert.deepEqual(completionItems(snapshot, position), []);
      }

      const operandRange = range(7, 2, 3);
      assert.deepEqual(completionItems(snapshot, { line: 7, character: 2 }), [
        labelItem("target", operandRange),
        labelItem("other", operandRange),
      ]);
    },
  );
});

test("completes nested commands without relying on recovery descendants at the cursor", async () => {
  await withSnapshot("bre", ":target\n{b \n}\n", (snapshot) => {
    const operandRange = range(1, 3);
    assert.deepEqual(completionItems(snapshot, operandRange.start), [
      labelItem("target", operandRange),
    ]);
    const commandPosition = { line: 2, character: 0 };
    assertCommandItems(
      completionItems(snapshot, commandPosition),
      allCommandVerbs,
      { start: commandPosition, end: commandPosition },
    );
  });
});

test("uses UTF-16 ranges for labels containing astral characters", async () => {
  await withSnapshot("ere", ":😀label\nb 😀pa\n", (snapshot) => {
    const operandRange = range(1, 2, 6);
    assert.deepEqual(completionItems(snapshot, { line: 1, character: 4 }), [
      labelItem("😀label", operandRange),
    ]);
  });
});

test("keeps LF and CRLF labels distinct without inserting a second carriage return", async () => {
  const source = ":\r\n:windows\r\n:unix\nb \r\nt par\r\nb par\n";
  await withSnapshot("bre", source, (snapshot) => {
    const emptyWindowsRange = range(3, 2);
    assert.deepEqual(completionItems(snapshot, { line: 3, character: 2 }), [
      labelItem("windows", emptyWindowsRange),
    ]);
    const windowsRange = range(4, 2, 5);
    assert.deepEqual(completionItems(snapshot, { line: 4, character: 5 }), [
      labelItem("windows", windowsRange),
    ]);
    const unixRange = range(5, 2, 5);
    assert.deepEqual(completionItems(snapshot, { line: 5, character: 5 }), [
      labelItem("unix", unixRange),
    ]);
  });
});

test("does not complete an operand containing an embedded carriage return", async () => {
  await withSnapshot("bre", ":target\r\nb bad\rmid\n", (snapshot) => {
    assert.deepEqual(completionItems(snapshot, { line: 1, character: 3 }), []);
  });
});

test("returns no items when the document has no label definitions", async () => {
  await withSnapshot("bre", "b \n", (snapshot) => {
    assert.deepEqual(completionItems(snapshot, { line: 0, character: 2 }), []);
  });
});

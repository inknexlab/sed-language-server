import assert from "node:assert/strict";
import test from "node:test";
import { withSnapshot } from "./support.js";

async function format(source, mode = "bre", options = {}) {
  return withSnapshot(mode, source, async (analysis, snapshot) => {
    const formatted = await analysis.format(snapshot, options);
    return {
      changed: formatted !== undefined,
      text: formatted ?? source,
    };
  });
}

test("puts each command on a line and indents nested blocks", async () => {
  const source = "  1,2{;p;s/a/b/g;\n\n};q;p";
  const { text } = await format(source, "bre", {
    insertSpaces: true,
    tabSize: 2,
  });
  assert.equal(text, "1,2{\n  p\n  s/a/b/g\n\n}\nq\np\n");
});

test("uses tabs when the client requests tab indentation", async () => {
  const { text } = await format("{\n{\np\n}\n}\n", "ere", {
    insertSpaces: false,
    tabSize: 8,
  });
  assert.equal(text, "{\n\t{\n\t\tp\n\t}\n}\n");
});

test("defaults formatting options and ignores unknown fields", async () => {
  await withSnapshot("bre", "{p;}", async (analysis, snapshot) => {
    assert.equal(await analysis.format(snapshot), "{\n  p\n}\n");
    assert.equal(
      await analysis.format(snapshot, { futureOption: true }),
      "{\n  p\n}\n",
    );
  });
});

test("accepts zero-width space indentation", async () => {
  await withSnapshot("bre", "{p;}", async (analysis, snapshot) => {
    assert.equal(
      await analysis.format(snapshot, { insertSpaces: true, tabSize: 0 }),
      "{\np\n}\n",
    );
  });
});

test("validates formatting option types without coercion", async () => {
  await withSnapshot("bre", "p\n", async (analysis, snapshot) => {
    for (const options of [null, [], true]) {
      await assert.rejects(
        analysis.format(snapshot, options),
        /must be an object/,
      );
    }
    await assert.rejects(
      analysis.format(snapshot, { insertSpaces: "yes" }),
      /insertSpaces must be a boolean/,
    );
    await assert.rejects(
      analysis.format(snapshot, { insertSpaces: null }),
      /insertSpaces must be a boolean/,
    );
    for (const tabSize of [null, "2", -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await assert.rejects(
        analysis.format(snapshot, { tabSize }),
        /tabSize must be a non-negative safe integer/,
      );
    }
    for (const name of [
      "insertFinalNewline",
      "trimFinalNewlines",
      "trimTrailingWhitespace",
    ]) {
      await assert.rejects(
        analysis.format(snapshot, { [name]: null }),
        new RegExp(`${name} must be a boolean`),
      );
    }
  });
});

test("does not allocate impractical indentation", async () => {
  const options = {
    insertSpaces: true,
    tabSize: Number.MAX_SAFE_INTEGER,
  };
  await withSnapshot("bre", "p;p", async (analysis, snapshot) => {
    assert.equal(await analysis.format(snapshot, options), "p\np\n");
  });
  await withSnapshot("bre", "{p;}\n", async (analysis, snapshot) => {
    assert.equal(await analysis.format(snapshot, options), undefined);
  });
});

test("preserves leading, interior, and trailing blank lines", async () => {
  const { text } = await format("\n\n p\n\n{\n\nq\n\n}\n\n");
  assert.equal(text, "\n\np\n\n{\n\n  q\n\n}\n\n");
});

test("does not rewrite multiline text payloads", async () => {
  const source = "  a\\\n  first\\\n second\n p";
  const { text } = await format(source);
  assert.equal(text, "a\\\n  first\\\n second\np\n");
});

test("preserves carriage returns in command operands", async () => {
  const cases = [
    ["#n\r\np;p", "#n\r\np\np\n"],
    ["r file\r\np;p", "r file\r\np\np\n"],
    ["a\\\ntext\r\np;p", "a\\\ntext\r\np\np\n"],
  ];
  for (const [source, expected] of cases) {
    assert.equal((await format(source)).text, expected, JSON.stringify(source));
  }
});

test("does not trim whitespace owned by a command operand", async () => {
  const source = "r file  \np;\n   \nq";
  const { text } = await format(source, "bre", {
    trimTrailingWhitespace: true,
  });
  assert.equal(text, "r file  \np\n\nq\n");
});

test("does not rewrite escaped newlines inside a replacement", async () => {
  const source = " s/a/first\\\n second/;p";
  const { text } = await format(source);
  assert.equal(text, "s/a/first\\\n second/\np\n");
});

test("preserves regular expression, translation, and line operands", async () => {
  const source =
    " s界a界b界;p\ny|a\\n\\||b\\\\c|;p\ns😀a😀b😀;p\ny😀a😀b😀;p\n:label\nb label\nr file name\n# comment ; untouched\np";
  const { text } = await format(source);
  assert.equal(
    text,
    "s界a界b界\np\ny|a\\n\\||b\\\\c|\np\ns😀a😀b😀\np\ny😀a😀b😀\np\n:label\nb label\nr file name\n# comment ; untouched\np\n",
  );
});

test("preserves the special meaning of an initial #n comment", async () => {
  const cases = [
    ["#n\n p;p", "#n\np\np\n"],
    [" #n\np", " #n\np\n"],
    [";#n\np", " #n\np\n"],
    ["{;#n\np\n}", "{\n  #n\n  p\n}\n"],
  ];
  for (const [source, expected] of cases) {
    assert.equal((await format(source)).text, expected, JSON.stringify(source));
  }
});

test("preserves a leading byte-order mark", async () => {
  for (const [source, expected] of [
    ["\uFEFFp;p", "\uFEFFp\np\n"],
    ["\uFEFF", "\uFEFF\n"],
  ]) {
    assert.equal((await format(source)).text, expected);
  }
  assert.equal(
    (
      await format("\uFEFF", "bre", {
        insertFinalNewline: false,
      })
    ).changed,
    false,
  );
});

test("formats POSIX-permitted implementation variations", async () => {
  assert.equal((await format("/a\\+b/p;p")).text, "/a\\+b/p\np\n");
  assert.equal((await format("rfile\np;p")).text, "rfile\np\np\n");
});

test("does not format syntax with unsafe POSIX outcomes", async () => {
  for (const source of [
    "r\n",
    "p tail\n",
    "/a**/p;p",
    "1! p;p",
    "s/a/b/w file;p\n",
    "\0",
  ]) {
    const result = await format(source);
    assert.equal(result.changed, false, JSON.stringify(source));
    assert.equal(result.text, source);
  }
});

test("adds a final POSIX newline", async () => {
  assert.equal((await format("p")).text, "p\n");
  assert.equal((await format("p\n")).changed, false);
});

test("honors final-newline formatting options", async () => {
  assert.equal(
    (
      await format("p;p", "bre", {
        insertFinalNewline: false,
      })
    ).text,
    "p\np",
  );
  assert.equal(
    (
      await format("p\n\n", "bre", {
        trimFinalNewlines: true,
      })
    ).text,
    "p\n",
  );
  assert.equal(
    (
      await format("p\n", "bre", {
        insertFinalNewline: false,
      })
    ).changed,
    false,
  );
});

test("returns an empty formatted source without treating it as no change", async () => {
  assert.deepEqual(await format(";", "bre", { insertFinalNewline: false }), {
    changed: true,
    text: "",
  });
});

test("leaves an empty document unchanged", async () => {
  const result = await format("");
  assert.equal(result.changed, false);
  assert.equal(result.text, "");
});

test("does not rewrite CRLF input", async () => {
  const source = "p\r\nq\r\n";
  const result = await format(source);
  assert.equal(result.changed, false);
  assert.equal(result.text, source);
});

test("formats deeply nested blocks without using the call stack", async () => {
  const depth = 3000;
  const source = `${"{".repeat(depth)}p;${"};".repeat(depth - 1)}}`;
  const { changed, text } = await format(source, "bre", {
    insertSpaces: false,
    tabSize: 8,
  });
  const lines = text.split("\n");
  assert.equal(changed, true);
  assert.equal(lines.length, 6002);
  assert.equal(text.length, 9_012_002);
  assert.equal(lines[0], "{");
  assert.equal(lines[3000], `${"\t".repeat(depth)}p`);
  assert.equal(lines[3001], `${"\t".repeat(depth - 1)}}`);
  assert.equal(lines[6000], "}");
  assert.equal(lines[6001], "");
});

test("formats a wide flat command list without quadratic traversal", {
  timeout: 3000,
}, async () => {
  const commandCount = 20_000;
  const { text } = await format("p;".repeat(commandCount));
  assert.equal(text, "p\n".repeat(commandCount));
});

test("cancels formatting during a CST traversal checkpoint", async () => {
  await withSnapshot("bre", "p;".repeat(2000), async (analysis, snapshot) => {
    const controller = new AbortController();
    const pending = analysis.format(
      snapshot,
      {},
      { signal: controller.signal },
    );
    setImmediate(() => controller.abort());
    await assert.rejects(pending, { name: "AbortError" });
  });
});

test("is idempotent in both regular-expression modes", async () => {
  const source = "  1,2{;p;s/a/b/g;\n\n};q;p";
  for (const mode of ["bre", "ere"]) {
    const first = await format(source, mode, {
      insertSpaces: true,
      tabSize: 2,
    });
    assert.equal(first.changed, true);
    const second = await format(first.text, mode, {
      insertSpaces: true,
      tabSize: 2,
    });
    assert.equal(second.text, first.text);
    assert.equal(second.changed, false);
  }
});

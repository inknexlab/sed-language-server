#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const grammarRevision = "9f6183f650b58cfd4ee9d05fe83655e542ba367c";
const manifestSha256 =
  "e628d4e3c9516a7e5b021640aaecc91c30fe8b281698e22bbce4b7d7decf33e9";
const grammarLanguages = Object.freeze([
  Object.freeze({
    mode: "bre",
    directory: "posix-sed-bre",
    languageName: "posix_sed_bre",
    sha256: "9358b376faab43a2a12a318852a2ce16ab2ad1983478fab26e70d63c711ea440",
    wasmName: "tree-sitter-posix-sed-bre.wasm",
  }),
  Object.freeze({
    mode: "ere",
    directory: "posix-sed-ere",
    languageName: "posix_sed_ere",
    sha256: "274e7eac8a81eb1f943a3e5bc747996393496e9615c05977ad46f9b707908008",
    wasmName: "tree-sitter-posix-sed-ere.wasm",
  }),
]);
const vendorArtifactNames = Object.freeze([
  ...grammarLanguages.map(({ wasmName }) => wasmName),
  "tree-sitter-posix-sed.json",
]);
const generatedArtifactNames = Object.freeze([
  "grammar.json",
  "node-types.json",
  "parser.c",
  "tree_sitter/alloc.h",
  "tree_sitter/array.h",
  "tree_sitter/parser.h",
]);

function sha256ForFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function filesIn(directory, prefix = "") {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const name = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(`${name}/`);
      files.push(...filesIn(join(directory, entry.name), name));
    } else if (entry.isFile()) {
      files.push(name);
    } else {
      throw new Error(`${name} must be a regular file.`);
    }
  }
  return files.sort();
}

function assertExactFiles(directory, expectedNames, description) {
  const actualNames = filesIn(directory);
  const expected = new Set(expectedNames);
  for (const name of expectedNames) {
    let separator = name.indexOf("/");
    while (separator !== -1) {
      expected.add(`${name.slice(0, separator + 1)}`);
      separator = name.indexOf("/", separator + 1);
    }
  }
  const sortedExpected = [...expected].sort();
  if (
    actualNames.length !== sortedExpected.length ||
    actualNames.some((name, index) => name !== sortedExpected[index])
  ) {
    throw new Error(
      `The ${description} must contain exactly: ${expectedNames.join(", ")}.`,
    );
  }
}

export function verifyVendorDirectory(vendorDirectory) {
  assertExactFiles(vendorDirectory, vendorArtifactNames, "vendor directory");
  for (const name of vendorArtifactNames) {
    const mode = statSync(resolve(vendorDirectory, name)).mode & 0o777;
    if (mode !== 0o644) {
      throw new Error(`${name} must have mode 0644.`);
    }
  }
  const manifestPath = resolve(vendorDirectory, "tree-sitter-posix-sed.json");
  const actualManifestSha256 = sha256ForFile(manifestPath);
  if (actualManifestSha256 !== manifestSha256) {
    throw new Error(
      `Expected tree-sitter-posix-sed manifest SHA-256 ${manifestSha256}, received ${actualManifestSha256}.`,
    );
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest?.revision !== grammarRevision) {
    throw new Error(
      `Expected tree-sitter-posix-sed ${grammarRevision}, received ${manifest?.revision ?? "no revision"}.`,
    );
  }
  const definitions = manifest.languages;
  if (
    definitions === null ||
    typeof definitions !== "object" ||
    Array.isArray(definitions) ||
    Object.keys(definitions).length !== grammarLanguages.length
  ) {
    throw new Error("The tree-sitter-posix-sed language manifest is invalid.");
  }
  for (const language of grammarLanguages) {
    const definition = definitions[language.mode];
    if (
      definition?.language !== language.languageName ||
      definition.wasm !== language.wasmName ||
      definition.sha256 !== language.sha256
    ) {
      throw new Error(
        `The ${language.languageName} artifact manifest is invalid.`,
      );
    }
    const actual = sha256ForFile(resolve(vendorDirectory, language.wasmName));
    if (actual !== definition.sha256) {
      throw new Error(
        `The ${language.languageName} WASM SHA-256 digest does not match its manifest.`,
      );
    }
  }
}

const syntaxIssueOutcomeNames = new Set([
  "implementation_defined_syntax",
  "implementation_option_syntax",
  "incomplete_syntax",
  "nonconforming_syntax",
  "undefined_syntax",
  "unspecified_syntax",
]);
function runGit(grammarDirectory, arguments_) {
  const result = spawnSync("git", ["-C", grammarDirectory, ...arguments_], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `Cannot inspect tree-sitter-posix-sed at ${grammarDirectory}.`,
      {
        cause: result.error,
      },
    );
  }
  return result.stdout.trim();
}

function namedNode(nodeTypes, type, languageName) {
  const matches = nodeTypes.filter((node) => node.named && node.type === type);
  if (matches.length !== 1) {
    throw new Error(
      `${languageName} must expose exactly one named ${type} node type.`,
    );
  }
  return matches[0];
}

function requiredNamedChildTypes(node, languageName) {
  const { children } = node;
  if (
    children?.required !== true ||
    children.multiple !== false ||
    !Array.isArray(children.types) ||
    children.types.length === 0 ||
    children.types.some(({ named }) => !named)
  ) {
    throw new Error(
      `${languageName} ${node.type} must require exactly one named child.`,
    );
  }
  const types = children.types.map(({ type }) => type);
  if (new Set(types).size !== types.length) {
    throw new Error(`${languageName} ${node.type} repeats a child type.`);
  }
  return types;
}

function issueOutcomes(nodeTypes, languageName) {
  const syntaxIssue = namedNode(nodeTypes, "syntax_issue", languageName);
  const outcomes = requiredNamedChildTypes(syntaxIssue, languageName).sort();
  for (const outcome of outcomes) {
    if (!syntaxIssueOutcomeNames.has(outcome)) {
      throw new Error(
        `${languageName} exposes an unknown outcome: ${outcome}.`,
      );
    }
  }

  for (const outcome of syntaxIssueOutcomeNames) {
    const exposed = nodeTypes.some(
      ({ named, type }) => named && type === outcome,
    );
    if (exposed !== outcomes.includes(outcome)) {
      throw new Error(
        `${languageName} ${outcome} must be exposed directly by syntax_issue.`,
      );
    }
  }

  return Object.fromEntries(
    outcomes.map((outcome) => {
      const outcomeNode = namedNode(nodeTypes, outcome, languageName);
      const reasons = requiredNamedChildTypes(outcomeNode, languageName).sort();
      for (const reason of reasons) {
        namedNode(nodeTypes, reason, languageName);
      }
      return [outcome, reasons];
    }),
  );
}

function assertOutcomeCoverage(manifestLanguages) {
  const outcomes = new Set(
    Object.values(manifestLanguages).flatMap(({ outcomes: definitions }) =>
      Object.keys(definitions),
    ),
  );
  for (const outcome of syntaxIssueOutcomeNames) {
    if (!outcomes.has(outcome)) {
      throw new Error(`The grammar variants do not expose ${outcome}.`);
    }
  }
}

function grammarDefinition(grammarDirectory) {
  return JSON.parse(
    readFileSync(resolve(grammarDirectory, "tree-sitter.json"), "utf8"),
  );
}

function assertLanguageDefinition(definition, language) {
  const grammar = definition.grammars.find(
    ({ name }) => name === language.languageName,
  );
  if (grammar?.path !== language.directory) {
    throw new Error(
      `Expected ${language.languageName} at ${language.directory}.`,
    );
  }
}

function generateParser(cliPath, sourceDirectory, generatedDirectory) {
  const result = spawnSync(
    process.execPath,
    [
      cliPath,
      "generate",
      "--output",
      generatedDirectory,
      resolve(sourceDirectory, "grammar.js"),
    ],
    { cwd: sourceDirectory, stdio: "inherit" },
  );
  if (result.status !== 0) {
    throw new Error("Failed to regenerate the POSIX sed parser.", {
      cause: result.error,
    });
  }
}

function regeneratedNodeTypes(cliPath, sourceDirectory, generatedDirectory) {
  generateParser(cliPath, sourceDirectory, generatedDirectory);
  assertExactFiles(
    generatedDirectory,
    generatedArtifactNames,
    "regenerated parser directory",
  );
  for (const name of generatedArtifactNames) {
    const committed = readFileSync(resolve(sourceDirectory, "src", name));
    const regenerated = readFileSync(resolve(generatedDirectory, name));
    if (!committed.equals(regenerated)) {
      throw new Error(
        `The generated POSIX sed artifact is stale: ${sourceDirectory}/src/${name}`,
      );
    }
  }
  return JSON.parse(
    readFileSync(resolve(generatedDirectory, "node-types.json"), "utf8"),
  );
}

function languageArtifacts(
  grammarDirectory,
  language,
  cliPath,
  generatedDirectory,
) {
  const sourceDirectory = resolve(grammarDirectory, language.directory);
  const nodeTypes = regeneratedNodeTypes(
    cliPath,
    sourceDirectory,
    generatedDirectory,
  );
  return {
    sourceDirectory,
    manifest: {
      language: language.languageName,
      wasm: language.wasmName,
      outcomes: issueOutcomes(nodeTypes, language.languageName),
    },
  };
}

function buildLanguage({
  cliPath,
  language,
  sourceDirectory,
  vendorDirectory,
}) {
  const outputPath = resolve(vendorDirectory, language.wasmName);
  const result = spawnSync(
    process.execPath,
    [cliPath, "build", "--wasm", "--output", outputPath, sourceDirectory],
    { stdio: "inherit" },
  );
  if (result.status !== 0) {
    throw new Error(`Failed to build ${language.languageName}.`, {
      cause: result.error,
    });
  }
  chmodSync(outputPath, 0o644);
}

export function replaceVendorDirectory(
  stagedDirectory,
  vendorDirectory,
  transaction,
) {
  if (existsSync(vendorDirectory)) {
    assertExactFiles(vendorDirectory, vendorArtifactNames, "vendor directory");
  }

  const backupDirectory = resolve(transaction, "previous-vendor");
  const hadVendor = existsSync(vendorDirectory);
  if (hadVendor) {
    renameSync(vendorDirectory, backupDirectory);
  }
  try {
    renameSync(stagedDirectory, vendorDirectory);
  } catch (error) {
    if (hadVendor && !existsSync(vendorDirectory)) {
      try {
        renameSync(backupDirectory, vendorDirectory);
      } catch (restoreError) {
        throw new AggregateError(
          [error, restoreError],
          `Cannot replace or restore the vendor directory; the previous artifacts remain at ${backupDirectory}.`,
        );
      }
    }
    throw error;
  }
  if (hadVendor) {
    rmSync(backupDirectory, { recursive: true });
  }
}

function build() {
  const grammarDirectoryArgument = process.argv[2];
  if (grammarDirectoryArgument === undefined) {
    throw new Error(
      "Usage: npm run build:grammar -- /path/to/tree-sitter-posix-sed",
    );
  }

  const projectDirectory = fileURLToPath(new URL("..", import.meta.url));
  const grammarDirectory = resolve(grammarDirectoryArgument);
  const vendorDirectory = resolve(projectDirectory, "vendor");
  const cliPath = resolve(
    projectDirectory,
    "node_modules/tree-sitter-cli/cli.js",
  );

  const actualRevision = runGit(grammarDirectory, ["rev-parse", "HEAD"]);
  if (actualRevision !== grammarRevision) {
    throw new Error(
      `Expected tree-sitter-posix-sed ${grammarRevision}, received ${actualRevision}.`,
    );
  }

  const grammarChanges = runGit(grammarDirectory, [
    "status",
    "--porcelain",
    "--untracked-files=all",
    "--",
    "common",
    "posix-sed-bre",
    "posix-sed-ere",
    "tree-sitter.json",
  ]);
  if (grammarChanges !== "") {
    throw new Error("The tree-sitter-posix-sed grammar sources must be clean.");
  }

  const transactionDirectory = mkdtempSync(
    resolve(projectDirectory, ".tree-sitter-posix-sed-"),
  );
  const stagedDirectory = resolve(transactionDirectory, "vendor");
  mkdirSync(stagedDirectory);
  try {
    const definition = grammarDefinition(grammarDirectory);
    const manifestLanguages = {};
    const builds = [];
    for (const language of grammarLanguages) {
      assertLanguageDefinition(definition, language);
      const generatedDirectory = resolve(
        transactionDirectory,
        `generated-${language.mode}`,
      );
      mkdirSync(generatedDirectory);
      const artifacts = languageArtifacts(
        grammarDirectory,
        language,
        cliPath,
        generatedDirectory,
      );
      manifestLanguages[language.mode] = artifacts.manifest;
      builds.push({ language, sourceDirectory: artifacts.sourceDirectory });
    }
    assertOutcomeCoverage(manifestLanguages);

    for (const { language, sourceDirectory } of builds) {
      buildLanguage({
        cliPath,
        language,
        sourceDirectory,
        vendorDirectory: stagedDirectory,
      });
      const {
        language: languageName,
        outcomes,
        wasm,
      } = manifestLanguages[language.mode];
      const sha256 = sha256ForFile(resolve(stagedDirectory, wasm));
      if (sha256 !== language.sha256) {
        throw new Error(
          `Expected ${language.languageName} WASM SHA-256 ${language.sha256}, generated ${sha256}.`,
        );
      }
      manifestLanguages[language.mode] = {
        language: languageName,
        wasm,
        sha256,
        outcomes,
      };
    }

    const manifestPath = resolve(stagedDirectory, "tree-sitter-posix-sed.json");
    writeFileSync(
      manifestPath,
      `${JSON.stringify(
        {
          revision: grammarRevision,
          languages: manifestLanguages,
        },
        null,
        2,
      )}\n`,
    );
    chmodSync(manifestPath, 0o644);
    verifyVendorDirectory(stagedDirectory);
    replaceVendorDirectory(
      stagedDirectory,
      vendorDirectory,
      transactionDirectory,
    );
  } finally {
    if (!existsSync(resolve(transactionDirectory, "previous-vendor"))) {
      rmSync(transactionDirectory, { recursive: true, force: true });
    }
  }
}

function main() {
  const projectDirectory = fileURLToPath(new URL("..", import.meta.url));
  if (process.argv[2] === "--verify") {
    if (process.argv.length > 4) {
      throw new Error(
        "Usage: node scripts/build-tree-sitter-posix-sed-wasm.js --verify [vendor-directory]",
      );
    }
    verifyVendorDirectory(
      resolve(process.argv[3] ?? resolve(projectDirectory, "vendor")),
    );
    return;
  }
  build();
}

if (
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}

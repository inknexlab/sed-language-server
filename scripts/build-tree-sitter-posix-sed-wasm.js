#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const treeSitterPosixSedRevision = "5a1270d54337c909a8fca6b0dda396d579da79b1";
const syntaxIssueOutcomeNames = new Set([
  "implementation_defined_syntax",
  "implementation_option_syntax",
  "incomplete_syntax",
  "nonconforming_syntax",
  "undefined_syntax",
  "unspecified_syntax",
]);
const languages = [
  {
    mode: "bre",
    directory: "posix-sed-bre",
    languageName: "posix_sed_bre",
    wasmName: "tree-sitter-posix-sed-bre.wasm",
  },
  {
    mode: "ere",
    directory: "posix-sed-ere",
    languageName: "posix_sed_ere",
    wasmName: "tree-sitter-posix-sed-ere.wasm",
  },
];

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

function languageArtifacts(grammarDirectory, language) {
  const sourceDirectory = resolve(grammarDirectory, language.directory);
  const parserSource = resolve(sourceDirectory, "src/parser.c");
  if (!existsSync(parserSource)) {
    throw new Error(`Missing generated parser: ${parserSource}`);
  }
  const nodeTypesPath = resolve(sourceDirectory, "src/node-types.json");
  if (!existsSync(nodeTypesPath)) {
    throw new Error(`Missing generated node types: ${nodeTypesPath}`);
  }
  const nodeTypes = JSON.parse(readFileSync(nodeTypesPath, "utf8"));
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

function main() {
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
  const biomePath = resolve(
    projectDirectory,
    "node_modules/@biomejs/biome/bin/biome",
  );

  const actualRevision = runGit(grammarDirectory, ["rev-parse", "HEAD"]);
  if (actualRevision !== treeSitterPosixSedRevision) {
    throw new Error(
      `Expected tree-sitter-posix-sed ${treeSitterPosixSedRevision}, received ${actualRevision}.`,
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

  mkdirSync(vendorDirectory, { recursive: true });
  const definition = grammarDefinition(grammarDirectory);
  const manifestLanguages = {};
  const builds = [];
  for (const language of languages) {
    assertLanguageDefinition(definition, language);
    const artifacts = languageArtifacts(grammarDirectory, language);
    manifestLanguages[language.mode] = artifacts.manifest;
    builds.push({ language, sourceDirectory: artifacts.sourceDirectory });
  }
  assertOutcomeCoverage(manifestLanguages);

  for (const { language, sourceDirectory } of builds) {
    buildLanguage({
      cliPath,
      language,
      sourceDirectory,
      vendorDirectory,
    });
  }

  const manifestPath = resolve(vendorDirectory, "tree-sitter-posix-sed.json");
  writeFileSync(
    manifestPath,
    `${JSON.stringify(
      {
        revision: treeSitterPosixSedRevision,
        languages: manifestLanguages,
      },
      null,
      2,
    )}\n`,
  );
  const formatting = spawnSync(
    process.execPath,
    [biomePath, "format", "--write", manifestPath],
    { stdio: "inherit" },
  );
  if (formatting.status !== 0) {
    throw new Error("Failed to format the tree-sitter-posix-sed manifest.", {
      cause: formatting.error,
    });
  }
}

main();

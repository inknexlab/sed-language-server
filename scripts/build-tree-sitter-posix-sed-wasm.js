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

const treeSitterPosixSedRevision = "38b635ec26e6fd403e250b2932706cac15f36311";
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

function issueOutcomes(nodeTypes) {
  const syntaxIssue = nodeTypes.find(
    ({ named, type }) => named && type === "syntax_issue",
  );
  if (syntaxIssue?.children?.types === undefined) {
    throw new Error("The grammar does not expose syntax_issue outcomes.");
  }

  return Object.fromEntries(
    syntaxIssue.children.types.map(({ type: outcome }) => {
      const outcomeNode = nodeTypes.find(
        ({ named, type }) => named && type === outcome,
      );
      if (outcomeNode?.children?.types === undefined) {
        throw new Error(`The grammar does not expose reasons for ${outcome}.`);
      }
      return [
        outcome,
        outcomeNode.children.types.map(({ type }) => type).sort(),
      ];
    }),
  );
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

function buildLanguage({
  cliPath,
  grammarDirectory,
  language,
  vendorDirectory,
}) {
  const sourceDirectory = resolve(grammarDirectory, language.directory);
  const parserSource = resolve(sourceDirectory, "src/parser.c");
  if (!existsSync(parserSource)) {
    throw new Error(`Missing generated parser: ${parserSource}`);
  }

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

  const nodeTypes = JSON.parse(
    readFileSync(resolve(sourceDirectory, "src/node-types.json"), "utf8"),
  );
  return {
    language: language.languageName,
    wasm: language.wasmName,
    outcomes: issueOutcomes(nodeTypes),
  };
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
  for (const language of languages) {
    assertLanguageDefinition(definition, language);
    manifestLanguages[language.mode] = buildLanguage({
      cliPath,
      grammarDirectory,
      language,
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

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const treeSitterSedRevision = "b75dcb50fe259cea7d53036e915bdead3f8457ae";
const variants = ["posix-bre", "posix-ere", "gnu-bre", "gnu-ere"];
const grammarDirectoryArgument = process.argv[2];

if (grammarDirectoryArgument === undefined) {
  throw new Error("Usage: npm run build:grammar -- /path/to/tree-sitter-sed");
}

const projectDirectory = fileURLToPath(new URL("..", import.meta.url));
const grammarDirectory = resolve(grammarDirectoryArgument);
const vendorDirectory = resolve(projectDirectory, "vendor");
const cliPath = resolve(
  projectDirectory,
  "node_modules/tree-sitter-cli/cli.js",
);
const revisionResult = spawnSync(
  "git",
  ["-C", grammarDirectory, "rev-parse", "HEAD"],
  { encoding: "utf8" },
);

if (revisionResult.status !== 0) {
  throw new Error(
    `Cannot read the tree-sitter-sed revision from ${grammarDirectory}.`,
    { cause: revisionResult.error },
  );
}

const actualRevision = revisionResult.stdout.trim();
if (actualRevision !== treeSitterSedRevision) {
  throw new Error(
    `Expected tree-sitter-sed ${treeSitterSedRevision}, received ${actualRevision}.`,
  );
}

const statusResult = spawnSync(
  "git",
  ["-C", grammarDirectory, "status", "--porcelain", "--untracked-files=all"],
  { encoding: "utf8" },
);
if (statusResult.status !== 0) {
  throw new Error(
    `Cannot inspect the tree-sitter-sed checkout at ${grammarDirectory}.`,
    { cause: statusResult.error },
  );
}
if (statusResult.stdout.trim() !== "") {
  throw new Error("The tree-sitter-sed checkout must be clean.");
}

mkdirSync(vendorDirectory, { recursive: true });

for (const variant of variants) {
  const sourceDirectory = resolve(grammarDirectory, variant);
  const parserSource = resolve(sourceDirectory, "src/parser.c");
  if (!existsSync(parserSource)) {
    throw new Error(`Missing generated parser: ${parserSource}`);
  }

  const outputPath = resolve(
    vendorDirectory,
    `tree-sitter-sed-${variant}.wasm`,
  );

  const buildResult = spawnSync(
    process.execPath,
    [cliPath, "build", "--wasm", "--output", outputPath, sourceDirectory],
    { stdio: "inherit" },
  );
  if (buildResult.status !== 0) {
    throw new Error(`Failed to build the ${variant} sed grammar.`, {
      cause: buildResult.error,
    });
  }
  chmodSync(outputPath, 0o644);
}

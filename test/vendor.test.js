import assert from "node:assert/strict";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  replaceVendorDirectory,
  verifyVendorDirectory,
} from "../scripts/build-tree-sitter-posix-sed-wasm.js";

const committedVendorDirectory = fileURLToPath(
  new URL("../vendor", import.meta.url),
);
const manifestName = "tree-sitter-posix-sed.json";
const breWasmName = "tree-sitter-posix-sed-bre.wasm";
const ereWasmName = "tree-sitter-posix-sed-ere.wasm";
const artifactNames = [manifestName, breWasmName, ereWasmName];

async function copiedVendor(t) {
  const directory = await mkdtemp(
    join(tmpdir(), "sed-language-server-vendor-"),
  );
  t.after(() => rm(directory, { force: true, recursive: true }));
  await Promise.all(
    artifactNames.map((name) =>
      copyFile(join(committedVendorDirectory, name), join(directory, name)),
    ),
  );
  return directory;
}

test("verifies the committed grammar artifacts", () => {
  assert.doesNotThrow(() => verifyVendorDirectory(committedVendorDirectory));
});

test("rejects grammar manifest changes", async (t) => {
  const directory = await copiedVendor(t);
  const manifestPath = join(directory, manifestName);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.revision = "unexpected";
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`);

  assert.throws(() => verifyVendorDirectory(directory), /manifest SHA-256/);
});

test("rejects modified grammar artifacts", async (t) => {
  const directory = await copiedVendor(t);
  const wasmPath = join(directory, breWasmName);
  const wasm = await readFile(wasmPath);
  wasm[0] = (wasm[0] + 1) % 256;
  await writeFile(wasmPath, wasm);

  assert.throws(
    () => verifyVendorDirectory(directory),
    /WASM SHA-256 digest does not match/,
  );
});

test("rejects unexpected or non-regular vendor artifacts", async (t) => {
  const extraFileDirectory = await copiedVendor(t);
  await writeFile(join(extraFileDirectory, "unexpected.txt"), "unexpected");
  assert.throws(
    () => verifyVendorDirectory(extraFileDirectory),
    /must contain exactly/,
  );

  const extraDirectory = await copiedVendor(t);
  await mkdir(join(extraDirectory, "unexpected"));
  assert.throws(
    () => verifyVendorDirectory(extraDirectory),
    /must contain exactly/,
  );

  const missingFileDirectory = await copiedVendor(t);
  await rm(join(missingFileDirectory, breWasmName));
  assert.throws(
    () => verifyVendorDirectory(missingFileDirectory),
    /must contain exactly/,
  );
});

test("requires portable vendor artifact permissions", async (t) => {
  const directory = await copiedVendor(t);
  await chmod(join(directory, manifestName), 0o600);

  assert.throws(
    () => verifyVendorDirectory(directory),
    /tree-sitter-posix-sed\.json must have mode 0644/,
  );
});

async function writeVendor(directory, value) {
  await mkdir(directory);
  await Promise.all(
    artifactNames.map((name) => writeFile(join(directory, name), value)),
  );
}

test("replaces vendor artifacts atomically", async (t) => {
  const project = await mkdtemp(join(tmpdir(), "sed-language-server-build-"));
  t.after(() => rm(project, { force: true, recursive: true }));
  const transaction = join(project, "transaction");
  const stagedVendor = join(transaction, "staged-vendor");
  const vendor = join(project, "vendor");
  await mkdir(transaction);
  await writeVendor(vendor, "previous");
  await writeVendor(stagedVendor, "replacement");

  replaceVendorDirectory(stagedVendor, vendor, transaction);

  for (const name of artifactNames) {
    assert.equal(await readFile(join(vendor, name), "utf8"), "replacement");
  }
  assert.deepEqual(await readdir(transaction), []);
});

test("restores vendor artifacts when replacement fails", async (t) => {
  const project = await mkdtemp(join(tmpdir(), "sed-language-server-build-"));
  t.after(() => rm(project, { force: true, recursive: true }));
  const transaction = join(project, "transaction");
  const vendor = join(project, "vendor");
  await mkdir(transaction);
  await writeVendor(vendor, "previous");

  assert.throws(() =>
    replaceVendorDirectory(join(transaction, "missing"), vendor, transaction),
  );

  for (const name of artifactNames) {
    assert.equal(await readFile(join(vendor, name), "utf8"), "previous");
  }
  assert.deepEqual(await readdir(transaction), []);
});

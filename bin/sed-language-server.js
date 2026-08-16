#!/usr/bin/env node

import { startLanguageServer } from "../src/lsp/server.js";

if (process.argv.length === 2) {
  process.argv.push("--stdio");
}

const server = startLanguageServer();
let terminating = false;

function terminateWithSignal(signal) {
  process.off("SIGINT", onInterrupt);
  process.off("SIGTERM", onTerminate);
  process.kill(process.pid, signal);
}

function handleSignal(signal) {
  if (terminating) {
    server.forceDispose();
    terminateWithSignal(signal);
    return;
  }
  terminating = true;
  void server.dispose().then(
    () => setImmediate(() => terminateWithSignal(signal)),
    () => setImmediate(() => terminateWithSignal(signal)),
  );
}

function onInterrupt() {
  handleSignal("SIGINT");
}

function onTerminate() {
  handleSignal("SIGTERM");
}

process.on("SIGINT", onInterrupt);
process.on("SIGTERM", onTerminate);
process.once("exit", () => server.forceDispose());

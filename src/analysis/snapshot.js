import { assertParsedTree } from "./parser.js";

export function assertSnapshot(snapshot) {
  if (snapshot === null || typeof snapshot !== "object") {
    throw new TypeError("The sed syntax snapshot must be an object.");
  }
  if (typeof snapshot.source !== "string") {
    throw new TypeError("The sed source must be a string.");
  }
  assertParsedTree(snapshot.tree, snapshot.mode, snapshot.source);
}

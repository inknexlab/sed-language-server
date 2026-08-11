import { SedParser } from "../../src/analysis/parser.js";

export function offsetAt(source, { line, character }) {
  let offset = 0;
  let currentLine = 0;
  while (currentLine < line && offset < source.length) {
    if (source[offset] === "\r") {
      offset += source[offset + 1] === "\n" ? 2 : 1;
      currentLine += 1;
    } else if (source[offset] === "\n") {
      offset += 1;
      currentLine += 1;
    } else {
      offset += 1;
    }
  }
  let lineEnd = offset;
  while (
    lineEnd < source.length &&
    source[lineEnd] !== "\r" &&
    source[lineEnd] !== "\n"
  ) {
    lineEnd += 1;
  }
  return Math.min(offset + character, lineEnd);
}

export function positionAt(source, offset) {
  let line = 0;
  let lineStart = 0;
  let index = 0;
  while (index < offset) {
    if (source[index] === "\r") {
      if (source[index + 1] === "\n" && index + 1 >= offset) {
        index = offset;
        continue;
      }
      index += source[index + 1] === "\n" ? 2 : 1;
      line += 1;
      lineStart = index;
    } else if (source[index] === "\n") {
      index += 1;
      line += 1;
      lineStart = index;
    } else {
      index += 1;
    }
  }
  return { line, character: offset - lineStart };
}

export async function withAnalysisStore(mode, callback) {
  const parser = await SedParser.create(mode);
  const trees = [];
  const store = {
    open(source) {
      const tree = parser.parse(source);
      trees.push(tree);
      return { mode, source, tree };
    },
  };
  try {
    return await callback(store);
  } finally {
    for (const tree of trees) {
      tree.delete();
    }
    parser.delete();
  }
}

export async function withAnalysisSnapshot(mode, source, callback) {
  return withAnalysisStore(mode, (store) => callback(store.open(source)));
}

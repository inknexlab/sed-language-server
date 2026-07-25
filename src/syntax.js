import { fileURLToPath } from "node:url";
import { Language, Parser } from "web-tree-sitter";

await Parser.init();

async function createParser(dialect) {
  const path = fileURLToPath(
    new URL(`../vendor/tree-sitter-sed-${dialect}.wasm`, import.meta.url),
  );
  return new Parser().setLanguage(await Language.load(path));
}

const parsers = {
  posix: await createParser("posix"),
  gnu: await createParser("gnu"),
};

const documentTrees = new Map();

export function syntaxTreeFor(document, dialect) {
  const source = document.getText();
  let trees = documentTrees.get(document.uri);

  if (trees === undefined) {
    trees = new Map();
    documentTrees.set(document.uri, trees);
  }

  const cached = trees.get(dialect);
  if (
    cached !== undefined &&
    cached.version === document.version &&
    cached.source === source
  ) {
    return cached.tree;
  }

  cached?.tree.delete();
  const tree = parsers[dialect].parse(source);
  if (tree === null) {
    throw new Error(`Failed to parse ${dialect} sed source.`);
  }

  trees.set(dialect, {
    source,
    tree,
    version: document.version,
  });
  return tree;
}

export function invalidateSyntaxTreeCache(document) {
  const trees = documentTrees.get(document.uri);
  if (trees !== undefined) {
    for (const { tree } of trees.values()) {
      tree.delete();
    }
    documentTrees.delete(document.uri);
  }
}

function isSpecificSyntaxIssue(node) {
  return (
    node.isMissing ||
    node.type.startsWith("incomplete_") ||
    node.type.startsWith("invalid_") ||
    node.type === "unclosed_bracket" ||
    node.type === "unexpected_text"
  );
}

export function collectSyntaxIssueNodes(rootNode) {
  const issues = [];
  const stack = [
    {
      node: rootNode,
      children: rootNode.children,
      childIndex: 0,
      hasDescendantIssue: false,
      issueStartIndex: 0,
    },
  ];

  while (stack.length > 0) {
    const frame = stack.at(-1);
    if (frame.childIndex < frame.children.length) {
      const child = frame.children[frame.childIndex];
      frame.childIndex += 1;
      stack.push({
        node: child,
        children: child.children,
        childIndex: 0,
        hasDescendantIssue: false,
        issueStartIndex: issues.length,
      });
      continue;
    }

    const specific = isSpecificSyntaxIssue(frame.node);
    const selected =
      specific || (frame.node.hasError && !frame.hasDescendantIssue);
    if (specific) {
      issues.length = frame.issueStartIndex;
    }
    if (selected) {
      issues.push(frame.node);
    }

    stack.pop();
    const parent = stack.at(-1);
    if (parent !== undefined) {
      parent.hasDescendantIssue ||= frame.hasDescendantIssue || selected;
    }
  }

  return issues;
}

export function rangeForNode(document, node) {
  return {
    start: document.positionAt(node.startIndex),
    end: document.positionAt(node.endIndex),
  };
}

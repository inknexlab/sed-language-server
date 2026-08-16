export const checkpointInterval = 512;

function requiredNamedChild(node) {
  if (node.namedChildCount !== 1) {
    throw new Error(`${node.type} must have exactly one named child.`);
  }
  const child = node.namedChild(0);
  if (child === null) {
    throw new Error(`${node.type} does not expose its required named child.`);
  }
  return child;
}

export function descendants(root, type) {
  const matches = [];
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node !== root && (type === undefined || node.type === type)) {
      matches.push(node);
    }
    const children = node.children;
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index]);
    }
  }
  return matches;
}

export function textForIndices(source, startIndex, endIndex) {
  return source.slice(startIndex, endIndex);
}

export function textForNode(source, node) {
  return textForIndices(source, node.startIndex, node.endIndex);
}

export function rangeForNode(node) {
  return {
    startOffset: node.startIndex,
    endOffset: node.endIndex,
  };
}

export function countToken(source, node) {
  const value = textForNode(source, node);
  if (value.length === 0) {
    return undefined;
  }
  for (const character of value) {
    if (character < "0" || character > "9") {
      return undefined;
    }
  }
  return BigInt(value);
}

function invalidStructure(node) {
  return node.isMissing || node.type === "ERROR";
}

export function functionForCommand(command) {
  const wrapper = command.childForFieldName("function");
  if (wrapper === null) {
    return undefined;
  }
  return wrapper.namedChildren.find(({ type }) => type.endsWith("_function"));
}

export function indexedNodes(index, type) {
  return index.nodesByType.get(type) ?? [];
}

// Indexed nodes are collected in pre-order, so their start offsets never
// decrease and a descendant is exactly a node contained in the ancestor range.
export function indexedDescendants(index, type, ancestor, maximum = Infinity) {
  const nodes = indexedNodes(index, type);
  let lower = 0;
  let upper = nodes.length;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (nodes[middle].startIndex < ancestor.startIndex) {
      lower = middle + 1;
    } else {
      upper = middle;
    }
  }
  const result = [];
  for (
    let position = lower;
    position < nodes.length &&
    result.length < maximum &&
    nodes[position].startIndex < ancestor.endIndex;
    position += 1
  ) {
    const node = nodes[position];
    if (node.endIndex <= ancestor.endIndex) {
      result.push(node);
    }
  }
  return result;
}

export function hasIssue(index, node) {
  return index.nodesWithIssues.has(node.id);
}

export async function cstIndex(
  source,
  root,
  indexedTypes,
  { checkpoint } = {},
) {
  const nodesByType = new Map();
  const native = [];
  const nodesWithIssues = new Set();
  const structured = [];
  const symbols = [];
  const stack = [
    {
      node: root,
      command: undefined,
      errorAncestor: undefined,
      invalidAncestor: false,
      indexedAncestor: undefined,
      structuredAncestor: false,
    },
  ];
  let visited = 0;
  while (stack.length > 0) {
    visited += 1;
    if (checkpoint !== undefined && visited % checkpointInterval === 0) {
      await checkpoint();
    }
    const {
      node,
      command: ancestorCommand,
      errorAncestor,
      indexedAncestor: ancestorIndex,
      invalidAncestor,
      structuredAncestor,
    } = stack.pop();
    let indexedAncestor = ancestorIndex;
    if (node !== root && indexedTypes?.has(node.type)) {
      const matching = nodesByType.get(node.type) ?? [];
      matching.push(node);
      nodesByType.set(node.type, matching);
      indexedAncestor = { id: node.id, parent: indexedAncestor };
    }

    let nearestError = errorAncestor;
    if (node.type === "ERROR") {
      if (nearestError !== undefined) {
        nearestError.hasErrorDescendant = true;
      }
      const finding = {
        kind: "error",
        node,
        errorAncestor: nearestError !== undefined,
        hasErrorDescendant: false,
        structuredAncestor,
      };
      native.push(finding);
      nearestError = finding;
    }
    if (node.isMissing) {
      native.push({
        kind: "missing",
        node,
        errorAncestor: nearestError !== undefined,
        hasErrorDescendant: false,
        structuredAncestor,
      });
    }
    if (node.type === "syntax_issue") {
      const outcomeNode = requiredNamedChild(node);
      structured.push(
        Object.freeze({
          node,
          outcome: outcomeNode.type,
          reason: requiredNamedChild(outcomeNode).type,
        }),
      );
    }
    if (
      node.type === "ERROR" ||
      node.isMissing ||
      node.type === "syntax_issue"
    ) {
      for (
        let current = indexedAncestor;
        current !== undefined;
        current = current.parent
      ) {
        nodesWithIssues.add(current.id);
      }
    }

    const invalid = invalidAncestor || invalidStructure(node);
    const command =
      !invalid && node.type === "editing_command" ? node : ancestorCommand;
    if (!invalid && source !== undefined) {
      let kind;
      if (node.type === "label_function") {
        kind = "definition";
      } else if (
        node.type === "branch_function" ||
        node.type === "test_function"
      ) {
        kind = "reference";
      }
      if (kind !== undefined) {
        const label = node.childForFieldName("label");
        if (label !== null) {
          symbols.push(
            Object.freeze({
              kind,
              name: textForNode(source, label),
              node: label,
              command,
            }),
          );
        }
      }
    }

    const children = node.children;
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({
        node: children[index],
        command,
        errorAncestor: nearestError,
        invalidAncestor: invalid,
        indexedAncestor,
        structuredAncestor: structuredAncestor || node.type === "syntax_issue",
      });
    }
  }

  for (const [type, nodes] of nodesByType) {
    nodesByType.set(type, Object.freeze(nodes));
  }
  return Object.freeze({
    nativeIssues: Object.freeze(
      native.map((finding) => Object.freeze(finding)),
    ),
    nodesByType,
    nodesWithIssues,
    structuredIssues: Object.freeze(structured),
    symbols: Object.freeze(symbols),
  });
}

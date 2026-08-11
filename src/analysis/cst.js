const functionTypes = new Set([
  "append_function",
  "block_function",
  "branch_function",
  "change_function",
  "comment_function",
  "delete_first_line_function",
  "delete_function",
  "exchange_function",
  "get_append_function",
  "get_function",
  "hold_append_function",
  "hold_function",
  "insert_function",
  "label_function",
  "line_number_function",
  "list_function",
  "next_append_function",
  "next_function",
  "print_first_line_function",
  "print_function",
  "quit_function",
  "read_function",
  "substitute_function",
  "test_function",
  "translate_function",
  "write_function",
]);

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

export function delimiterTokenFor(node, field) {
  const delimiter = node.childForFieldName(field);
  const token = delimiter?.childForFieldName("token");
  return token?.type === "delimiter_token" ? token : undefined;
}

export function isCompleteContextAddress(node) {
  return (
    delimiterTokenFor(node, "opening") !== undefined &&
    delimiterTokenFor(node, "closing") !== undefined
  );
}

export function functionForCommand(command) {
  const wrapper = command.childForFieldName("function");
  if (wrapper === null) {
    return undefined;
  }
  for (let index = 0; index < wrapper.namedChildCount; index += 1) {
    const child = wrapper.namedChild(index);
    if (child !== null && functionTypes.has(child.type)) {
      return child;
    }
  }
  return undefined;
}

export function structuredIssues(root) {
  const findings = [];
  const stack = root.children.map((node) => ({ node, parent: root })).reverse();
  while (stack.length > 0) {
    const { node, parent } = stack.pop();
    if (node.type === "syntax_issue") {
      const outcomeNode = requiredNamedChild(node);
      const reasonNode = requiredNamedChild(outcomeNode);
      findings.push(
        Object.freeze({
          kind: "structured",
          node,
          parent,
          outcomeNode,
          reasonNode,
          outcome: outcomeNode.type,
          reason: reasonNode.type,
        }),
      );
    }
    const children = node.children;
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: children[index], parent: node });
    }
  }
  return findings;
}

export function nativeIssues(root) {
  const findings = [];
  const stack = [
    {
      node: root,
      errorAncestor: false,
      structuredAncestor: false,
    },
  ];
  while (stack.length > 0) {
    const { node, errorAncestor, structuredAncestor } = stack.pop();
    if (node.type === "ERROR") {
      findings.push(
        Object.freeze({
          kind: "error",
          node,
          errorAncestor,
          structuredAncestor,
        }),
      );
    }
    if (node.isMissing) {
      findings.push(
        Object.freeze({
          kind: "missing",
          node,
          errorAncestor,
          structuredAncestor,
        }),
      );
    }
    const children = node.children;
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({
        node: children[index],
        errorAncestor: errorAncestor || node.type === "ERROR",
        structuredAncestor: structuredAncestor || node.type === "syntax_issue",
      });
    }
  }
  return findings;
}

export function labelSymbols(source, root) {
  const symbols = [];
  const stack = root.children
    .map((node) => ({ node, command: undefined }))
    .reverse();
  while (stack.length > 0) {
    const { node, command: ancestorCommand } = stack.pop();
    const command = node.type === "editing_command" ? node : ancestorCommand;
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
    const children = node.children;
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: children[index], command });
    }
  }
  return symbols;
}

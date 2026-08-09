import { CompletionItemKind } from "vscode-languageserver";
import { commandReferences, referenceDocumentation } from "./catalog.js";
import {
  descendants,
  isCompleteContextAddress,
  labelSymbols,
  rangeForNode,
} from "./cst.js";

const completionFunctionTypes = new Set(["branch_function", "test_function"]);

function labelContextAt(snapshot, position) {
  const { document, tree } = snapshot;
  const offset = document.offsetAt(position);
  for (const node of descendants(tree.rootNode)) {
    if (!completionFunctionTypes.has(node.type)) {
      continue;
    }
    const separator = node.childForFieldName("separator");
    if (separator === null) {
      continue;
    }
    const label = node.childForFieldName("label");
    const operandStart = separator.endIndex;
    const operandEnd = label?.endIndex ?? operandStart;
    if (offset < operandStart || offset > operandEnd) {
      continue;
    }
    const insertion = document.positionAt(offset);
    const range =
      label === null
        ? { start: insertion, end: insertion }
        : rangeForNode(document, label);
    let carriageReturn = false;
    if (label !== null) {
      const editableEnd = document.offsetAt(range.end);
      const source = document.getText();
      const editable = source.slice(label.startIndex, editableEnd);
      const preserved = source.slice(editableEnd, label.endIndex);
      if (editable.includes("\r") || (preserved !== "" && preserved !== "\r")) {
        continue;
      }
      carriageReturn = preserved === "\r";
    }
    return {
      carriageReturn,
      range,
    };
  }
  return undefined;
}

function ancestorOfType(node, type) {
  let current = node.parent;
  while (current !== null && current.type !== type) {
    current = current.parent;
  }
  return current ?? undefined;
}

function addressCount(command) {
  const addresses = command.childForFieldName("addresses");
  if (addresses === null) {
    return 0;
  }
  if (descendants(addresses, "excess_address").length > 0) {
    return undefined;
  }
  if (
    descendants(addresses, "context_address").some(
      (address) => !isCompleteContextAddress(address),
    )
  ) {
    return undefined;
  }
  return addresses.childForFieldName("separator") === null ? 1 : 2;
}

function missingFunctionContextAt(snapshot, offset) {
  for (const missing of descendants(
    snapshot.tree.rootNode,
    "missing_function",
  )) {
    if (missing.startIndex !== offset || missing.endIndex !== offset) {
      continue;
    }
    const command = ancestorOfType(missing, "editing_command");
    if (command === undefined) {
      continue;
    }
    const addresses = addressCount(command);
    if (addresses !== undefined) {
      return addresses;
    }
  }
  return undefined;
}

function isBlank(value) {
  return /^[ \t]*$/.test(value);
}

function commandListBounds(list, block) {
  if (block === undefined) {
    return { start: list.startIndex, end: list.endIndex };
  }
  const verb = block.childForFieldName("verb");
  const closing = block.childForFieldName("closing");
  return {
    start: verb?.endIndex ?? list.startIndex,
    end: closing?.startIndex ?? list.endIndex,
  };
}

function commandListAt(root, offset) {
  let selected;
  let selectedDepth = -1;
  const stack = [{ node: root, parent: undefined, depth: 0 }];
  while (stack.length > 0) {
    const { node, parent, depth } = stack.pop();
    if (node.type === "command_list") {
      const block =
        parent?.type === "block_function" &&
        parent.childForFieldName("commands")?.equals(node)
          ? parent
          : undefined;
      const bounds = commandListBounds(node, block);
      const { start, end } = bounds;
      if (start <= offset && offset <= end && depth > selectedDepth) {
        selected = { block, bounds, list: node };
        selectedDepth = depth;
      }
    }
    const children = node.children;
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: children[index], parent: node, depth: depth + 1 });
    }
  }
  return selected;
}

function commandSeparators(list) {
  const separators = [];
  const stack = [...list.children].reverse();
  while (stack.length > 0) {
    const node = stack.pop();
    if (node.type === "command_list") {
      continue;
    }
    if (node.type === "command_separator") {
      separators.push(node);
      continue;
    }
    const children = node.children;
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index]);
    }
  }
  return separators;
}

function emptyCommandContextAt(snapshot, offset) {
  const { document, tree } = snapshot;
  const root = tree.rootNode;
  if (root.endIndex === 0) {
    return offset === 0;
  }
  const selected = commandListAt(root, offset);
  if (selected === undefined) {
    return false;
  }
  const { block, bounds, list } = selected;
  const separators = commandSeparators(list);
  const anchors = [bounds.start];
  for (const separator of separators) {
    anchors.push(separator.endIndex);
  }
  let anchor;
  for (const candidate of anchors) {
    if (candidate <= offset && (anchor === undefined || candidate > anchor)) {
      anchor = candidate;
    }
  }
  if (
    anchor === undefined ||
    !isBlank(document.getText().slice(anchor, offset))
  ) {
    return false;
  }
  const closing = block?.childForFieldName("closing")?.namedChild(0);
  return (
    offset === root.endIndex ||
    separators.some(({ startIndex }) => startIndex === offset) ||
    (closing?.type === "closing_brace_token" && closing.startIndex === offset)
  );
}

function commandContextAt(snapshot, position) {
  const offset = snapshot.document.offsetAt(position);
  const addresses = missingFunctionContextAt(snapshot, offset);
  if (addresses === undefined && !emptyCommandContextAt(snapshot, offset)) {
    return undefined;
  }
  const insertion = snapshot.document.positionAt(offset);
  return {
    addresses: addresses ?? 0,
    range: { start: insertion, end: insertion },
  };
}

function completionName(name, carriageReturn) {
  if (name.endsWith("\r") !== carriageReturn) {
    return undefined;
  }
  const visible = carriageReturn ? name.slice(0, -1) : name;
  return visible.length === 0 || visible.includes("\r") ? undefined : visible;
}

function labelCompletionItems(snapshot, context) {
  const items = [];
  const seen = new Set();
  for (const symbol of labelSymbols(
    snapshot.document,
    snapshot.tree.rootNode,
  )) {
    if (symbol.kind !== "definition" || seen.has(symbol.name)) {
      continue;
    }
    seen.add(symbol.name);
    const name = completionName(symbol.name, context.carriageReturn);
    if (name === undefined) {
      continue;
    }
    items.push({
      label: name,
      kind: CompletionItemKind.Reference,
      textEdit: {
        range: context.range,
        newText: name,
      },
    });
  }
  return items;
}

function commandCompletionItems(context, documentationKind) {
  return commandReferences()
    .filter(({ maximumAddresses }) => maximumAddresses >= context.addresses)
    .map((reference) => ({
      label: reference.verb,
      kind: CompletionItemKind.Keyword,
      detail: reference.title,
      documentation: referenceDocumentation(reference, documentationKind),
      textEdit: {
        range: context.range,
        newText: reference.verb,
      },
    }));
}

export function completionItems(snapshot, position, documentationKind) {
  const context = labelContextAt(snapshot, position);
  if (context === undefined) {
    const commandContext = commandContextAt(snapshot, position);
    return commandContext === undefined
      ? []
      : commandCompletionItems(commandContext, documentationKind);
  }
  return labelCompletionItems(snapshot, context);
}

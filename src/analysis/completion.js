import { commandReferences, substitutionFlagReferences } from "./catalog.js";
import {
  delimiterTokenFor,
  descendants,
  labelSymbols,
  rangeForNode as offsetRangeForNode,
  textForNode,
} from "./cst.js";
import { assertSnapshot } from "./snapshot.js";

const completionFunctionTypes = new Set(["branch_function", "test_function"]);
const commandContextTypes = new Set(["block_function", "command_list"]);
const editingCommandTypes = new Set(["editing_command"]);
const functionBoundaryTypes = new Set(["function"]);
const substitutionFunctionTypes = new Set(["substitute_function"]);
const substitutionFlagNodeTypes = new Set(
  substitutionFlagReferences().map(({ nodeType }) => nodeType),
);

function sameNode(left, right) {
  return left != null && right != null && left.equals(right);
}

function localPathsAt(root, offset) {
  const leaves = [];
  const add = (node) => {
    if (!leaves.some((candidate) => sameNode(candidate, node))) {
      leaves.push(node);
    }
  };
  if (root.startIndex === root.endIndex) {
    add(root);
  } else {
    if (root.startIndex <= offset && offset < root.endIndex) {
      add(root.descendantForIndex(offset, offset + 1));
    }
    if (offset > root.startIndex) {
      add(root.descendantForIndex(offset - 1, offset));
    }
  }
  return leaves.map((leaf) => {
    const path = [];
    let node = leaf;
    while (node !== null) {
      path.push(node);
      if (node.type === "editing_command") {
        break;
      }
      node = node.parent;
    }
    return path;
  });
}

function nearestLocalNodes(paths, types, stopTypes) {
  const matches = [];
  for (const path of paths) {
    for (const node of path) {
      if (types.has(node.type)) {
        if (!matches.some((candidate) => sameNode(candidate, node))) {
          matches.push(node);
        }
        break;
      }
      if (stopTypes?.has(node.type)) {
        break;
      }
    }
  }
  return matches;
}

function labelContextAt(snapshot, offset, paths) {
  const { source } = snapshot;
  for (const node of nearestLocalNodes(
    paths,
    completionFunctionTypes,
    functionBoundaryTypes,
  )) {
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
    let startOffset = offset;
    let endOffset = offset;
    let carriageReturn = false;
    if (label !== null) {
      const range = offsetRangeForNode(label);
      startOffset = range.startOffset;
      endOffset =
        source[label.endIndex - 1] === "\r" && source[label.endIndex] === "\n"
          ? label.endIndex - 1
          : label.endIndex;
      const editable = source.slice(label.startIndex, endOffset);
      const preserved = source.slice(endOffset, label.endIndex);
      if (editable.includes("\r") || (preserved !== "" && preserved !== "\r")) {
        continue;
      }
      carriageReturn = preserved === "\r";
    }
    return {
      carriageReturn,
      endOffset,
      startOffset,
    };
  }
  return undefined;
}

function addressCount(command) {
  const addresses = command.childForFieldName("addresses");
  if (addresses === null) {
    return 0;
  }
  const negation = command.childForFieldName("negation");
  if (
    descendants(addresses, "syntax_issue").length > 0 ||
    (negation !== null && descendants(negation, "syntax_issue").length > 0)
  ) {
    return undefined;
  }
  return addresses.childForFieldName("second") === null ? 1 : 2;
}

function missingFunctionContextAt(offset, paths) {
  for (const command of nearestLocalNodes(paths, editingCommandTypes)) {
    const wrapper = command.childForFieldName("function");
    const issue = wrapper?.childForFieldName("issue");
    if (
      issue === null ||
      issue === undefined ||
      !descendants(issue, "missing_function").some(
        (missing) =>
          missing.startIndex === offset && missing.endIndex === offset,
      )
    ) {
      continue;
    }
    const addresses = addressCount(command);
    if (addresses !== undefined) {
      return addresses;
    }
  }
  return undefined;
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

function commandListAt(offset, paths) {
  const candidate = (list, block) => {
    if (list === null) {
      return undefined;
    }
    const bounds = commandListBounds(list, block);
    if (bounds.start <= offset && offset <= bounds.end) {
      return { block, bounds, list };
    }
    return undefined;
  };
  for (const node of nearestLocalNodes(paths, commandContextTypes)) {
    if (node.type === "command_list") {
      const value = candidate(node, undefined);
      if (value !== undefined) {
        return value;
      }
    }
    if (node.type === "block_function") {
      const value = candidate(node.childForFieldName("commands"), node);
      if (value !== undefined) {
        return value;
      }
    }
  }
  return undefined;
}

function separatorAt(root, list, offset) {
  if (offset >= root.endIndex) {
    return undefined;
  }
  let node = root.descendantForIndex(offset, offset + 1);
  while (node !== null && !sameNode(node, list)) {
    if (node.type === "command_separator" && node.startIndex === offset) {
      return node;
    }
    node = node.parent;
  }
  return undefined;
}

function commandSlotEvidence(list, offset) {
  let lower = 0;
  let upper = list.namedChildCount;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    const child = list.namedChild(middle);
    if (child !== null && child.startIndex <= offset) {
      lower = middle + 1;
    } else {
      upper = middle;
    }
  }
  const child = lower === 0 ? null : list.namedChild(lower - 1);
  return (
    (child?.type === "empty_command" && child.endIndex >= offset) ||
    (child?.type === "command_separator" && child.endIndex <= offset)
  );
}

function isLineSeparatorAt(source, root, offset) {
  if (offset >= root.endIndex) {
    return false;
  }
  let node = root.descendantForIndex(offset, offset + 1);
  while (node !== null) {
    if (node.type === "command_separator") {
      return node.startIndex === offset && textForNode(source, node) === "\n";
    }
    node = node.parent;
  }
  return false;
}

function emptyCommandContextAt(snapshot, offset, paths) {
  const { tree } = snapshot;
  const root = tree.rootNode;
  if (root.endIndex === 0) {
    return offset === 0;
  }
  const selected = commandListAt(offset, paths);
  if (selected === undefined) {
    return false;
  }
  const { block, list } = selected;
  if (!commandSlotEvidence(list, offset)) {
    return false;
  }
  const closing = block?.childForFieldName("closing")?.namedChild(0);
  return (
    offset === root.endIndex ||
    separatorAt(root, list, offset) !== undefined ||
    (closing?.type === "closing_brace_token" && closing.startIndex === offset)
  );
}

function commandContextAt(snapshot, offset, paths) {
  const addresses = missingFunctionContextAt(offset, paths);
  if (
    addresses === undefined &&
    !emptyCommandContextAt(snapshot, offset, paths)
  ) {
    return undefined;
  }
  return {
    addresses: addresses ?? 0,
    endOffset: offset,
    startOffset: offset,
  };
}

function substitutionFlagNodeType(node) {
  if (node.type !== "write_flag") {
    return substitutionFlagNodeTypes.has(node.type) ? node.type : undefined;
  }
  return node.childForFieldName("verb")?.type === "substitution_flag"
    ? "substitution_flag"
    : undefined;
}

function substitutionFlagContextAt(snapshot, offset, paths) {
  const { source, tree } = snapshot;
  for (const substitute of nearestLocalNodes(
    paths,
    substitutionFunctionTypes,
    functionBoundaryTypes,
  )) {
    const closing = delimiterTokenFor(substitute, "closing");
    if (closing === undefined) {
      continue;
    }
    const flags = substitute.childForFieldName("flags");
    if (flags !== null && flags.startIndex !== closing.endIndex) {
      continue;
    }
    const children = flags === null ? [] : [...flags.namedChildren];
    let carriageReturn;
    const last = children.at(-1);
    if (
      last?.type === "syntax_issue" &&
      textForNode(source, last) === "\r" &&
      isLineSeparatorAt(source, tree.rootNode, last.endIndex)
    ) {
      carriageReturn = children.pop();
    }
    if (children.some(({ type }) => type === "syntax_issue")) {
      continue;
    }

    const writeIndex = children.findIndex(({ type }) => type === "write_flag");
    if (writeIndex >= 0 && writeIndex !== children.length - 1) {
      continue;
    }
    const write = writeIndex < 0 ? undefined : children[writeIndex];
    const nonWrite = write === undefined ? children : children.slice(0, -1);
    const present = new Set();
    const boundaries = new Set([closing.endIndex]);
    let logicalEnd = closing.endIndex;
    let valid = true;
    for (const node of nonWrite) {
      const nodeType = substitutionFlagNodeType(node);
      if (node.startIndex !== logicalEnd || nodeType === undefined) {
        valid = false;
        break;
      }
      present.add(nodeType);
      logicalEnd = node.endIndex;
      boundaries.add(logicalEnd);
    }
    if (!valid) {
      continue;
    }
    if (write !== undefined) {
      const nodeType = substitutionFlagNodeType(write);
      if (write.startIndex !== logicalEnd || nodeType === undefined) {
        continue;
      }
      present.add(nodeType);
    } else if (
      carriageReturn !== undefined &&
      carriageReturn.startIndex !== logicalEnd
    ) {
      continue;
    }
    if (!boundaries.has(offset)) {
      continue;
    }

    const lineTail =
      source.length === logicalEnd ||
      isLineSeparatorAt(source, tree.rootNode, logicalEnd) ||
      (carriageReturn?.startIndex === logicalEnd &&
        isLineSeparatorAt(source, tree.rootNode, carriageReturn.endIndex));
    return {
      lineTail: write === undefined && offset === logicalEnd && lineTail,
      present,
      endOffset: offset,
      startOffset: offset,
    };
  }
  return undefined;
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
  for (const symbol of labelSymbols(snapshot.source, snapshot.tree.rootNode)) {
    if (symbol.kind !== "definition" || seen.has(symbol.name)) {
      continue;
    }
    seen.add(symbol.name);
    const name = completionName(symbol.name, context.carriageReturn);
    if (name === undefined) {
      continue;
    }
    items.push({
      category: "label",
      endOffset: context.endOffset,
      label: name,
      newText: name,
      startOffset: context.startOffset,
    });
  }
  return items;
}

function referenceCompletionItem(reference, label, category, context) {
  return {
    category,
    endOffset: context.endOffset,
    label,
    newText: label,
    startOffset: context.startOffset,
    detail: reference.title,
    documentation: {
      synopsis: reference.synopsis,
      description: reference.description,
    },
  };
}

function commandCompletionItems(context) {
  return commandReferences()
    .filter(({ maximumAddresses }) => maximumAddresses >= context.addresses)
    .map((reference) =>
      referenceCompletionItem(reference, reference.verb, "command", context),
    );
}

function substitutionFlagCompletionItems(context) {
  return substitutionFlagReferences()
    .filter(
      (reference) =>
        reference.spelling !== null &&
        !context.present.has(reference.nodeType) &&
        (!reference.terminal || context.lineTail),
    )
    .map((reference) =>
      referenceCompletionItem(
        reference,
        reference.spelling,
        "substitutionFlag",
        context,
      ),
    );
}

export function completions(snapshot, offset) {
  assertSnapshot(snapshot);
  if (!Number.isInteger(offset)) {
    throw new TypeError("The sed completion offset must be an integer.");
  }
  if (offset < 0 || offset > snapshot.source.length) {
    throw new RangeError("The sed completion offset is outside the source.");
  }
  const paths = localPathsAt(snapshot.tree.rootNode, offset);
  const labelContext = labelContextAt(snapshot, offset, paths);
  if (labelContext !== undefined) {
    return labelCompletionItems(snapshot, labelContext);
  }
  const substitutionFlagContext = substitutionFlagContextAt(
    snapshot,
    offset,
    paths,
  );
  if (substitutionFlagContext !== undefined) {
    return substitutionFlagCompletionItems(substitutionFlagContext);
  }
  const commandContext = commandContextAt(snapshot, offset, paths);
  return commandContext === undefined
    ? []
    : commandCompletionItems(commandContext);
}

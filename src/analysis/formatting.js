import {
  functionForCommand,
  nativeIssues,
  structuredIssues,
  textForIndices,
} from "./cst.js";
import { assertSnapshot } from "./snapshot.js";

const formattableOutcomes = new Set([
  "implementation_defined_syntax",
  "implementation_option_syntax",
]);
const maximumFormattedSourceLength = 2 ** 24;

function normalizeIndentation(options) {
  if (
    options !== undefined &&
    (options === null || typeof options !== "object" || Array.isArray(options))
  ) {
    throw new TypeError("Sed formatting options must be an object.");
  }
  const insertSpaces = options?.insertSpaces ?? true;
  if (typeof insertSpaces !== "boolean") {
    throw new TypeError("insertSpaces must be a boolean.");
  }
  const width = options?.tabSize ?? 2;
  if (!Number.isSafeInteger(width) || width <= 0) {
    throw new TypeError("tabSize must be a positive safe integer.");
  }
  return insertSpaces
    ? { character: " ", width }
    : { character: "\t", width: 1 };
}

function structuralStart(command) {
  return (
    command.namedChildren.find(
      ({ type }) =>
        type === "address_clause" || type === "negation" || type === "function",
    )?.startIndex ?? command.startIndex
  );
}

function emptySeparator(emptyCommand) {
  return emptyCommand.namedChildren.find(
    ({ type }) => type === "command_separator",
  );
}

function renderCommandList(source, commandList, indent) {
  const rendered = [];
  let renderedLength = 0;

  function appendLine(depth, text) {
    const prefixLength = indent.width * depth;
    const lineLength = prefixLength + text.length;
    if (
      !Number.isSafeInteger(prefixLength) ||
      !Number.isSafeInteger(lineLength) ||
      renderedLength + lineLength + 1 > maximumFormattedSourceLength
    ) {
      return false;
    }
    rendered.push(indent.character.repeat(prefixLength) + text);
    renderedLength += lineLength + 1;
    return true;
  }

  const frames = [
    {
      commandList,
      nextChildIndex: 0,
      depth: 0,
      skippedOpeningNewline: true,
      awaitingCommandNewline: false,
      closingLine: undefined,
    },
  ];
  while (frames.length > 0) {
    const frame = frames.at(-1);
    if (frame.nextChildIndex >= frame.commandList.namedChildCount) {
      frames.pop();
      if (frame.closingLine !== undefined) {
        if (!appendLine(frame.closingLine.depth, frame.closingLine.text)) {
          return undefined;
        }
      }
      continue;
    }
    const child = frame.commandList.namedChild(frame.nextChildIndex);
    frame.nextChildIndex += 1;
    if (child === null) {
      continue;
    }
    if (child.type === "editing_command") {
      const functionNode = functionForCommand(child);
      if (functionNode?.type !== "block_function") {
        if (
          !appendLine(
            frame.depth,
            textForIndices(source, structuralStart(child), child.endIndex),
          )
        ) {
          return undefined;
        }
        frame.awaitingCommandNewline = true;
        frame.skippedOpeningNewline = true;
        continue;
      }

      const verb = functionNode.childForFieldName("verb");
      const commands = functionNode.childForFieldName("commands");
      const closing = functionNode.childForFieldName("closing");
      if (verb === null || commands === null || closing === null) {
        continue;
      }
      if (
        !appendLine(
          frame.depth,
          textForIndices(source, structuralStart(child), verb.endIndex),
        )
      ) {
        return undefined;
      }
      frame.awaitingCommandNewline = true;
      frame.skippedOpeningNewline = true;
      frames.push({
        commandList: commands,
        nextChildIndex: 0,
        depth: frame.depth + 1,
        skippedOpeningNewline: false,
        awaitingCommandNewline: false,
        closingLine: {
          depth: frame.depth,
          text: textForIndices(source, closing.startIndex, closing.endIndex),
        },
      });
      continue;
    }
    const separator =
      child.type === "command_separator"
        ? child
        : child.type === "empty_command"
          ? emptySeparator(child)
          : undefined;
    if (separator === undefined) {
      continue;
    }
    const text = textForIndices(
      source,
      separator.startIndex,
      separator.endIndex,
    );
    if (text !== "\n") {
      continue;
    }
    if (frame.awaitingCommandNewline) {
      frame.awaitingCommandNewline = false;
      continue;
    }
    if (!frame.skippedOpeningNewline) {
      frame.skippedOpeningNewline = true;
      continue;
    }
    if (!appendLine(0, "")) {
      return undefined;
    }
  }
  return rendered;
}

function canFormat(root) {
  return (
    nativeIssues(root).length === 0 &&
    structuredIssues(root).every(({ outcome }) =>
      formattableOutcomes.has(outcome),
    )
  );
}

function preserveDefaultOutputBehavior(defaultOutputSuppressed, formatted) {
  if (!defaultOutputSuppressed && formatted.startsWith("#n")) {
    return ` ${formatted}`;
  }
  return formatted;
}

export function format(snapshot, options) {
  assertSnapshot(snapshot);
  const indent = normalizeIndentation(options);
  const { source, tree } = snapshot;
  if (!canFormat(tree.rootNode)) {
    return undefined;
  }
  const commandList = tree.rootNode.namedChildren.find(
    ({ type }) => type === "command_list",
  );
  const rendered =
    commandList === undefined
      ? []
      : renderCommandList(source, commandList, indent);
  if (rendered === undefined) {
    return undefined;
  }
  const defaultOutputSuppressed =
    tree.rootNode.descendantsOfType("default_output_suppression").length > 0;
  const formatted = preserveDefaultOutputBehavior(
    defaultOutputSuppressed,
    `${rendered.join("\n")}\n`,
  );
  if (formatted.length > maximumFormattedSourceLength) {
    return undefined;
  }
  if (formatted === source) {
    return undefined;
  }
  return formatted;
}

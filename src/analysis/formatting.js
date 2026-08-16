import {
  checkpointInterval,
  cstIndex,
  functionForCommand,
  indexedNodes,
  textForIndices,
} from "./cst.js";

const formattableOutcomes = new Set([
  "implementation_defined_syntax",
  "implementation_option_syntax",
]);
const formattingNodeTypes = new Set(["default_output_suppression"]);
const maximumFormattedSourceLength = 2 ** 24;

function booleanOption(options, name, defaultValue) {
  const value = options?.[name];
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value !== "boolean") {
    throw new TypeError(`${name} must be a boolean.`);
  }
  return value;
}

function normalizeFormattingOptions(options) {
  if (
    options !== undefined &&
    (options === null || typeof options !== "object" || Array.isArray(options))
  ) {
    throw new TypeError("Sed formatting options must be an object.");
  }
  const insertSpaces = booleanOption(options, "insertSpaces", true);
  const width = options?.tabSize === undefined ? 2 : options.tabSize;
  if (!Number.isSafeInteger(width) || width < 0) {
    throw new TypeError("tabSize must be a non-negative safe integer.");
  }
  // Rendered layout has no trailing whitespace of its own. Whitespace retained
  // from the CST can be part of a sed operand and must not be trimmed.
  booleanOption(options, "trimTrailingWhitespace", false);
  return {
    indent: insertSpaces
      ? { character: " ", width }
      : { character: "\t", width: 1 },
    insertFinalNewline: booleanOption(options, "insertFinalNewline", true),
    trimFinalNewlines: booleanOption(options, "trimFinalNewlines", false),
  };
}

function structuralStart(command) {
  return (
    command.namedChildren.find(
      ({ type }) =>
        type === "address_clause" || type === "negation" || type === "function",
    )?.startIndex ?? command.startIndex
  );
}

function separatorText(source, child) {
  const separator =
    child.type === "command_separator"
      ? child
      : child.type === "empty_command"
        ? child.namedChildren.find(({ type }) => type === "command_separator")
        : undefined;
  return separator === undefined
    ? undefined
    : textForIndices(source, separator.startIndex, separator.endIndex);
}

function blockFields(functionNode) {
  const verb = functionNode.childForFieldName("verb");
  const commands = functionNode.childForFieldName("commands");
  const closing = functionNode.childForFieldName("closing");
  return verb === null || commands === null || closing === null
    ? undefined
    : { closing, commands, verb };
}

async function renderCommandList(source, commandList, indent, checkpoint) {
  const rendered = [];
  let renderedLength = 0;
  let visited = 0;

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
      children: commandList.namedChildren,
      nextChildIndex: 0,
      depth: 0,
      skippedOpeningNewline: true,
      awaitingCommandNewline: false,
      closingLine: undefined,
    },
  ];
  while (frames.length > 0) {
    visited += 1;
    if (checkpoint !== undefined && visited % checkpointInterval === 0) {
      await checkpoint();
    }
    const frame = frames.at(-1);
    if (frame.nextChildIndex >= frame.children.length) {
      frames.pop();
      if (frame.closingLine !== undefined) {
        if (!appendLine(frame.closingLine.depth, frame.closingLine.text)) {
          return undefined;
        }
      }
      continue;
    }
    const child = frame.children[frame.nextChildIndex];
    frame.nextChildIndex += 1;
    if (child.type === "editing_command") {
      const functionNode = functionForCommand(child);
      const block =
        functionNode?.type === "block_function"
          ? blockFields(functionNode)
          : undefined;
      // A block the CST does not fully expose cannot be rendered without
      // dropping source, so the document is left unformatted instead.
      if (functionNode?.type === "block_function" && block === undefined) {
        return undefined;
      }
      if (
        !appendLine(
          frame.depth,
          textForIndices(
            source,
            structuralStart(child),
            block === undefined ? child.endIndex : block.verb.endIndex,
          ),
        )
      ) {
        return undefined;
      }
      frame.awaitingCommandNewline = true;
      frame.skippedOpeningNewline = true;
      if (block !== undefined) {
        frames.push({
          children: block.commands.namedChildren,
          nextChildIndex: 0,
          depth: frame.depth + 1,
          skippedOpeningNewline: false,
          awaitingCommandNewline: false,
          closingLine: {
            depth: frame.depth,
            text: textForIndices(
              source,
              block.closing.startIndex,
              block.closing.endIndex,
            ),
          },
        });
      }
      continue;
    }
    // Written separators become line breaks: the newline that terminates a
    // command is consumed, the newline that opens a block is dropped, and any
    // other newline is a blank line the author wrote.
    if (separatorText(source, child) !== "\n") {
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

function canFormat(index) {
  return (
    index.nativeIssues.length === 0 &&
    index.structuredIssues.every(({ outcome }) =>
      formattableOutcomes.has(outcome),
    )
  );
}

function joinLines(rendered, source, options) {
  let lineCount = rendered.length;
  if (options.trimFinalNewlines) {
    while (lineCount > 0 && rendered[lineCount - 1] === "") {
      lineCount -= 1;
    }
  }
  const formatted = rendered.slice(0, lineCount).join("\n");
  return options.insertFinalNewline || source.endsWith("\n")
    ? `${formatted}\n`
    : formatted;
}

function preserveDefaultOutputBehavior(defaultOutputSuppressed, formatted) {
  if (!defaultOutputSuppressed && formatted.startsWith("#n")) {
    return ` ${formatted}`;
  }
  return formatted;
}

function preserveLeadingByteOrderMark(source, formatted) {
  return source.startsWith("\uFEFF") ? `\uFEFF${formatted}` : formatted;
}

export async function analyzeFormatting(
  snapshot,
  options,
  { checkpoint } = {},
) {
  const normalized = normalizeFormattingOptions(options);
  const { source, tree } = snapshot;
  if (source.length === 0) {
    return undefined;
  }
  const index = await cstIndex(undefined, tree.rootNode, formattingNodeTypes, {
    checkpoint,
  });
  await checkpoint?.();
  if (!canFormat(index)) {
    return undefined;
  }
  const commandList = tree.rootNode.namedChildren.find(
    ({ type }) => type === "command_list",
  );
  const rendered =
    commandList === undefined
      ? []
      : await renderCommandList(
          source,
          commandList,
          normalized.indent,
          checkpoint,
        );
  if (rendered === undefined) {
    return undefined;
  }
  const suppressesDefaultOutput =
    indexedNodes(index, "default_output_suppression").length > 0;
  const formatted = preserveLeadingByteOrderMark(
    source,
    preserveDefaultOutputBehavior(
      suppressesDefaultOutput,
      joinLines(rendered, source, normalized),
    ),
  );
  return formatted.length > maximumFormattedSourceLength || formatted === source
    ? undefined
    : formatted;
}

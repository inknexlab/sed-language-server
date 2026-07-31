import { functionForCommand, nativeIssues, structuredIssues } from "./cst.js";

const formattableOutcomes = new Set([
  "implementation_defined_syntax",
  "implementation_option_syntax",
]);

function indentation(options) {
  if (options?.insertSpaces === false) {
    return "\t";
  }
  const requested = Number(options?.tabSize);
  const width = Number.isInteger(requested) && requested > 0 ? requested : 2;
  return " ".repeat(width);
}

function textBetween(document, startIndex, endIndex) {
  return document.getText({
    start: document.positionAt(startIndex),
    end: document.positionAt(endIndex),
  });
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

function renderCommand(document, command, depth, indent) {
  const prefix = indent.repeat(depth);
  const functionNode = functionForCommand(command);
  if (functionNode?.type !== "block_function") {
    return (
      prefix + textBetween(document, structuralStart(command), command.endIndex)
    );
  }

  const verb = functionNode.childForFieldName("verb");
  const commands = functionNode.childForFieldName("commands");
  const closing = functionNode.childForFieldName("closing");
  if (verb === null || commands === null || closing === null) {
    return undefined;
  }
  const opening = textBetween(
    document,
    structuralStart(command),
    verb.endIndex,
  );
  const nested = renderCommandList(document, commands, depth + 1, indent, true);
  const closingText = textBetween(
    document,
    closing.startIndex,
    closing.endIndex,
  );
  return [`${prefix}${opening}`, ...nested, `${prefix}${closingText}`].join(
    "\n",
  );
}

function renderCommandList(document, commandList, depth, indent, nested) {
  const rendered = [];
  let skippedOpeningNewline = !nested;
  let awaitingCommandNewline = false;
  for (const child of commandList.namedChildren) {
    if (child.type === "editing_command") {
      const command = renderCommand(document, child, depth, indent);
      if (command !== undefined) {
        rendered.push(command);
        awaitingCommandNewline = true;
        skippedOpeningNewline = true;
      }
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
    const text = textBetween(
      document,
      separator.startIndex,
      separator.endIndex,
    );
    if (text !== "\n") {
      continue;
    }
    if (awaitingCommandNewline) {
      awaitingCommandNewline = false;
      continue;
    }
    if (!skippedOpeningNewline) {
      skippedOpeningNewline = true;
      continue;
    }
    rendered.push("");
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

function preserveInitialNoDefaultOutput(source, formatted) {
  if (!source.startsWith("#n") && formatted.startsWith("#n")) {
    return ` ${formatted}`;
  }
  return formatted;
}

export function formattingEdits(snapshot, options) {
  const { document, tree } = snapshot;
  if (!canFormat(tree.rootNode)) {
    return [];
  }
  const commandList = tree.rootNode.namedChildren.find(
    ({ type }) => type === "command_list",
  );
  const rendered =
    commandList === undefined
      ? []
      : renderCommandList(
          document,
          commandList,
          0,
          indentation(options),
          false,
        );
  const source = document.getText();
  const formatted = preserveInitialNoDefaultOutput(
    source,
    `${rendered.join("\n")}\n`,
  );
  if (formatted === source) {
    return [];
  }
  return [
    {
      range: {
        start: { line: 0, character: 0 },
        end: document.positionAt(source.length),
      },
      newText: formatted,
    },
  ];
}

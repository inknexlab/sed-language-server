import {
  functionForCommand,
  nativeIssues,
  structuredIssues,
  textForIndices,
} from "./cst.js";

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

function renderCommandList(document, commandList, indent) {
  const rendered = [];
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
        rendered.push(frame.closingLine);
      }
      continue;
    }
    const child = frame.commandList.namedChild(frame.nextChildIndex);
    frame.nextChildIndex += 1;
    if (child === null) {
      continue;
    }
    if (child.type === "editing_command") {
      const prefix = indent.repeat(frame.depth);
      const functionNode = functionForCommand(child);
      if (functionNode?.type !== "block_function") {
        rendered.push(
          prefix +
            textForIndices(document, structuralStart(child), child.endIndex),
        );
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
      rendered.push(
        prefix +
          textForIndices(document, structuralStart(child), verb.endIndex),
      );
      frame.awaitingCommandNewline = true;
      frame.skippedOpeningNewline = true;
      frames.push({
        commandList: commands,
        nextChildIndex: 0,
        depth: frame.depth + 1,
        skippedOpeningNewline: false,
        awaitingCommandNewline: false,
        closingLine:
          prefix +
          textForIndices(document, closing.startIndex, closing.endIndex),
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
      document,
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

function preserveDefaultOutputBehavior(defaultOutputSuppressed, formatted) {
  if (!defaultOutputSuppressed && formatted.startsWith("#n")) {
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
      : renderCommandList(document, commandList, indentation(options));
  const source = document.getText();
  const defaultOutputSuppressed =
    tree.rootNode.descendantsOfType("default_output_suppression").length > 0;
  const formatted = preserveDefaultOutputBehavior(
    defaultOutputSuppressed,
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

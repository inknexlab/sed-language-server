import { collectSyntaxIssueNodes, syntaxTreeFor } from "./syntax.js";

function lineEndingCount(source) {
  return source.match(/\r\n|\n/g)?.length ?? 0;
}

function formatCommandList(
  node,
  source,
  indentation,
  lineEnding,
  depth,
  {
    minimumLeadingLineEndings = 0,
    minimumTrailingLineEndings = 0,
    preserveSilentCommentPrefix = false,
  } = {},
) {
  const commands = node.children.filter((child) => child.type === "command");
  if (commands.length === 0) {
    const count = Math.max(
      lineEndingCount(node.text),
      minimumLeadingLineEndings,
      minimumTrailingLineEndings,
    );
    return lineEnding.repeat(count);
  }

  const first = commands[0];
  const leadingSource = source.slice(node.startIndex, first.startIndex);
  const leadingCount = lineEndingCount(leadingSource);
  let formatted = lineEnding.repeat(
    Math.max(leadingCount, minimumLeadingLineEndings),
  );
  if (
    preserveSilentCommentPrefix &&
    leadingCount === 0 &&
    first.text.startsWith("#n")
  ) {
    formatted += leadingSource;
  }

  for (const [index, command] of commands.entries()) {
    if (index > 0) {
      const previous = commands[index - 1];
      const separatorSource = source.slice(
        previous.endIndex,
        command.startIndex,
      );
      formatted += lineEnding.repeat(
        Math.max(1, lineEndingCount(separatorSource)),
      );
    }
    formatted += formatCommand(command, source, indentation, lineEnding, depth);
  }

  const last = commands.at(-1);
  const trailingSource = source.slice(last.endIndex, node.endIndex);
  formatted += lineEnding.repeat(
    Math.max(lineEndingCount(trailingSource), minimumTrailingLineEndings),
  );
  return formatted;
}

function formatCommand(command, source, indentation, lineEnding, depth) {
  const prefix = indentation.repeat(depth);
  const body = command.childForFieldName("body");
  if (body.type !== "block_command") {
    return `${prefix}${command.text}`;
  }

  const openingBrace = body.childForFieldName("name");
  const opening = command.text.slice(
    0,
    openingBrace.endIndex - command.startIndex,
  );
  const commandList = body.childForFieldName("argument");
  if (commandList === null) {
    return `${prefix}${opening}}`;
  }

  const formattedCommands = formatCommandList(
    commandList,
    source,
    indentation,
    lineEnding,
    depth + 1,
    {
      minimumLeadingLineEndings: 1,
      minimumTrailingLineEndings: 1,
    },
  );

  return `${prefix}${opening}${formattedCommands}${prefix}}`;
}

function indentationFor(options) {
  return options.insertSpaces ? " ".repeat(options.tabSize) : "\t";
}

function formatScript(rootNode, source, options) {
  const lineEnding = source.match(/\r\n|\n/)?.[0] ?? "\n";
  const indentation = indentationFor(options);
  const firstLine = rootNode.children.find(
    (child) => child.type === "first_line_silent",
  );
  const commandList = rootNode.children.find(
    (child) => child.type === "command_list",
  );
  const firstLineText = firstLine?.text ?? "";
  if (commandList === undefined) {
    return firstLineText;
  }

  return (
    firstLineText +
    formatCommandList(commandList, source, indentation, lineEnding, 0, {
      preserveSilentCommentPrefix: firstLine === undefined,
    })
  );
}

export function createFormattingEdits(document, syntax, options) {
  const source = document.getText();
  const rootNode = syntaxTreeFor(document, syntax).rootNode;
  if (rootNode.hasError || collectSyntaxIssueNodes(rootNode).length > 0) {
    return [];
  }

  const formatted = formatScript(rootNode, source, options);
  if (!source.startsWith("#n") && formatted.startsWith("#n")) {
    return [];
  }
  if (formatted === source) {
    return [];
  }

  return [
    {
      range: {
        start: document.positionAt(0),
        end: document.positionAt(source.length),
      },
      newText: formatted,
    },
  ];
}

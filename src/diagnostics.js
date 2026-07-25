import { DiagnosticSeverity } from "vscode-languageserver/node";
import {
  collectSyntaxIssueNodes,
  rangeForNode,
  syntaxTreeFor,
} from "./syntax.js";

const diagnosticSource = "sed-language-server";
const missingArgumentIssueByCommand = {
  ":": "missing_label_argument",
  R: "missing_file_argument",
  W: "missing_file_argument",
  a: "missing_multiline_text_argument",
  c: "missing_multiline_text_argument",
  i: "missing_multiline_text_argument",
  r: "missing_file_argument",
  s: "missing_command_delimiter",
  w: "missing_file_argument",
  y: "missing_command_delimiter",
};
const missingValueIssueByNodeType = {
  line_offset: "missing_line_offset",
  step_value: "missing_step_value",
};
const missingValueIssueByOperator = {
  ",": "missing_address",
  "+": "missing_line_offset",
  "~": "missing_step_value",
};
const maximumAddressesByDialect = {
  posix: {
    ":": 0,
    "=": 1,
    a: 1,
    i: 1,
    q: 1,
    r: 1,
  },
  gnu: {
    ":": 0,
    Q: 1,
    q: 1,
  },
};
const diagnosticNodeTypes = [
  "command",
  "label_definition",
  "label_reference",
  "occurrence_flag",
  "regex_address",
  "step_value",
  "substitute_argument",
  "translate_argument",
];
const unterminatedIssueTypes = new Set([
  "incomplete_regex",
  "incomplete_replacement",
  "incomplete_translate",
]);

const issueDescriptions = {
  incomplete_escape: {
    code: "incomplete-escape",
    message: "Expected a character after `\\`.",
  },
  incomplete_regex: (node) => ({
    code: "unterminated-regular-expression",
    message: expectedClosingDelimiter(node, "the regular expression"),
  }),
  incomplete_replacement: (node) => ({
    code: "unterminated-replacement",
    message: expectedClosingDelimiter(node, "the replacement"),
  }),
  incomplete_translate: (node) => ({
    code: "unterminated-translation",
    message: expectedClosingDelimiter(node, "the translation"),
  }),
  invalid_control_escape: {
    code: "invalid-control-escape",
    message: "The `\\c` escape must be followed by an unescaped character.",
  },
  invalid_backreference: (node) => ({
    code: "invalid-backreference",
    message: `Back-reference \`${node.text}\` has no matching regular expression group.`,
  }),
  invalid_character_range: (node) => ({
    code: "invalid-regular-expression",
    message: `Invalid character range: \`${node.text}\`.`,
  }),
  unclosed_bracket: {
    code: "unclosed-bracket-expression",
    message: "Expected `]` to close this bracket expression.",
  },
  unclosed_regex_group: {
    code: "invalid-regular-expression",
    message: "Expected `\\)` to close this regular expression group.",
  },
  unexpected_regex_group_close: {
    code: "invalid-regular-expression",
    message: "Unexpected `\\)`; no regular expression group is open.",
  },
  invalid_address: (node) => ({
    code: "invalid-address",
    message:
      node.details.address === undefined
        ? `Invalid address syntax: \`${node.details.sourceText}\`.`
        : `Unexpected text after address \`${node.details.address}\`: \`${node.details.unexpectedText}\`.`,
  }),
  invalid_command: (node) => ({
    code: "invalid-command",
    message: `Unknown sed command: \`${node.text}\`.`,
  }),
  invalid_flag: (node) => ({
    code: "invalid-substitution-flag",
    message:
      node.details?.invalidFlags === undefined
        ? `Unknown substitution flag: \`${node.text}\`.`
        : `Unknown substitution flags: ${node.details.invalidFlags
            .map((flag) => `\`${flag}\``)
            .join(", ")}.`,
  }),
  invalid_step_value: {
    code: "invalid-step-value",
    message: "The address step must be greater than zero.",
  },
  invalid_substitution_occurrence: {
    code: "invalid-substitution-occurrence",
    message: "The substitution occurrence must be greater than zero.",
  },
  invalid_zero_address: {
    code: "invalid-address",
    message: "Address `0` is only valid in `0,/RE/`, `0r file`, or `0~N`.",
  },
  mismatched_translation: (node) => ({
    code: "mismatched-translation-length",
    message: `The \`y\` command requires source and destination strings of equal length (${node.details.sourceLength} and ${node.details.destinationLength}).`,
  }),
  missing_address: {
    code: "missing-address",
    message: "Expected an address after `,`.",
  },
  missing_command: (node) => ({
    code: "missing-command",
    message:
      node.details?.after === undefined
        ? "Expected a sed command."
        : `Expected a sed command after ${node.details.after}.`,
  }),
  missing_command_delimiter: (node) => ({
    code: "missing-delimiter",
    message: `Expected a delimiter after \`${node.details.commandName}\`.`,
  }),
  missing_command_separator: {
    code: "missing-command-separator",
    message: "Expected a newline or `;` before `}`.",
  },
  missing_file_argument: (node) => ({
    code: "missing-file-argument",
    message: `The \`${node.details.commandName}\` command requires a file name.`,
  }),
  missing_label_argument: {
    code: "missing-label-argument",
    message: "Expected a label name after `:`.",
  },
  missing_line_offset: {
    code: "missing-line-offset",
    message: "Expected a line offset after `+`.",
  },
  missing_step_value: {
    code: "missing-step-value",
    message: "Expected a step value after `~`.",
  },
  missing_substitution_write_file: {
    code: "missing-file-argument",
    message: "The `w` substitution flag requires a file name.",
  },
  missing_multiline_text_argument: (node) => ({
    code: "missing-text-argument",
    message: `Expected \`\\\` and text after \`${node.details.commandName}\`.`,
  }),
  missing_text_argument: (node) => ({
    code: "missing-text-argument",
    message: `The \`${node.details.commandName}\` command requires a text argument.`,
  }),
  missing_previous_regex: {
    code: "missing-previous-regular-expression",
    message:
      "An empty regular expression requires a previous regular expression.",
  },
  too_many_addresses: (node) => ({
    code: "too-many-addresses",
    message:
      node.details.maximum === 0
        ? `The \`${node.details.commandName}\` command does not accept an address.`
        : `The \`${node.details.commandName}\` command accepts at most one address.`,
  }),
  unclosed_block: {
    code: "unclosed-block",
    message: "Expected `}` to close this block.",
  },
  unexpected_text: (node) => ({
    code: "unexpected-text",
    message:
      node.details?.commandName === undefined
        ? `Unexpected text: \`${node.text}\`.`
        : `Unexpected text after \`${node.details.commandName}\`: \`${node.text}\`.`,
  }),
  unmatched_closing_brace: {
    code: "unmatched-closing-brace",
    message: "Unexpected `}`; no block is open.",
  },
};

function expectedClosingDelimiter(node, subject) {
  const delimiter = node.details?.delimiter;
  return delimiter === undefined
    ? `Expected a delimiter to close ${subject}.`
    : `Expected delimiter ${JSON.stringify(delimiter)} to close ${subject}.`;
}

function descriptionFor(node) {
  const description = issueDescriptions[node.type];
  if (typeof description === "function") {
    return description(node);
  }
  if (description !== undefined) {
    return description;
  }

  if (node.isMissing) {
    return {
      code: "missing-syntax",
      message: `Expected ${node.type.replaceAll("_", " ")}.`,
    };
  }

  return {
    code: "syntax-error",
    message: "Invalid sed syntax.",
  };
}

function issueSpecificity(node) {
  if (node.isError) {
    return 0;
  }
  if (node.isMissing) {
    return 1;
  }
  return 2;
}

function compareIssueRanges(left, right) {
  return left.startIndex - right.startIndex || left.endIndex - right.endIndex;
}

function preferSpecificIssues(nodes) {
  const issuesByRange = new Map();

  for (const node of nodes) {
    const key = `${node.startIndex}:${node.endIndex}`;
    const existing = issuesByRange.get(key);
    if (
      existing === undefined ||
      issueSpecificity(node) > issueSpecificity(existing)
    ) {
      issuesByRange.set(key, node);
    }
  }

  return [...issuesByRange.values()].sort(compareIssueRanges);
}

function collapseInvalidFlags(nodes) {
  const issues = [];
  let group = [];

  function appendGroup() {
    if (group.length === 0) {
      return;
    }
    const first = group[0];
    if (group.length === 1) {
      issues.push(first);
    } else {
      const last = group.at(-1);
      const invalidFlagTexts = group.map((node) => node.text);
      issues.push({
        type: "invalid_flag",
        startIndex: first.startIndex,
        endIndex: last.endIndex,
        text: invalidFlagTexts.join(""),
        details: {
          invalidFlags: invalidFlagTexts,
        },
      });
    }
    group = [];
  }

  for (const node of nodes) {
    const previous = group.at(-1);
    const isSubstitutionFlag =
      node.type === "invalid_flag" && node.parent?.type === "substitute_flags";
    const sameFlagSection =
      previous?.parent?.startIndex === node.parent?.startIndex &&
      previous?.parent?.endIndex === node.parent?.endIndex;
    if (
      isSubstitutionFlag &&
      (previous === undefined ||
        (sameFlagSection && previous.endIndex === node.startIndex))
    ) {
      group.push(node);
      continue;
    }

    appendGroup();
    if (isSubstitutionFlag) {
      group.push(node);
    } else {
      issues.push(node);
    }
  }
  appendGroup();

  return issues;
}

function issueAt(node, type, target = node, details) {
  return {
    type,
    text: node.text,
    isMissing: node.isMissing,
    startIndex: target.startIndex,
    endIndex: target.endIndex,
    details,
  };
}

function issueRange(type, startNode, endNode, text) {
  return {
    type,
    text,
    isMissing: false,
    startIndex: startNode.startIndex,
    endIndex: endNode.endIndex,
  };
}

function issueThrough(node, type, startNode, details) {
  return {
    ...issueAt(node, type, startNode, details),
    endIndex: node.endIndex,
  };
}

function commandNameForError(node) {
  if (!node.isError) {
    return undefined;
  }

  const commandName = firstCommandName(node);
  if (commandName !== undefined) {
    return commandName;
  }

  const lastChild = node.children.at(-1);
  if (
    lastChild?.endIndex === node.endIndex &&
    missingArgumentIssueByCommand[lastChild.text] !== undefined
  ) {
    return lastChild;
  }

  return node.text.length === 1 ? node : undefined;
}

function commandNameText(command) {
  const body = command?.childForFieldName("body");
  return body?.childForFieldName("name")?.text;
}

function missingArgumentIssueFor(commandName, dialect) {
  if (
    dialect === "gnu" &&
    (commandName === "a" || commandName === "c" || commandName === "i")
  ) {
    return "missing_text_argument";
  }
  return missingArgumentIssueByCommand[commandName];
}

function enclosingCommand(node) {
  let current = node.parent;
  while (current !== null && current !== undefined) {
    if (current.type === "command") {
      return current;
    }
    current = current.parent;
  }
  return undefined;
}

function previousCommand(node) {
  let current = node;
  while (current.parent !== null && current.parent !== undefined) {
    const previous = current.previousNamedSibling;
    if (previous?.type === "command") {
      return previous;
    }
    if (previous?.type === "command_list") {
      return previous.descendantsOfType("command").at(-1);
    }
    current = current.parent;
  }
  return undefined;
}

function nextUnexpectedText(node) {
  let current = node;
  while (current.parent !== null && current.parent !== undefined) {
    const next = current.nextNamedSibling;
    if (next?.type === "unexpected_text") {
      return next;
    }
    current = current.parent;
  }
  return undefined;
}

function precedingDelimiter(node) {
  let current = node.parent;
  while (current !== null && current !== undefined) {
    const delimiter = current.children.findLast(
      (child) =>
        child.type === "delimiter" &&
        child.startIndex < child.endIndex &&
        child.endIndex <= node.startIndex,
    );
    if (delimiter !== undefined) {
      return delimiter;
    }
    current = current.parent;
  }
  return undefined;
}

function enclosingError(node) {
  let current = node.parent;
  while (current !== null && current !== undefined) {
    if (current.isError) {
      return current;
    }
    current = current.parent;
  }
  return undefined;
}

function firstCommandName(node) {
  return node.children.find((child) => child.type === "command_name");
}

function enclosingOpeningBrace(node) {
  let current = node.parent;
  while (current !== null && current !== undefined) {
    if (current.isError) {
      const openingBrace = firstCommandName(current);
      if (openingBrace?.text === "{") {
        return openingBrace;
      }
    }
    current = current.parent;
  }
  return undefined;
}

function contextualizeUnexpectedText(node, dialect) {
  const address = node.previousNamedSibling;
  if (address?.type === "occurrence_flag") {
    const periodicSuffix = node.text.match(/^~[0-9]+/)?.[0];
    if (periodicSuffix !== undefined) {
      return {
        type: "invalid_address",
        text: `${address.text}${periodicSuffix}`,
        isMissing: false,
        startIndex: address.startIndex,
        endIndex: address.endIndex + periodicSuffix.length,
        details: {
          sourceText: `${address.text}${periodicSuffix}`,
        },
      };
    }
    return issueAt(node, "invalid_address", address, {
      sourceText: address.text,
    });
  }

  if (node.text === "}") {
    const openingBrace = enclosingOpeningBrace(node);
    return issueAt(
      node,
      openingBrace === undefined
        ? "unmatched_closing_brace"
        : "missing_command_separator",
    );
  }

  const recoveryCommandName = firstCommandName(enclosingError(node) ?? node);
  if (
    dialect === "posix" &&
    (recoveryCommandName?.text === "a" ||
      recoveryCommandName?.text === "c" ||
      recoveryCommandName?.text === "i")
  ) {
    return issueAt(
      node,
      "missing_multiline_text_argument",
      recoveryCommandName,
      { commandName: recoveryCommandName.text },
    );
  }

  const enclosingCommandName = commandNameText(enclosingCommand(node));
  if (enclosingCommandName !== undefined) {
    return issueAt(node, "unexpected_text", node, {
      commandName: enclosingCommandName,
    });
  }

  const commandName = commandNameText(previousCommand(node));
  if (commandName !== undefined) {
    return issueAt(node, "unexpected_text", node, {
      commandName,
    });
  }

  return node;
}

function isSubstitutionWriteFlag(node, commandName) {
  if (commandName?.text !== "w") {
    return false;
  }

  const previous = previousCommand(node);
  return (
    previous?.type === "command" &&
    previous.childForFieldName("body")?.type === "substitute_command"
  );
}

function contextualizeIssue(node, dialect) {
  if (unterminatedIssueTypes.has(node.type)) {
    const delimiter = precedingDelimiter(node);
    return issueThrough(
      node,
      node.type,
      delimiter ?? node.previousNamedSibling ?? node,
      { delimiter: delimiter?.text },
    );
  }

  if (node.type === "}" && node.isMissing) {
    const openingBrace = node.parent?.childForFieldName("name");
    return issueAt(node, "unclosed_block", openingBrace ?? node);
  }

  const missingValueIssue = missingValueIssueByNodeType[node.type];
  if (missingValueIssue !== undefined) {
    const operator = node.previousNamedSibling;
    return issueAt(node, missingValueIssue, operator ?? node);
  }
  if (node.type === "file_argument" && node.hasError) {
    const command = enclosingCommand(node);
    const commandName = commandNameText(command);
    const commandBody = command?.childForFieldName("body");
    return issueAt(
      node,
      commandBody?.type === "substitute_command"
        ? "missing_substitution_write_file"
        : "missing_file_argument",
      commandBody?.childForFieldName("name") ?? node,
      { commandName },
    );
  }
  if (node.type === "label_definition" && node.hasError) {
    const commandName = enclosingCommand(node)
      ?.childForFieldName("body")
      ?.childForFieldName("name");
    return issueAt(node, "missing_label_argument", commandName ?? node);
  }
  if (node.type === "text_argument" && node.hasError) {
    const commandName = node.parent?.childForFieldName("name");
    return issueAt(node, "missing_text_argument", commandName ?? node, {
      commandName: commandName?.text,
    });
  }
  if (node.type === "command_name" && node.isMissing) {
    const previous = previousConcreteNode(node);
    if (previous?.type === "negation") {
      return issueAt(node, "missing_command", previous, { after: "`!`" });
    }
    const unexpectedText = nextUnexpectedText(node);
    if (previous?.type === "address" && unexpectedText !== undefined) {
      return issueAt(node, "invalid_address", unexpectedText, {
        address: previous.text,
        unexpectedText: unexpectedText.text,
      });
    }
    return issueAt(node, "missing_command", previous ?? node);
  }
  if (node.type === "unexpected_text") {
    return contextualizeUnexpectedText(node, dialect);
  }

  if (node.isError) {
    const parsedPrefix = node.children[0];
    if (parsedPrefix?.type === "occurrence_flag") {
      return issueAt(node, "invalid_address", parsedPrefix, {
        sourceText: parsedPrefix.text,
      });
    }
  }

  const commandName = commandNameForError(node);
  if (commandName?.text === "{") {
    return issueAt(node, "unclosed_block", commandName);
  }
  if (isSubstitutionWriteFlag(node, commandName)) {
    return issueAt(node, "missing_substitution_write_file", commandName);
  }

  const missingArgumentIssue = missingArgumentIssueFor(
    commandName?.text,
    dialect,
  );
  if (missingArgumentIssue !== undefined) {
    return issueAt(node, missingArgumentIssue, commandName, {
      commandName: commandName.text,
    });
  }

  if (node.isError) {
    const negation = node.children.findLast(
      (child) => child.type === "negation",
    );
    if (negation !== undefined) {
      return issueAt(node, "missing_command", negation, { after: "`!`" });
    }
    const addressOperator = node.children.find(
      (child) => child.type === "address_operator",
    );
    const missingValueIssue =
      missingValueIssueByOperator[addressOperator?.text];
    if (missingValueIssue !== undefined) {
      const next = nextConcreteNode(node);
      if (
        addressOperator.text === "~" &&
        next?.startIndex === node.endIndex &&
        /^0+$/.test(next.text)
      ) {
        return issueAt(node, "invalid_step_value", next);
      }
      const target =
        next?.startIndex === node.endIndex &&
        (next.text === "," || next.text === "+" || next.text === "~")
          ? next
          : addressOperator;
      return issueAt(node, missingValueIssue, target);
    }
    const parsedPrefix = node.children[0];
    if (
      parsedPrefix?.type === "address" ||
      parsedPrefix?.type === "address_range" ||
      parsedPrefix?.type.endsWith("_address")
    ) {
      return issueAt(node, "missing_command", parsedPrefix, {
        after: `address \`${parsedPrefix.text}\``,
      });
    }
  }

  return node;
}

function isRecoveryTextAfterInvalidCommand(node) {
  return (
    node.type === "unexpected_text" &&
    node.parent?.type === "command" &&
    node.parent.children.some((child) => child.type === "invalid_command")
  );
}

function recoveryContainer(node) {
  let current = node.parent;
  while (current !== null && current !== undefined) {
    if (current.type === "command" || current.isError) {
      return current;
    }
    current = current.parent;
  }
  return undefined;
}

function isDerivedIncompleteIssue(node, nodes) {
  if (
    !unterminatedIssueTypes.has(node.type) &&
    !(node.isMissing && node.type === "delimiter")
  ) {
    return false;
  }
  const container = recoveryContainer(node);
  return nodes.some(
    (candidate) =>
      (candidate.type === "incomplete_escape" ||
        candidate.type === "invalid_control_escape" ||
        candidate.type === "unclosed_bracket") &&
      sameRange(recoveryContainer(candidate), container),
  );
}

function suppressDerivedIssues(nodes, source) {
  const issues = [];
  let textRecoveryEnd = -1;

  for (const node of nodes) {
    if (node.startIndex <= textRecoveryEnd) {
      continue;
    }

    const previous = issues.at(-1);
    if (
      node.type === "invalid_command" &&
      previous?.type === "missing_address" &&
      (node.startIndex === previous.endIndex ||
        (node.startIndex === previous.startIndex &&
          node.endIndex === previous.endIndex))
    ) {
      continue;
    }
    if (
      node.type === "unexpected_text" &&
      previous?.type === "invalid_address" &&
      node.startIndex === previous.startIndex &&
      node.endIndex === previous.endIndex
    ) {
      continue;
    }
    if (
      node.type === previous?.type &&
      node.startIndex === previous.startIndex &&
      node.endIndex === previous.endIndex
    ) {
      continue;
    }

    issues.push(node);
    if (node.type === "missing_multiline_text_argument") {
      const newline = source.indexOf("\n", node.endIndex);
      textRecoveryEnd = newline === -1 ? source.length : newline;
    }
  }

  return issues;
}

function previousConcreteNode(node) {
  let current = node;
  while (current.parent !== null && current.parent !== undefined) {
    let sibling = current.previousNamedSibling;
    while (sibling !== null && sibling !== undefined) {
      if (sibling.startIndex < sibling.endIndex) {
        return sibling;
      }
      sibling = sibling.previousNamedSibling;
    }
    current = current.parent;
  }
  return undefined;
}

function nextConcreteNode(node) {
  let current = node;
  while (current.parent !== null && current.parent !== undefined) {
    const sibling = current.nextNamedSibling;
    if (sibling !== null && sibling !== undefined) {
      let candidate = sibling;
      while (candidate.namedChildCount > 0) {
        const child = candidate.namedChildren.find(
          (namedChild) => namedChild.startIndex < namedChild.endIndex,
        );
        if (child === undefined) {
          break;
        }
        candidate = child;
      }
      return candidate;
    }
    current = current.parent;
  }
  return undefined;
}

function expandEmptyIssueRange(node) {
  if (node.startIndex !== node.endIndex) {
    return node;
  }

  let startNode;
  if (node.type === "unclosed_bracket") {
    startNode = node.parent;
  } else if (node.type.startsWith("incomplete_")) {
    startNode = node.previousNamedSibling;
  } else {
    startNode = previousConcreteNode(node);
  }
  if (startNode === null || startNode === undefined) {
    return node;
  }

  return {
    type: node.type,
    text: node.text,
    isMissing: node.isMissing,
    startIndex: startNode.startIndex,
    endIndex: node.endIndex,
    details: node.details,
  };
}

function normalizeIssues(nodes, dialect, source) {
  const primaryNodes = nodes.filter(
    (node) =>
      !isRecoveryTextAfterInvalidCommand(node) &&
      !isDerivedIncompleteIssue(node, nodes),
  );
  const contextualized = collapseInvalidFlags(
    preferSpecificIssues(primaryNodes),
  )
    .map((node) => contextualizeIssue(node, dialect))
    .sort(compareIssueRanges);

  return suppressDerivedIssues(contextualized, source).map(
    expandEmptyIssueRange,
  );
}

function sameRange(left, right) {
  return (
    left !== null &&
    left !== undefined &&
    right !== null &&
    right !== undefined &&
    left.startIndex === right.startIndex &&
    left.endIndex === right.endIndex
  );
}

function collectDiagnosticNodes(rootNode) {
  const nodesByType = Object.fromEntries(
    diagnosticNodeTypes.map((type) => [type, []]),
  );
  for (const node of rootNode.descendantsOfType(diagnosticNodeTypes)) {
    nodesByType[node.type].push(node);
  }
  return nodesByType;
}

function isValidGnuZeroAddress(zero, addresses, commandName) {
  const periodicAddress = zero.parent;
  if (
    periodicAddress?.type === "periodic_address" &&
    sameRange(periodicAddress.childForFieldName("start"), zero)
  ) {
    return true;
  }

  const address =
    zero.parent?.type === "address"
      ? zero.parent
      : zero.parent?.parent?.type === "address"
        ? zero.parent.parent
        : undefined;
  const range = address?.parent;
  if (
    range?.type === "address_range" &&
    sameRange(range.childForFieldName("start"), address) &&
    range.childForFieldName("end")?.descendantsOfType("regex_address").length >
      0
  ) {
    return true;
  }

  return (
    commandName === "r" &&
    addresses.type === "address" &&
    addresses.descendantsOfType("line_number_address").length === 1
  );
}

function addressIssueNodes(commands, source, dialect) {
  const issues = [];

  for (const command of commands) {
    if (command.hasError) {
      continue;
    }

    const addresses = command.childForFieldName("addresses");
    if (addresses === null) {
      continue;
    }

    const commandName = commandNameText(command);
    const maximum = maximumAddressesByDialect[dialect][commandName] ?? 2;
    const addressCount = addresses.type === "address_range" ? 2 : 1;
    if (addressCount > maximum) {
      const target =
        maximum === 0
          ? addresses
          : (addresses.childForFieldName("end") ?? addresses);
      issues.push(
        issueAt(target, "too_many_addresses", target, {
          commandName,
          maximum,
        }),
      );
    }

    if (dialect !== "gnu") {
      continue;
    }

    for (const zero of addresses.descendantsOfType("line_number_address")) {
      if (!/^0+$/.test(zero.text)) {
        continue;
      }
      if (zero.startIndex > 0 && source[zero.startIndex - 1] === "~") {
        continue;
      }
      if (isValidGnuZeroAddress(zero, addresses, commandName)) {
        continue;
      }
      issues.push(issueAt(zero, "invalid_zero_address"));
    }
  }

  return issues;
}

function singleAsciiCharacter(text) {
  const characters = [...text];
  if (characters.length !== 1 || characters[0].codePointAt(0) > 0x7f) {
    return undefined;
  }
  return characters[0];
}

function bracketRangeIssueNodes(regex) {
  const issues = [];

  for (const bracket of regex.descendantsOfType("bracket_expression")) {
    const parts = bracket.namedChildren;
    for (let index = 1; index < parts.length - 1; index += 1) {
      const hyphen = parts[index];
      const start = parts[index - 1];
      const end = parts[index + 1];
      if (
        hyphen.type !== "regex_literal" ||
        hyphen.text !== "-" ||
        start.type !== "regex_literal" ||
        end.type !== "regex_literal"
      ) {
        continue;
      }

      const startCharacter = singleAsciiCharacter(start.text);
      const endCharacter = singleAsciiCharacter(end.text);
      if (
        startCharacter !== undefined &&
        endCharacter !== undefined &&
        startCharacter.codePointAt(0) > endCharacter.codePointAt(0)
      ) {
        issues.push(
          issueRange(
            "invalid_character_range",
            start,
            end,
            `${start.text}-${end.text}`,
          ),
        );
      }
    }
  }

  return issues;
}

function regexAnalysis(regex) {
  const issues = [];
  const openGroups = [];
  const closedGroups = new Set();
  let groupCount = 0;
  const tokens = regex
    .descendantsOfType(["escaped_parenthesis", "backreference_candidate"])
    .sort(compareIssueRanges);

  for (const token of tokens) {
    if (token.type === "escaped_parenthesis") {
      if (token.text === "\\(") {
        groupCount += 1;
        openGroups.push({ node: token, number: groupCount });
      } else if (token.text === "\\)") {
        const group = openGroups.pop();
        if (group === undefined) {
          issues.push(issueAt(token, "unexpected_regex_group_close"));
        } else {
          closedGroups.add(group.number);
        }
      }
      continue;
    }

    const groupNumber = Number.parseInt(token.text.slice(1), 10);
    if (!closedGroups.has(groupNumber)) {
      issues.push(issueAt(token, "invalid_backreference"));
    }
  }

  for (const { node } of openGroups) {
    issues.push(issueAt(node, "unclosed_regex_group"));
  }
  issues.push(...bracketRangeIssueNodes(regex));

  return { groupCount, issues };
}

function regexIssueNodes(containers) {
  const issues = [];
  let previousGroupCount;

  for (const container of containers) {
    if (container.hasError) {
      continue;
    }

    const pattern = container.childForFieldName("pattern");
    let groupCount = previousGroupCount;
    if (pattern === null) {
      if (previousGroupCount === undefined) {
        const opening = container.childForFieldName("opening_delimiter");
        const closing =
          container.type === "substitute_argument"
            ? container.childForFieldName("middle_delimiter")
            : container.childForFieldName("closing_delimiter");
        if (opening !== null && closing !== null) {
          issues.push(
            issueRange("missing_previous_regex", opening, closing, ""),
          );
        }
      }
    } else {
      const analysis = regexAnalysis(pattern);
      issues.push(...analysis.issues);
      groupCount = analysis.groupCount;
      previousGroupCount = groupCount;
    }

    if (container.type !== "substitute_argument") {
      continue;
    }
    const replacement = container.childForFieldName("replacement");
    if (replacement === null || groupCount === undefined) {
      continue;
    }

    for (const backreference of replacement.descendantsOfType(
      "backreference",
    )) {
      if (Number.parseInt(backreference.text.slice(1), 10) > groupCount) {
        issues.push(issueAt(backreference, "invalid_backreference"));
      }
    }
  }

  return issues;
}

function decodedCharacterLength(text) {
  const characters = [...text];
  let length = 0;

  for (let index = 0; index < characters.length; index += 1) {
    if (characters[index] === "\\" && index + 1 < characters.length) {
      index += 1;
      if (characters[index] === "\r" && characters[index + 1] === "\n") {
        index += 1;
      }
    }
    length += 1;
  }

  return length;
}

function translationIssueNodes(arguments_) {
  const issues = [];

  for (const argument of arguments_) {
    if (argument.hasError) {
      continue;
    }
    const source = argument.childForFieldName("source");
    const destination = argument.childForFieldName("destination");
    if (source === null || destination === null) {
      continue;
    }

    const sourceLength = decodedCharacterLength(source.text);
    const destinationLength = decodedCharacterLength(destination.text);
    if (sourceLength !== destinationLength) {
      issues.push(
        issueAt(argument, "mismatched_translation", argument, {
          sourceLength,
          destinationLength,
        }),
      );
    }
  }

  return issues;
}

function numericValueIssueNodes(steps, occurrences) {
  const issues = [];

  for (const step of steps) {
    if (/^0+$/.test(step.text)) {
      issues.push(issueAt(step, "invalid_step_value"));
    }
  }
  for (const occurrence of occurrences) {
    if (
      occurrence.parent?.type === "substitute_flags" &&
      /^0+$/.test(occurrence.text)
    ) {
      issues.push(issueAt(occurrence, "invalid_substitution_occurrence"));
    }
  }

  return issues;
}

function semanticIssueNodes(nodesByType, source, dialect) {
  const regexContainers = [
    ...nodesByType.regex_address,
    ...nodesByType.substitute_argument,
  ].sort(compareIssueRanges);

  return [
    ...addressIssueNodes(nodesByType.command, source, dialect),
    ...regexIssueNodes(regexContainers),
    ...translationIssueNodes(nodesByType.translate_argument),
    ...numericValueIssueNodes(
      nodesByType.step_value,
      nodesByType.occurrence_flag,
    ),
  ];
}

function diagnostic(document, node, { code, message }) {
  return {
    severity: DiagnosticSeverity.Error,
    range: rangeForNode(document, node),
    message,
    code,
    source: diagnosticSource,
  };
}

function issueDiagnostic(document, node) {
  return diagnostic(document, node, descriptionFor(node));
}

function compareDiagnostics(left, right) {
  return (
    left.range.start.line - right.range.start.line ||
    left.range.start.character - right.range.start.character ||
    left.range.end.line - right.range.end.line ||
    left.range.end.character - right.range.end.character ||
    String(left.code).localeCompare(String(right.code))
  );
}

function labelDiagnostics(document, definitions, references) {
  const definedLabels = new Set();
  const issues = [];

  for (const definition of definitions) {
    if (definition.hasError || definition.text === "") {
      continue;
    }
    if (definedLabels.has(definition.text)) {
      issues.push({
        node: definition,
        code: "duplicate-label",
        message: `Duplicate sed label: \`${definition.text}\`.`,
      });
    } else {
      definedLabels.add(definition.text);
    }
  }

  for (const reference of references) {
    if (reference.hasError || reference.text === "") {
      continue;
    }
    if (!definedLabels.has(reference.text)) {
      issues.push({
        node: reference,
        code: "undefined-label",
        message: `Undefined sed label: \`${reference.text}\`.`,
      });
    }
  }

  return issues.map(({ node, code, message }) =>
    diagnostic(document, node, { code, message }),
  );
}

export function createDiagnostics(document, dialect) {
  const rootNode = syntaxTreeFor(document, dialect).rootNode;
  const source = document.getText();
  const nodesByType = collectDiagnosticNodes(rootNode);
  const syntaxIssues = normalizeIssues(
    collectSyntaxIssueNodes(rootNode),
    dialect,
    source,
  );
  const semanticIssues = semanticIssueNodes(nodesByType, source, dialect);

  return [
    ...syntaxIssues.map((node) => issueDiagnostic(document, node)),
    ...semanticIssues.map((node) => issueDiagnostic(document, node)),
    ...labelDiagnostics(
      document,
      nodesByType.label_definition,
      nodesByType.label_reference,
    ),
  ].sort(compareDiagnostics);
}

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
    "#": 0,
    ":": 0,
    "=": 1,
    a: 1,
    i: 1,
    q: 1,
    r: 1,
  },
  gnu: {
    "#": 0,
    ":": 0,
    Q: 1,
    q: 1,
  },
};
const diagnosticNodeTypes = [
  "command",
  "escaped_regex_address",
  "label_definition",
  "label_reference",
  "occurrence_flag",
  "regex_address",
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
  invalid_empty_regex_modifier: (node) => ({
    code: "invalid-regular-expression",
    message: `Modifier \`${node.text}\` cannot be used with an empty regular expression.`,
  }),
  invalid_posix_character_class: (node) => ({
    code: "invalid-regular-expression",
    message: `Unknown POSIX character class: \`${node.text}\`.`,
  }),
  invalid_regex_interval: (node) => ({
    code: "invalid-regular-expression",
    message: `Invalid regular expression interval: \`${node.text}\`.`,
  }),
  invalid_regex_quantifier: (node) => ({
    code: "invalid-regular-expression",
    message: `Regular expression operator \`${node.text}\` has no preceding expression.`,
  }),
  unsupported_pattern_backreference: {
    code: "unsupported-pattern-backreference",
    message: "Pattern back-references are not supported.",
  },
  unclosed_bracket: {
    code: "unclosed-bracket-expression",
    message: "Expected `]` to close this bracket expression.",
  },
  unclosed_regex_group: (node) => ({
    code: "invalid-regular-expression",
    message: `Expected \`${node.details.closingText}\` to close this regular expression group.`,
  }),
  unexpected_regex_group_close: (node) => ({
    code: "invalid-regular-expression",
    message: `Unexpected \`${node.text}\`; no regular expression group is open.`,
  }),
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
  duplicate_substitution_flag: (node) => ({
    code: "invalid-substitution-flag",
    message:
      node.details.kind === "occurrence"
        ? "A substitution occurrence may only be specified once."
        : `The \`${node.text}\` substitution flag may only be specified once.`,
  }),
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
  for (let index = 0; index < node.childCount; index += 1) {
    const child = node.child(index);
    if (child?.type === "command_name") {
      return child;
    }
  }
  return undefined;
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
    const parsedPrefix = node.children[0];
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
        if (
          dialect === "gnu" &&
          parsedPrefix?.type === "line_number_address" &&
          /^0+$/.test(parsedPrefix.text)
        ) {
          return issueAt(parsedPrefix, "invalid_zero_address");
        }
        return issueAt(node, "invalid_step_value", next);
      }
      const target =
        next?.startIndex === node.endIndex &&
        (next.text === "," || next.text === "+" || next.text === "~")
          ? next
          : addressOperator;
      return issueAt(node, missingValueIssue, target);
    }
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

function recoveryContainerKey(node) {
  const container = recoveryContainer(node);
  return container === undefined
    ? undefined
    : `${container.startIndex}:${container.endIndex}`;
}

function incompleteRecoveryContainerKeys(nodes) {
  const keys = new Set();

  for (const node of nodes) {
    if (
      node.type !== "incomplete_escape" &&
      node.type !== "invalid_control_escape" &&
      node.type !== "unclosed_bracket"
    ) {
      continue;
    }
    const key = recoveryContainerKey(node);
    if (key !== undefined) {
      keys.add(key);
    }
  }

  return keys;
}

function isDerivedIncompleteIssue(node, recoveryContainerKeys) {
  if (
    !unterminatedIssueTypes.has(node.type) &&
    !(node.isMissing && node.type === "delimiter")
  ) {
    return false;
  }
  const key = recoveryContainerKey(node);
  return key !== undefined && recoveryContainerKeys.has(key);
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
  const recoveryContainerKeys = incompleteRecoveryContainerKeys(nodes);
  const primaryNodes = nodes.filter(
    (node) =>
      !isRecoveryTextAfterInvalidCommand(node) &&
      !isDerivedIncompleteIssue(node, recoveryContainerKeys),
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
    range
      .childForFieldName("end")
      ?.descendantsOfType(["regex_address", "escaped_regex_address"]).length > 0
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

const posixCharacterClasses = new Set([
  "alnum",
  "alpha",
  "blank",
  "cntrl",
  "digit",
  "graph",
  "lower",
  "print",
  "punct",
  "space",
  "upper",
  "xdigit",
]);
const gnuNumericEscapeFormats = {
  d: {
    base: 10,
    digitPattern: /^[0-9]$/,
    maximumDigits: 3,
  },
  o: {
    base: 8,
    digitPattern: /^[0-7]$/,
    maximumDigits: 3,
  },
  x: {
    base: 16,
    digitPattern: /^[0-9a-fA-F]$/,
    maximumDigits: 2,
  },
};

function appendRegexUnits(units, text, startIndex) {
  let offset = startIndex;

  for (const value of text) {
    units.push({
      value,
      startIndex: offset,
      endIndex: offset + value.length,
    });
    offset += value.length;
  }
}

function decodedGnuRegexEscape(node) {
  const kind = node.text[1];
  const valueText = node.text.slice(2);
  const numericFormat = gnuNumericEscapeFormats[kind];

  if (numericFormat !== undefined) {
    const digits = valueText.replaceAll("\\", "");
    return String.fromCodePoint(Number.parseInt(digits, numericFormat.base));
  }
  if (kind === "c") {
    const codePoint = valueText.codePointAt(0);
    const upperCodePoint =
      codePoint >= 0x61 && codePoint <= 0x7a ? codePoint - 0x20 : codePoint;
    return String.fromCodePoint(upperCodePoint ^ 0x40);
  }

  return (
    {
      a: "\u0007",
      f: "\f",
      n: "\n",
      r: "\r",
      t: "\t",
      v: "\v",
    }[kind] ?? valueText
  );
}

function semanticRegexUnits(regex, syntax) {
  const units = [];
  const transformedNodeTypes = ["escaped_delimiter"];
  if (syntax.dialect === "gnu") {
    transformedNodeTypes.push("gnu_character_escape", "gnu_control_escape");
  }
  if (syntax.regex === "ere") {
    transformedNodeTypes.push("regex_group_open", "regex_group_close");
  }
  const transformedNodes = regex
    .descendantsOfType(transformedNodeTypes)
    .filter(
      (node) =>
        node.type === "escaped_delimiter" ||
        node.type.startsWith("gnu_") ||
        node.text.startsWith("\\"),
    )
    .sort(compareIssueRanges);
  let cursor = regex.startIndex;

  for (const node of transformedNodes) {
    if (node.startIndex < cursor) {
      continue;
    }
    appendRegexUnits(
      units,
      regex.text.slice(
        cursor - regex.startIndex,
        node.startIndex - regex.startIndex,
      ),
      cursor,
    );
    if (
      node.type === "escaped_delimiter" ||
      node.type === "regex_group_open" ||
      node.type === "regex_group_close"
    ) {
      appendRegexUnits(units, node.text.slice(1), node.startIndex);
      units.at(-1).endIndex = node.endIndex;
    } else {
      appendRegexUnits(units, decodedGnuRegexEscape(node), node.startIndex);
      units.at(-1).endIndex = node.endIndex;
    }
    cursor = node.endIndex;
  }

  appendRegexUnits(units, regex.text.slice(cursor - regex.startIndex), cursor);
  return units;
}

function issueForRegexUnits(
  regex,
  units,
  type,
  startUnitIndex,
  endUnitIndex,
  details,
) {
  const start = units[startUnitIndex];
  const end = units[endUnitIndex];
  return {
    type,
    text: regex.text.slice(
      start.startIndex - regex.startIndex,
      end.endIndex - regex.startIndex,
    ),
    isMissing: false,
    startIndex: start.startIndex,
    endIndex: end.endIndex,
    details,
  };
}

function posixClassEnd(units, startIndex) {
  if (
    units[startIndex]?.value !== "[" ||
    units[startIndex + 1]?.value !== ":"
  ) {
    return undefined;
  }

  for (let index = startIndex + 2; index + 1 < units.length; index += 1) {
    if (units[index].value === ":" && units[index + 1].value === "]") {
      return index + 1;
    }
    if (!/^[a-zA-Z0-9_]$/.test(units[index].value)) {
      return undefined;
    }
  }
  return undefined;
}

function bracketAnalysis(regex, units, startIndex, syntax) {
  const issues = [];
  let index = startIndex + 1;

  if (units[index]?.value === "^") {
    index += 1;
  }
  if (units[index]?.value === "]") {
    index += 1;
  }

  while (index < units.length) {
    const classEnd = posixClassEnd(units, index);
    if (classEnd !== undefined) {
      const className = units
        .slice(index + 2, classEnd - 1)
        .map((unit) => unit.value)
        .join("");
      if (!posixCharacterClasses.has(className)) {
        issues.push(
          issueForRegexUnits(
            regex,
            units,
            "invalid_posix_character_class",
            index,
            classEnd,
          ),
        );
      }
      index = classEnd + 1;
      continue;
    }

    if (
      syntax.dialect === "gnu" &&
      units[index].value === "\\" &&
      index + 1 < units.length
    ) {
      index += 2;
      continue;
    }
    if (units[index].value === "]") {
      return { issues, endIndex: index };
    }
    index += 1;
  }

  issues.push(
    issueForRegexUnits(
      regex,
      units,
      "unclosed_bracket",
      startIndex,
      units.length - 1,
    ),
  );
  return { issues, endIndex: units.length - 1 };
}

function intervalAt(units, startIndex, syntax) {
  const isBre = syntax.regex === "bre";
  if (isBre) {
    if (
      units[startIndex]?.value !== "\\" ||
      units[startIndex + 1]?.value !== "{"
    ) {
      return undefined;
    }
  } else if (units[startIndex]?.value !== "{") {
    return undefined;
  }

  const contentStart = startIndex + (isBre ? 2 : 1);
  if (!/^[0-9]$/.test(units[contentStart]?.value ?? "")) {
    return isBre
      ? {
          endIndex: startIndex + 1,
          valid: false,
        }
      : undefined;
  }
  let contentEnd;
  let endIndex;
  for (let index = contentStart; index < units.length; index += 1) {
    if (
      isBre &&
      units[index].value === "\\" &&
      units[index + 1]?.value === "}"
    ) {
      contentEnd = index;
      endIndex = index + 1;
      break;
    }
    if (!isBre && units[index].value === "}") {
      contentEnd = index;
      endIndex = index;
      break;
    }
  }

  if (endIndex === undefined) {
    return {
      endIndex: units.length - 1,
      valid: false,
    };
  }

  const content = units
    .slice(contentStart, contentEnd)
    .map((unit) => unit.value)
    .join("");
  const match = /^([0-9]+)(?:,([0-9]*))?$/.exec(content);
  if (match === null) {
    return { endIndex, valid: false };
  }

  const lower = Number.parseInt(match[1], 10);
  const upper =
    match[2] === undefined || match[2] === ""
      ? undefined
      : Number.parseInt(match[2], 10);
  const maximum = syntax.dialect === "gnu" ? 32767 : 255;
  return {
    endIndex,
    valid:
      lower <= maximum &&
      (upper === undefined || (upper <= maximum && lower <= upper)),
  };
}

function isBreBranchEnd(units, index, dialect) {
  if (index >= units.length) {
    return true;
  }
  return (
    units[index].value === "\\" &&
    (units[index + 1]?.value === ")" ||
      (dialect === "gnu" && units[index + 1]?.value === "|"))
  );
}

function regexAnalysis(regex, syntax) {
  const issues = [];
  const openGroups = [];
  const closedGroups = new Set();
  const units = semanticRegexUnits(regex, syntax);
  let groupCount = 0;
  let canRepeat = false;
  let atBranchStart = true;
  let index = 0;

  while (index < units.length) {
    const unit = units[index];
    if (unit.value === "[") {
      const analysis = bracketAnalysis(regex, units, index, syntax);
      issues.push(...analysis.issues);
      canRepeat = true;
      atBranchStart = false;
      index = analysis.endIndex + 1;
      continue;
    }

    const interval = intervalAt(units, index, syntax);
    if (interval !== undefined) {
      if (!interval.valid) {
        issues.push(
          issueForRegexUnits(
            regex,
            units,
            "invalid_regex_interval",
            index,
            interval.endIndex,
          ),
        );
      } else if (!canRepeat) {
        issues.push(
          issueForRegexUnits(
            regex,
            units,
            "invalid_regex_quantifier",
            index,
            interval.endIndex,
          ),
        );
      }
      canRepeat = syntax.dialect === "gnu" && canRepeat;
      atBranchStart = false;
      index = interval.endIndex + 1;
      continue;
    }

    const escaped = unit.value === "\\" && index + 1 < units.length;
    const nextValue = units[index + 1]?.value;
    if (unit.value === "\\" && !escaped) {
      issues.push(
        issueForRegexUnits(regex, units, "incomplete_escape", index, index),
      );
      canRepeat = false;
      atBranchStart = false;
      index += 1;
      continue;
    }
    const groupOpen =
      (syntax.regex === "bre" && escaped && nextValue === "(") ||
      (syntax.regex === "ere" && unit.value === "(");
    if (groupOpen) {
      groupCount += 1;
      openGroups.push({
        startIndex: index,
        endIndex: index + (syntax.regex === "bre" ? 1 : 0),
        number: groupCount,
      });
      canRepeat = false;
      atBranchStart = true;
      index += syntax.regex === "bre" ? 2 : 1;
      continue;
    }

    const groupClose =
      (syntax.regex === "bre" && escaped && nextValue === ")") ||
      (syntax.regex === "ere" && unit.value === ")");
    if (groupClose) {
      const group = openGroups.pop();
      if (group === undefined) {
        if (syntax.regex === "bre" || syntax.dialect === "gnu") {
          issues.push(
            issueForRegexUnits(
              regex,
              units,
              "unexpected_regex_group_close",
              index,
              index + (syntax.regex === "bre" ? 1 : 0),
            ),
          );
        }
        canRepeat = syntax.regex === "ere" && syntax.dialect === "posix";
      } else {
        closedGroups.add(group.number);
        canRepeat = true;
      }
      atBranchStart = false;
      index += syntax.regex === "bre" ? 2 : 1;
      continue;
    }

    if (escaped && /^[1-9]$/.test(nextValue)) {
      if (syntax.dialect === "posix" && syntax.regex === "ere") {
        issues.push(
          issueForRegexUnits(
            regex,
            units,
            "unsupported_pattern_backreference",
            index,
            index + 1,
          ),
        );
      } else {
        const groupNumber = Number.parseInt(nextValue, 10);
        if (!closedGroups.has(groupNumber)) {
          issues.push(
            issueForRegexUnits(
              regex,
              units,
              "invalid_backreference",
              index,
              index + 1,
            ),
          );
        }
      }
      canRepeat = true;
      atBranchStart = false;
      index += 2;
      continue;
    }

    const alternation =
      (syntax.regex === "ere" && unit.value === "|") ||
      (syntax.regex === "bre" &&
        syntax.dialect === "gnu" &&
        escaped &&
        nextValue === "|");
    if (alternation) {
      canRepeat = false;
      atBranchStart = true;
      index += syntax.regex === "bre" ? 2 : 1;
      continue;
    }

    const quantifierEnd =
      unit.value === "*" ||
      (syntax.regex === "ere" && (unit.value === "+" || unit.value === "?"))
        ? index
        : syntax.regex === "bre" &&
            syntax.dialect === "gnu" &&
            escaped &&
            (nextValue === "+" || nextValue === "?")
          ? index + 1
          : undefined;
    if (quantifierEnd !== undefined) {
      if (
        syntax.dialect === "posix" &&
        syntax.regex === "bre" &&
        unit.value === "*" &&
        !canRepeat &&
        atBranchStart
      ) {
        canRepeat = true;
        atBranchStart = false;
        index = quantifierEnd + 1;
        continue;
      }
      if (!canRepeat) {
        issues.push(
          issueForRegexUnits(
            regex,
            units,
            "invalid_regex_quantifier",
            index,
            quantifierEnd,
          ),
        );
      }
      canRepeat = syntax.dialect === "gnu" && canRepeat;
      atBranchStart = false;
      index = quantifierEnd + 1;
      continue;
    }

    if (escaped) {
      canRepeat = true;
      atBranchStart = false;
      index += 2;
      continue;
    }

    if (
      (syntax.regex === "ere" && (unit.value === "^" || unit.value === "$")) ||
      (syntax.regex === "bre" &&
        ((unit.value === "^" && atBranchStart) ||
          (unit.value === "$" &&
            isBreBranchEnd(units, index + 1, syntax.dialect))))
    ) {
      canRepeat = false;
      index += 1;
      continue;
    }

    canRepeat = true;
    atBranchStart = false;
    index += 1;
  }

  for (const group of openGroups) {
    issues.push(
      issueForRegexUnits(
        regex,
        units,
        "unclosed_regex_group",
        group.startIndex,
        group.endIndex,
        {
          closingText: syntax.regex === "bre" ? "\\)" : ")",
        },
      ),
    );
  }

  return { groupCount, issues };
}

function regexIssueNodes(containers, syntax) {
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
      if (syntax.dialect === "gnu") {
        const flags = container.childForFieldName("flags");
        for (const modifier of flags?.namedChildren ?? []) {
          if (
            modifier.type === "ignore_case_flag" ||
            modifier.type === "multiline_flag"
          ) {
            issues.push(issueAt(modifier, "invalid_empty_regex_modifier"));
          }
        }
      }
    } else {
      const analysis = regexAnalysis(pattern, syntax);
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

function decodedCharacterLength(text, dialect) {
  const characters = [...text];
  let length = 0;

  for (let index = 0; index < characters.length; index += 1) {
    if (characters[index] === "\\" && index + 1 < characters.length) {
      index += 1;
      if (characters[index] === "\r" && characters[index + 1] === "\n") {
        index += 1;
      } else if (dialect === "gnu") {
        const escapeKind = characters[index];
        const numericFormat = gnuNumericEscapeFormats[escapeKind];
        if (numericFormat !== undefined) {
          let digits = 0;
          while (
            digits < numericFormat.maximumDigits &&
            numericFormat.digitPattern.test(characters[index + 1] ?? "")
          ) {
            index += 1;
            digits += 1;
          }
        } else if (escapeKind === "c" && index + 1 < characters.length) {
          index += 1;
        }
      }
    }
    length += 1;
  }

  return length;
}

function translationIssueNodes(arguments_, syntax) {
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

    const sourceLength = decodedCharacterLength(source.text, syntax.dialect);
    const destinationLength = decodedCharacterLength(
      destination.text,
      syntax.dialect,
    );
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

function substitutionOccurrenceIssueNodes(occurrences) {
  const issues = [];

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

function duplicateSubstitutionFlagIssueNodes(arguments_, syntax) {
  if (syntax.dialect !== "gnu") {
    return [];
  }

  const issues = [];
  const uniqueFlags = [
    { type: "global_flag", kind: "flag" },
    { type: "print_flag", kind: "flag" },
    { type: "occurrence_flag", kind: "occurrence" },
  ];

  for (const argument of arguments_) {
    const flags = argument.childForFieldName("flags");
    if (flags === null) {
      continue;
    }
    for (const { type, kind } of uniqueFlags) {
      const matching = flags.namedChildren.filter((node) => node.type === type);
      for (const duplicate of matching.slice(1)) {
        issues.push(
          issueAt(duplicate, "duplicate_substitution_flag", duplicate, {
            kind,
          }),
        );
      }
    }
  }

  return issues;
}

function semanticIssueNodes(nodesByType, source, syntax) {
  const regexContainers = [
    ...nodesByType.escaped_regex_address,
    ...nodesByType.regex_address,
    ...nodesByType.substitute_argument,
  ].sort(compareIssueRanges);

  return [
    ...addressIssueNodes(nodesByType.command, source, syntax.dialect),
    ...regexIssueNodes(regexContainers, syntax),
    ...translationIssueNodes(nodesByType.translate_argument, syntax),
    ...substitutionOccurrenceIssueNodes(nodesByType.occurrence_flag),
    ...duplicateSubstitutionFlagIssueNodes(
      nodesByType.substitute_argument,
      syntax,
    ),
  ];
}

function diagnostic(
  document,
  node,
  { code, message, severity = DiagnosticSeverity.Error },
) {
  return {
    severity,
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

function labelDiagnostics(document, definitions, references, syntax) {
  const definedLabels = new Set();
  const issues = [];

  for (const definition of definitions) {
    if (definition.hasError || definition.text === "") {
      continue;
    }
    if (syntax.dialect !== "gnu" && definedLabels.has(definition.text)) {
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
        message: `No definition for sed label \`${reference.text}\` was found in this document.`,
        severity: DiagnosticSeverity.Warning,
      });
    }
  }

  return issues.map(({ node, ...description }) =>
    diagnostic(document, node, description),
  );
}

export function createDiagnostics(document, syntax) {
  const rootNode = syntaxTreeFor(document, syntax).rootNode;
  const source = document.getText();
  const nodesByType = collectDiagnosticNodes(rootNode);
  const syntaxIssues = normalizeIssues(
    collectSyntaxIssueNodes(rootNode),
    syntax.dialect,
    source,
  );
  const semanticIssues = semanticIssueNodes(nodesByType, source, syntax);

  return [
    ...syntaxIssues.map((node) => issueDiagnostic(document, node)),
    ...semanticIssues.map((node) => issueDiagnostic(document, node)),
    ...labelDiagnostics(
      document,
      nodesByType.label_definition,
      nodesByType.label_reference,
      syntax,
    ),
  ].sort(compareDiagnostics);
}

import {
  descendants,
  functionForCommand,
  labelSymbols,
  nativeIssues,
  rangeForNode,
  structuredIssues,
  textForNode,
} from "./cst.js";
import { assertSnapshot } from "./snapshot.js";

const portableDuplicationLimit = 255n;
const portableRegularExpressionLength = 256;
const cycleRestart = -1;
const regexFlowWorkBudget = 100_000;

function minimumEncodedByteLength(value) {
  return Array.from(value).length;
}

const outcomeSeverities = Object.freeze({
  implementation_defined_syntax: "warning",
  implementation_option_syntax: "warning",
  incomplete_syntax: "error",
  nonconforming_syntax: "error",
  undefined_syntax: "warning",
  unspecified_syntax: "warning",
});

const reasonMessages = Object.freeze({
  additional_address: "This command has an additional address.",
  adjacent_duplication_symbol:
    "Adjacent regular-expression duplication symbols have undefined behavior.",
  ambiguous_bracket_expression:
    "This bracket expression has an unspecified interpretation.",
  blanks_after_negation: "Blanks after '!' have unspecified behavior.",
  blanks_around_address_separator:
    "Blanks are not permitted around an address separator.",
  bre_plus_escape:
    "The meaning of '\\+' in a POSIX BRE is implementation-defined.",
  bre_question_mark_escape:
    "The meaning of '\\?' in a POSIX BRE is implementation-defined.",
  bre_subexpression_left_anchor:
    "A leading '^' in a BRE subexpression is an implementation option.",
  bre_subexpression_right_anchor:
    "A trailing '$' in a BRE subexpression is an implementation option.",
  bre_vertical_line_escape:
    "The meaning of '\\|' in a POSIX BRE is implementation-defined.",
  character_class_range_end:
    "A character class cannot be the ending point of a range.",
  character_class_range_start:
    "A character class cannot be the starting point of a range.",
  command_after_write_flag:
    "A command following the w substitution flag has undefined behavior.",
  duplicate_negation: "An editing command can contain at most one '!'.",
  empty_alternative:
    "An empty regular-expression alternative has undefined behavior.",
  empty_subexpression:
    "An empty regular-expression subexpression has undefined behavior.",
  equivalence_class_range_end:
    "An equivalence class as a range endpoint has unspecified behavior.",
  equivalence_class_range_start:
    "An equivalence class as a range endpoint has unspecified behavior.",
  excess_addresses: "This function accepts fewer addresses.",
  forbidden_command_separator:
    "This editing command cannot be followed by a semicolon.",
  forbidden_regular_expression_newline:
    "A physical newline cannot be escaped in a regular expression.",
  incomplete_alternative: "The regular-expression alternative is incomplete.",
  incomplete_bracket_term: "The bracket-expression term is incomplete.",
  incomplete_interval: "The regular-expression interval is incomplete.",
  incomplete_regular_expression: "The regular expression is incomplete.",
  incomplete_regular_expression_escape:
    "The regular-expression escape is incomplete.",
  incomplete_replacement: "The replacement is incomplete.",
  incomplete_replacement_escape: "The replacement escape is incomplete.",
  incomplete_translation: "The translation command is incomplete.",
  incomplete_translation_escape: "The translation escape is incomplete.",
  invalid_delimiter: "A backslash or newline cannot delimit this argument.",
  invalid_substitution_flag: "This is not a POSIX substitution flag.",
  leading_duplication_symbol:
    "A leading regular-expression duplication symbol has undefined behavior.",
  malformed_bracket_term: "This bracket-expression term is malformed.",
  malformed_interval: "This regular-expression interval is malformed.",
  missing_address_separator: "A comma is required between these addresses.",
  missing_bracket_list: "The bracket expression has no bracket list.",
  missing_closing_brace: "The command block needs a closing brace.",
  missing_command_separator:
    "A newline or permitted semicolon is required between commands.",
  missing_function: "The editing command needs a function.",
  missing_label: "The label command needs a label.",
  missing_opening_delimiter: "The command needs an opening delimiter.",
  missing_rfile: "The read command needs an rfile.",
  missing_subexpression: "The regular-expression subexpression is incomplete.",
  missing_text: "The command needs text.",
  missing_text_introducer:
    "The text argument must be introduced by a backslash and newline.",
  missing_wfile: "The write command or flag needs a wfile.",
  omitted_address: "Omitting an address around a comma has undefined behavior.",
  omitted_file_separator:
    "Accepting a file argument without separating blanks is an implementation option.",
  ordinary_character_escape:
    "Escaping this ordinary regular-expression character has undefined behavior.",
  replacement_ampersand_delimiter_escape:
    "Escaping an ampersand delimiter in the replacement has unspecified behavior.",
  shared_range_endpoint:
    "Sharing a character between bracket-expression ranges has undefined behavior.",
  special_delimiter_escape:
    "Escaping this special regular-expression delimiter has unspecified behavior.",
  unclosed_bracket_expression: "The bracket expression is not closed.",
  unclosed_subexpression: "The regular-expression subexpression is not closed.",
  undefined_translation_escape:
    "This translation-string escape has undefined behavior.",
  unexpected_command_text: "Unexpected text follows this editing command.",
  unknown_function: "This is not a POSIX sed function.",
  unmatched_closing_brace: "This closing brace has no matching command block.",
  unmatched_interval_close:
    "This BRE interval closing sequence has no matching opening sequence.",
  unmatched_subexpression_close:
    "This BRE subexpression closing sequence has no matching opening sequence.",
  unspecified_replacement_escape:
    "This replacement escape has unspecified behavior.",
  unspecified_text_escape: "This text escape has unspecified behavior.",
  unterminated_regular_expression:
    "The regular expression is not terminated before the physical line ending.",
  unterminated_replacement:
    "The replacement is not terminated before the physical line ending.",
  unterminated_translation:
    "The translation command is not terminated before the physical line ending.",
});

function codeFor(reason) {
  return reason.replaceAll("_", "-");
}

function sourceLeafNear(node, index) {
  let current = node;
  while (current.childCount > 0) {
    const children = current.children.filter(
      (child) =>
        child.endIndex > child.startIndex &&
        child.type !== "syntax_issue" &&
        child.type !== "ERROR",
    );
    if (children.length === 0) {
      break;
    }
    children.sort((left, right) => {
      const leftDistance = Math.min(
        Math.abs(index - left.startIndex),
        Math.abs(index - left.endIndex),
      );
      const rightDistance = Math.min(
        Math.abs(index - right.startIndex),
        Math.abs(index - right.endIndex),
      );
      return leftDistance - rightDistance || left.startIndex - right.startIndex;
    });
    current = children[0];
  }
  return current;
}

function rangeNode(issue) {
  if (issue.reasonNode.endIndex > issue.reasonNode.startIndex) {
    return issue.reasonNode;
  }
  if (issue.node.endIndex > issue.node.startIndex) {
    return issue.node;
  }
  const { parent } = issue;
  if (parent.type === "command_list") {
    return issue.reasonNode;
  }
  const siblings = parent.children
    .filter(
      (child) =>
        child.id !== issue.node.id &&
        child.endIndex > child.startIndex &&
        child.type !== "syntax_issue" &&
        child.type !== "ERROR",
    )
    .sort((left, right) => {
      const leftDistance = Math.min(
        Math.abs(issue.node.startIndex - left.startIndex),
        Math.abs(issue.node.startIndex - left.endIndex),
      );
      const rightDistance = Math.min(
        Math.abs(issue.node.startIndex - right.startIndex),
        Math.abs(issue.node.startIndex - right.endIndex),
      );
      return leftDistance - rightDistance || left.startIndex - right.startIndex;
    });
  return siblings.length === 0
    ? issue.reasonNode
    : sourceLeafNear(siblings[0], issue.node.startIndex);
}

function diagnostic(range, severity, code, message) {
  return {
    startOffset: range.startOffset,
    endOffset: range.endOffset,
    severity,
    code,
    message,
  };
}

function diagnosticForNode(node, severity, code, message) {
  return diagnostic(rangeForNode(node), severity, code, message);
}

function diagnosticAt(startIndex, endIndex, code, message) {
  return diagnostic(
    {
      startOffset: startIndex,
      endOffset: endIndex,
    },
    "warning",
    code,
    message,
  );
}

function structuredDiagnostics(root) {
  return structuredIssues(root).map((issue) => {
    const message = reasonMessages[issue.reason];
    if (message === undefined) {
      throw new Error(`No diagnostic message for ${issue.reason}.`);
    }
    const severity = outcomeSeverities[issue.outcome];
    if (severity === undefined) {
      throw new Error(`No diagnostic severity for ${issue.outcome}.`);
    }
    return {
      diagnostic: diagnostic(
        rangeForNode(rangeNode(issue)),
        severity,
        codeFor(issue.reason),
        message,
      ),
      issue,
    };
  });
}

function structuredCoverage(structured) {
  const intervals = structured
    .map(({ issue }) => {
      const artifact =
        issue.reasonNode.endIndex > issue.reasonNode.startIndex
          ? issue.reasonNode
          : issue.node;
      return {
        start: artifact.startIndex,
        end: artifact.endIndex,
      };
    })
    .sort((left, right) => left.start - right.start || left.end - right.end);
  const starts = [];
  const maximumEnds = [];
  const zeroWidth = new Set();
  let maximumEnd = -1;
  for (const interval of intervals) {
    starts.push(interval.start);
    maximumEnd = Math.max(maximumEnd, interval.end);
    maximumEnds.push(maximumEnd);
    if (interval.start === interval.end) {
      zeroWidth.add(interval.start);
    }
  }

  return (finding) => {
    if (finding.structuredAncestor) {
      return true;
    }
    const { startIndex, endIndex } = finding.node;
    let lower = 0;
    let upper = starts.length;
    while (lower < upper) {
      const middle = Math.floor((lower + upper) / 2);
      if (starts[middle] <= startIndex) {
        lower = middle + 1;
      } else {
        upper = middle;
      }
    }
    const index = lower - 1;
    if (startIndex === endIndex) {
      return (
        zeroWidth.has(startIndex) ||
        (index >= 0 && maximumEnds[index] > startIndex)
      );
    }
    return index >= 0 && maximumEnds[index] >= endIndex;
  };
}

function nativeDiagnostics(root, structured) {
  const coveredByStructuredIssue = structuredCoverage(structured);
  return nativeIssues(root)
    .filter((finding) => {
      if (finding.errorAncestor) {
        return false;
      }
      return !coveredByStructuredIssue(finding);
    })
    .map((finding) => {
      if (finding.kind === "error") {
        return diagnostic(
          rangeForNode(finding.node),
          "error",
          "syntax-error",
          "Syntax error.",
        );
      }
      const name = finding.node.type.replaceAll("_", " ");
      return diagnostic(
        rangeForNode(finding.node),
        "error",
        "missing-syntax",
        `Missing ${name}.`,
      );
    });
}

function compareDiagnostics(left, right) {
  return (
    left.startOffset - right.startOffset ||
    left.endOffset - right.endOffset ||
    left.severity.localeCompare(right.severity) ||
    String(left.code).localeCompare(String(right.code))
  );
}

function directCommands(commandList) {
  return commandList.namedChildren.filter(
    ({ type }) => type === "editing_command",
  );
}

function hasUnknownSyntax(node) {
  return structuredIssues(node).length > 0 || nativeIssues(node).length > 0;
}

function countToken(source, node) {
  const value = textForNode(source, node);
  if (value.length === 0) {
    return undefined;
  }
  for (const character of value) {
    if (character < "0" || character > "9") {
      return undefined;
    }
  }
  return BigInt(value);
}

function groupsInExpression(expression, mode) {
  const groups =
    mode === "bre"
      ? descendants(expression, "nondupl_bre").filter(
          (node) => node.childForFieldName("opening") !== null,
        )
      : descendants(expression, "ere_expression").filter(
          (node) => node.childForFieldName("opening") !== null,
        );
  return groups
    .map((node) => {
      const opening = node.childForFieldName("opening");
      const closing = node.childForFieldName("closing");
      const closingTokenType =
        mode === "bre"
          ? "back_close_parenthesis_token"
          : "close_parenthesis_token";
      const closingToken =
        closing === null
          ? undefined
          : descendants(closing, closingTokenType)[0];
      return { node, opening, closingToken };
    })
    .sort((left, right) => left.opening.startIndex - right.opening.startIndex);
}

function groupCount(expression, mode) {
  return Math.min(
    groupsInExpression(expression, mode).filter(
      ({ closingToken }) => closingToken !== undefined,
    ).length,
    9,
  );
}

function regexContainers(root) {
  return [
    ...descendants(root, "context_address"),
    ...descendants(root, "substitute_function"),
  ].sort(
    (left, right) =>
      left.startIndex - right.startIndex || left.endIndex - right.endIndex,
  );
}

function patternBackreferenceDiagnostics(snapshot) {
  if (snapshot.mode !== "bre") {
    return [];
  }
  const { source, tree } = snapshot;
  const result = [];
  for (const container of regexContainers(tree.rootNode)) {
    const expression = container.childForFieldName("expression");
    if (expression === null) {
      continue;
    }
    const groups = groupsInExpression(expression, "bre");
    for (const reference of descendants(expression, "backreference")) {
      const text = textForNode(source, reference);
      const number = Number(text.at(-1));
      const group = groups[number - 1];
      if (
        group === undefined ||
        group.closingToken === undefined ||
        group.closingToken.endIndex > reference.startIndex
      ) {
        result.push(
          diagnosticForNode(
            reference,
            "error",
            "invalid-pattern-backreference",
            `Back-reference \\${number} is not preceded by its corresponding BRE subexpression.`,
          ),
        );
      }
    }
  }
  return result;
}

function zeroReplacementBackreferenceDiagnostics(snapshot) {
  const { source, tree } = snapshot;
  return descendants(tree.rootNode, "replacement_backreference")
    .filter((reference) => textForNode(source, reference).at(-1) === "0")
    .map((reference) =>
      diagnosticForNode(
        reference,
        "warning",
        "unmatched-replacement-backreference",
        "Replacement back-reference \\0 has no corresponding POSIX regular-expression subexpression.",
      ),
    );
}

function intervalDiagnostics(snapshot) {
  const { source, tree } = snapshot;
  const result = [];
  const intervals = [
    ...descendants(tree.rootNode, "bre_dupl_symbol"),
    ...descendants(tree.rootNode, "ere_dupl_symbol"),
  ].sort((left, right) => left.startIndex - right.startIndex);
  for (const interval of intervals) {
    const minimumNode = interval.childForFieldName("minimum");
    const maximumNode = interval.childForFieldName("maximum");
    if (minimumNode === null || hasUnknownSyntax(interval)) {
      continue;
    }
    const minimum = countToken(source, minimumNode);
    const maximum =
      maximumNode === null ? undefined : countToken(source, maximumNode);
    for (const [node, value] of [
      [minimumNode, minimum],
      [maximumNode, maximum],
    ]) {
      if (
        node !== null &&
        value !== undefined &&
        value > portableDuplicationLimit
      ) {
        result.push(
          diagnosticForNode(
            node,
            "warning",
            "nonportable-duplication-count",
            "This duplication count exceeds the POSIX-guaranteed limit of 255.",
          ),
        );
      }
    }
    if (maximum !== undefined && minimum !== undefined && minimum > maximum) {
      result.push(
        diagnosticForNode(
          interval,
          "warning",
          "reversed-interval",
          "The interval minimum is greater than its maximum.",
        ),
      );
    }
  }
  return result;
}

function regularExpressionLengthDiagnostics(snapshot) {
  const { source, tree } = snapshot;
  const result = [];
  for (const container of regexContainers(tree.rootNode)) {
    const expression = container.childForFieldName("expression");
    if (
      expression !== null &&
      minimumEncodedByteLength(textForNode(source, expression)) >
        portableRegularExpressionLength
    ) {
      result.push(
        diagnosticForNode(
          expression,
          "warning",
          "long-regular-expression",
          "POSIX only guarantees support for regular expressions through 256 bytes.",
        ),
      );
    }
  }
  return result;
}

function substitutionFlagDiagnostics(snapshot) {
  const { tree } = snapshot;
  const result = [];
  for (const flags of descendants(tree.rootNode, "substitution_flags")) {
    if (
      descendants(flags, "global_flag").length === 0 ||
      descendants(flags, "occurrence_flag").length === 0
    ) {
      continue;
    }
    for (const occurrence of descendants(flags, "occurrence_flag")) {
      result.push(
        diagnosticForNode(
          occurrence,
          "warning",
          "global-occurrence-combination",
          "Combining the global and occurrence substitution flags has unspecified behavior.",
        ),
      );
    }
  }
  return result;
}

function translationEntries(source, string) {
  const entries = [];
  for (const component of string.namedChildren) {
    const text = textForNode(source, component);
    if (component.type === "translation_literal") {
      let offset = component.startIndex;
      for (const character of text) {
        entries.push({
          value: character,
          startIndex: offset,
          endIndex: offset + character.length,
        });
        offset += character.length;
      }
      continue;
    }
    if (component.type === "translation_escaped_delimiter") {
      const character = Array.from(text).at(-1);
      if (character === undefined) {
        return undefined;
      }
      entries.push({
        value: character,
        startIndex: component.startIndex,
        endIndex: component.endIndex,
      });
      continue;
    }
    if (component.type === "translation_escape") {
      let value;
      if (text === "\\n") {
        value = "\n";
      } else if (text === "\\\\") {
        value = "\\";
      } else {
        return undefined;
      }
      entries.push({
        value,
        startIndex: component.startIndex,
        endIndex: component.endIndex,
      });
    }
  }
  return entries;
}

function translationDiagnostics(snapshot) {
  const { source, tree } = snapshot;
  const result = [];
  for (const translate of descendants(tree.rootNode, "translate_function")) {
    const first = translate.childForFieldName("string1");
    const second = translate.childForFieldName("string2");
    if (first === null || second === null || hasUnknownSyntax(translate)) {
      continue;
    }
    const firstEntries = translationEntries(source, first);
    const secondEntries = translationEntries(source, second);
    if (firstEntries === undefined || secondEntries === undefined) {
      continue;
    }
    if (firstEntries.length !== secondEntries.length) {
      result.push(
        diagnosticForNode(
          second,
          "warning",
          "translation-length-mismatch",
          "The two translation strings contain different numbers of decoded characters.",
        ),
      );
    }
    const seen = new Set();
    for (const entry of firstEntries) {
      if (seen.has(entry.value)) {
        result.push(
          diagnosticAt(
            entry.startIndex,
            entry.endIndex,
            "duplicate-translation-source-character",
            "This character occurs more than once in the first translation string.",
          ),
        );
      }
      seen.add(entry.value);
    }
  }
  return result;
}

function portableFilenameCharacter(character) {
  const code = character.codePointAt(0);
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a) ||
    character === "." ||
    character === "_" ||
    character === "-"
  );
}

function labelDiagnostics(symbols) {
  const result = [];
  const definitions = new Map();
  for (const symbol of symbols) {
    if (symbol.kind === "definition") {
      const matching = definitions.get(symbol.name) ?? [];
      matching.push(symbol);
      definitions.set(symbol.name, matching);
    }
    if (!Array.from(symbol.name).every(portableFilenameCharacter)) {
      result.push(
        diagnosticForNode(
          symbol.node,
          "warning",
          "nonportable-label",
          "This label contains a character outside the portable filename character set.",
        ),
      );
    }
    if (minimumEncodedByteLength(symbol.name) > 8) {
      result.push(
        diagnosticForNode(
          symbol.node,
          "warning",
          "long-label",
          "POSIX only guarantees unique label recognition through 8 bytes.",
        ),
      );
    }
  }
  for (const matching of definitions.values()) {
    if (matching.length < 2) {
      continue;
    }
    for (const symbol of matching) {
      result.push(
        diagnosticForNode(
          symbol.node,
          "warning",
          "duplicate-label",
          `Label '${symbol.name}' is defined more than once.`,
        ),
      );
    }
  }
  for (const symbol of symbols) {
    if (symbol.kind === "reference" && !definitions.has(symbol.name)) {
      result.push(
        diagnosticForNode(
          symbol.node,
          "warning",
          "undefined-label",
          `Label '${symbol.name}' is not defined in this script.`,
        ),
      );
    }
  }
  return result;
}

function wfileDiagnostics(snapshot) {
  const { source, tree } = snapshot;
  const result = [];
  const distinct = new Set();
  for (const wfile of descendants(tree.rootNode, "wfile")) {
    const name = textForNode(source, wfile);
    if (distinct.has(name)) {
      continue;
    }
    distinct.add(name);
    if (distinct.size > 10) {
      result.push(
        diagnosticForNode(
          wfile,
          "warning",
          "excess-portable-wfile",
          "POSIX only guarantees support for ten distinct wfile arguments.",
        ),
      );
    }
  }
  return result;
}

function createControlFlow(source, root, symbols) {
  const commands = descendants(root, "editing_command");
  const commandUnits = commands.map((command, id) => ({
    id,
    kind: "command",
    command,
    functionNode: functionForCommand(command),
    fallthrough: cycleRestart,
    edges: [],
  }));
  const units = [...commandUnits];
  const unitByCommand = new Map(
    commandUnits.map((unit) => [unit.command.id, unit]),
  );

  function wireLists(rootList, continuation) {
    const rootCommands = directCommands(rootList);
    const stack = [
      {
        commands: rootCommands,
        index: rootCommands.length - 1,
        next: continuation,
      },
    ];
    while (stack.length > 0) {
      const frame = stack.at(-1);
      if (frame.index < 0) {
        stack.pop();
        if (frame.blockUnit !== undefined) {
          frame.blockUnit.blockEntry = frame.next;
          continue;
        }
        return frame.next;
      }

      const command = frame.commands[frame.index];
      frame.index -= 1;
      const unit = unitByCommand.get(command.id);
      if (unit === undefined) {
        continue;
      }
      unit.fallthrough = frame.next;
      frame.next = unit.id;
      if (unit.functionNode?.type !== "block_function") {
        continue;
      }
      const nested = unit.functionNode.childForFieldName("commands");
      if (nested === null) {
        unit.blockEntry = unit.fallthrough;
        continue;
      }
      const nestedCommands = directCommands(nested);
      stack.push({
        commands: nestedCommands,
        index: nestedCommands.length - 1,
        next: unit.fallthrough,
        blockUnit: unit,
      });
    }
    return continuation;
  }

  const rootList = root.namedChildren.find(
    ({ type }) => type === "command_list",
  );
  if (rootList === undefined) {
    return { entry: undefined, units };
  }
  const firstCommand = wireLists(rootList, cycleRestart);
  const entry = firstCommand === cycleRestart ? undefined : firstCommand;
  const labels = new Map();
  for (const symbol of symbols) {
    if (symbol.kind !== "definition") {
      continue;
    }
    const { command } = symbol;
    if (command === undefined) {
      continue;
    }
    const unit = unitByCommand.get(command.id);
    if (unit !== undefined) {
      const targets = labels.get(symbol.name) ?? [];
      targets.push(unit.id);
      labels.set(symbol.name, targets);
    }
  }

  function edge(target, route, advancesInput = target === cycleRestart) {
    return {
      target: target === cycleRestart ? entry : target,
      route,
      advancesInput,
    };
  }

  const labelDestinations = new Map();
  function labelDestination(name) {
    const targets = labels.get(name);
    if (targets === undefined) {
      return cycleRestart;
    }
    if (targets.length === 1) {
      return targets[0];
    }
    let destination = labelDestinations.get(name);
    if (destination === undefined) {
      destination = units.length;
      units.push({
        id: destination,
        kind: "dispatch",
        edges: targets.map((target) => edge(target, "dispatch")),
      });
      labelDestinations.set(name, destination);
    }
    return destination;
  }

  for (const unit of commandUnits) {
    const selection =
      unit.command.childForFieldName("addresses") !== null
        ? "optional"
        : unit.command.childForFieldName("negation") !== null
          ? "never"
          : "always";
    const canApply = selection !== "never";
    const canSkip = selection !== "always";
    const type = unit.functionNode?.type;
    if (type === "block_function") {
      if (canApply) {
        unit.edges.push(edge(unit.blockEntry, "applied"));
      }
      if (canSkip) {
        unit.edges.push(edge(unit.fallthrough, "skipped"));
      }
      continue;
    }
    if (type === "branch_function" || type === "test_function") {
      const label = unit.functionNode.childForFieldName("label");
      const target =
        label === null
          ? cycleRestart
          : labelDestination(textForNode(source, label));
      if (canApply) {
        unit.edges.push(
          edge(target, type === "test_function" ? "test-branch" : "applied"),
        );
      }
      if (canApply && type === "test_function") {
        unit.edges.push(edge(unit.fallthrough, "test-fallthrough"));
      }
      if (canSkip) {
        unit.edges.push(edge(unit.fallthrough, "skipped"));
      }
      continue;
    }
    if (type === "change_function" || type === "delete_function") {
      if (canApply) {
        unit.edges.push(edge(cycleRestart, "applied"));
      }
      if (canSkip) {
        unit.edges.push(edge(unit.fallthrough, "skipped"));
      }
      continue;
    }
    if (type === "delete_first_line_function") {
      if (canApply) {
        unit.edges.push(edge(cycleRestart, "applied"));
        unit.edges.push(edge(entry, "applied", false));
      }
      if (canSkip) {
        unit.edges.push(edge(unit.fallthrough, "skipped"));
      }
      continue;
    }
    if (type === "quit_function") {
      if (canSkip) {
        unit.edges.push(edge(unit.fallthrough, "skipped"));
      }
      continue;
    }
    if (type === "next_function" || type === "next_append_function") {
      if (canApply) {
        unit.edges.push(edge(unit.fallthrough, "applied", true));
      }
      if (canSkip) {
        unit.edges.push(edge(unit.fallthrough, "skipped"));
      }
      continue;
    }
    if (canApply) {
      unit.edges.push(edge(unit.fallthrough, "applied"));
    }
    if (canSkip) {
      unit.edges.push(edge(unit.fallthrough, "skipped"));
    }
  }
  return { entry, units };
}

const selectionSensitiveFunctions = new Set([
  "block_function",
  "branch_function",
  "change_function",
  "delete_first_line_function",
  "delete_function",
  "next_append_function",
  "next_function",
  "quit_function",
  "substitute_function",
  "test_function",
]);

function absoluteBigInt(value) {
  return value < 0n ? -value : value;
}

function greatestCommonDivisor(left, right) {
  let a = absoluteBigInt(left);
  let b = absoluteBigInt(right);
  while (b !== 0n) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

function firstCongruentAtOrAfter(first, lower, stride) {
  if (first >= lower) {
    return first;
  }
  const distance = lower - first;
  return first + ((distance + stride - 1n) / stride) * stride;
}

function lastCongruentAtOrBefore(first, upper, stride) {
  if (first > upper) {
    return undefined;
  }
  return first + ((upper - first) / stride) * stride;
}

function restrictInterval(interval, lower, upper) {
  const effectiveLower = interval.minimum > lower ? interval.minimum : lower;
  const effectiveUpper =
    interval.maximum === null
      ? upper
      : upper === null || interval.maximum < upper
        ? interval.maximum
        : upper;
  if (effectiveUpper !== null && effectiveLower > effectiveUpper) {
    return undefined;
  }
  if (interval.stride === 0n) {
    return interval.minimum >= effectiveLower &&
      (effectiveUpper === null || interval.minimum <= effectiveUpper)
      ? interval
      : undefined;
  }
  const minimum = firstCongruentAtOrAfter(
    interval.minimum,
    effectiveLower,
    interval.stride,
  );
  if (effectiveUpper !== null && minimum > effectiveUpper) {
    return undefined;
  }
  const maximum =
    effectiveUpper === null
      ? null
      : lastCongruentAtOrBefore(minimum, effectiveUpper, interval.stride);
  if (maximum === undefined) {
    return undefined;
  }
  return {
    minimum,
    maximum,
    stride: maximum === minimum ? 0n : interval.stride,
  };
}

function sameInterval(left, right) {
  return (
    left.minimum === right.minimum &&
    left.maximum === right.maximum &&
    left.stride === right.stride
  );
}

function joinIntervals(left, right, region) {
  if (sameInterval(left, right)) {
    return left;
  }
  const minimum = left.minimum < right.minimum ? left.minimum : right.minimum;
  const maximum =
    left.maximum === null || right.maximum === null
      ? null
      : left.maximum > right.maximum
        ? left.maximum
        : right.maximum;
  if (maximum !== null && minimum === maximum) {
    return { minimum, maximum, stride: 0n };
  }
  const stride = greatestCommonDivisor(
    greatestCommonDivisor(left.stride, right.stride),
    left.minimum - right.minimum,
  );
  // One congruence per numeric region bounds the state space. Widening only
  // adds line numbers, so the may-analysis cannot lose a concrete execution.
  const widenedMinimum = firstCongruentAtOrAfter(
    minimum,
    region.minimum,
    stride,
  );
  const widenedMaximum =
    region.maximum === null
      ? null
      : lastCongruentAtOrBefore(widenedMinimum, region.maximum, stride);
  return {
    minimum: widenedMinimum,
    maximum: widenedMaximum,
    stride:
      widenedMaximum !== null && widenedMaximum === widenedMinimum
        ? 0n
        : stride,
  };
}

function addressChild(address, type) {
  return address?.namedChildren.find((child) => child.type === type);
}

function addressClause(command) {
  return command.childForFieldName("addresses");
}

function clauseHasContextAddress(clause) {
  return clause !== null && descendants(clause, "context_address").length > 0;
}

function trackedUnit(unit) {
  const clause = addressClause(unit.command);
  return (
    selectionSensitiveFunctions.has(unit.functionNode?.type) ||
    clauseHasContextAddress(clause)
  );
}

function flowMetadata(snapshot, units) {
  const values = new Map([["1", 1n]]);
  const rangeByCommand = new Map();
  let rangeCount = 0;
  const trackedByCommand = new Map();
  for (const unit of units) {
    if (unit.kind !== "command") {
      continue;
    }
    const tracked = trackedUnit(unit);
    trackedByCommand.set(unit.command.id, tracked);
    if (!tracked) {
      continue;
    }
    const clause = addressClause(unit.command);
    if (clause === null) {
      continue;
    }
    for (const address of descendants(clause, "line_number_address")) {
      const value = countToken(snapshot.source, address);
      if (value !== undefined && value >= 1n) {
        values.set(value.toString(), value);
      }
    }
    if (clause.childForFieldName("second") !== null) {
      rangeByCommand.set(unit.command.id, rangeCount);
      rangeCount += 1;
    }
  }
  const boundaries = [...values.values()].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  const regions = [];
  let next = 1n;
  for (const boundary of boundaries) {
    if (next < boundary) {
      regions.push({ minimum: next, maximum: boundary - 1n });
    }
    regions.push({ minimum: boundary, maximum: boundary });
    next = boundary + 1n;
  }
  regions.push({ minimum: next, maximum: null });
  return { rangeByCommand, rangeCount, regions, trackedByCommand };
}

function regionForLine(regions, line) {
  let lower = 0;
  let upper = regions.length;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    const region = regions[middle];
    if (line < region.minimum) {
      upper = middle;
    } else if (region.maximum !== null && line > region.maximum) {
      lower = middle + 1;
    } else {
      return middle;
    }
  }
  throw new Error(`No numeric region contains input line ${line}.`);
}

function stateKey(state) {
  return [
    state.groupCount === null ? "none" : state.groupCount,
    Number(state.substituted),
    Number(state.lastLine),
    state.region,
  ].join(":");
}

function withLine(state, line, regions) {
  return {
    ...state,
    region: regionForLine(regions, line.minimum),
    line,
  };
}

function restrictStateLine(state, lower, upper, regions) {
  const line = restrictInterval(state.line, lower, upper);
  return line === undefined ? undefined : withLine(state, line, regions);
}

function advanceInput(state, regions) {
  if (state.lastLine) {
    return [];
  }
  const shifted = {
    minimum: state.line.minimum + 1n,
    maximum: state.line.maximum === null ? null : state.line.maximum + 1n,
    stride: state.line.stride,
  };
  // A completed range can search again only after input advances. Branches
  // and the non-advancing D path keep closedThisLine unchanged.
  const nextSearching = state.searching | state.closedThisLine;
  const result = [];
  for (let region = state.region; region < regions.length; region += 1) {
    const bounds = regions[region];
    const line = restrictInterval(shifted, bounds.minimum, bounds.maximum);
    if (line !== undefined) {
      for (const lastLine of [false, true]) {
        result.push({
          ...state,
          substituted: false,
          lastLine,
          region,
          line,
          searching: nextSearching,
          active: state.active,
          closedThisLine: 0n,
        });
      }
    }
    if (
      bounds.maximum === null ||
      (shifted.maximum !== null && shifted.maximum <= bounds.maximum)
    ) {
      break;
    }
  }
  return result;
}

function emptyExpressionRange(container) {
  const opening = container.childForFieldName("opening");
  const index = opening?.endIndex ?? container.startIndex;
  return { startIndex: index, endIndex: index };
}

function hasTerminatingRegexDelimiter(container) {
  const field = container.type === "substitute_function" ? "middle" : "closing";
  const delimiter = container.childForFieldName(field);
  return (
    delimiter !== null && descendants(delimiter, "delimiter_token").length > 0
  );
}

function emptyRegularExpressionDiagnostic(container) {
  const range = emptyExpressionRange(container);
  return diagnosticAt(
    range.startIndex,
    range.endIndex,
    "empty-regular-expression-without-previous",
    "This empty regular expression can be reached before any previous regular expression.",
  );
}

function regexTransfer(snapshot, container, state, report) {
  if (!hasTerminatingRegexDelimiter(container)) {
    return state;
  }
  const expression = container.childForFieldName("expression");
  if (expression !== null) {
    return { ...state, groupCount: groupCount(expression, snapshot.mode) };
  }
  if (state.groupCount === null) {
    report(emptyRegularExpressionDiagnostic(container));
  }
  return state;
}

function evaluateAddress(snapshot, address, state, regions, report) {
  const context = addressChild(address, "context_address");
  if (context !== undefined) {
    const evaluated = regexTransfer(snapshot, context, state, report);
    return [
      { state: evaluated, matches: true },
      { state: evaluated, matches: false },
    ];
  }
  const lineNumber = addressChild(address, "line_number_address");
  if (lineNumber !== undefined) {
    const number = countToken(snapshot.source, lineNumber);
    if (number !== undefined && number >= 1n) {
      const matching = restrictStateLine(state, number, number, regions);
      if (matching === undefined) {
        return [{ state, matches: false }];
      }
      if (
        state.line.maximum !== null &&
        state.line.minimum === state.line.maximum
      ) {
        return [{ state: matching, matches: true }];
      }
      return [
        { state: matching, matches: true },
        { state, matches: false },
      ];
    }
  }
  if (addressChild(address, "last_line_address") !== undefined) {
    return [{ state, matches: state.lastLine }];
  }
  return [
    { state, matches: true },
    { state, matches: false },
  ];
}

function setRangePhase(state, bit, phase) {
  const cleared = ~bit;
  return {
    ...state,
    searching: (state.searching & cleared) | (phase === "searching" ? bit : 0n),
    active: (state.active & cleared) | (phase === "active" ? bit : 0n),
    closedThisLine:
      (state.closedThisLine & cleared) |
      (phase === "closedThisLine" ? bit : 0n),
  };
}

function startedRangeStates(state, second, bit, snapshot, regions) {
  if (state.lastLine) {
    return [setRangePhase(state, bit, "closedThisLine")];
  }
  const numeric = addressChild(second, "line_number_address");
  const number =
    numeric === undefined ? undefined : countToken(snapshot.source, numeric);
  if (number === undefined) {
    return [setRangePhase(state, bit, "active")];
  }
  const before = restrictStateLine(state, 1n, number - 1n, regions);
  const atOrAfter = restrictStateLine(state, number, null, regions);
  return [
    ...(before === undefined ? [] : [setRangePhase(before, bit, "active")]),
    ...(atOrAfter === undefined
      ? []
      : [setRangePhase(atOrAfter, bit, "closedThisLine")]),
  ];
}

function rangeAddressBranches(snapshot, clause, state, range, regions, report) {
  const first = clause.childForFieldName("first");
  const second = clause.childForFieldName("second");
  const bit = 1n << BigInt(range);
  const result = [];
  if ((state.searching & bit) !== 0n) {
    for (const branch of evaluateAddress(
      snapshot,
      first,
      state,
      regions,
      report,
    )) {
      if (!branch.matches) {
        result.push({
          state: setRangePhase(branch.state, bit, "searching"),
          selected: false,
        });
        continue;
      }
      for (const started of startedRangeStates(
        branch.state,
        second,
        bit,
        snapshot,
        regions,
      )) {
        result.push({ state: started, selected: true });
      }
    }
  }
  if ((state.active & bit) !== 0n) {
    for (const branch of evaluateAddress(
      snapshot,
      second,
      state,
      regions,
      report,
    )) {
      result.push({
        state: setRangePhase(
          branch.state,
          bit,
          branch.matches ? "closedThisLine" : "active",
        ),
        selected: true,
      });
    }
  }
  if ((state.closedThisLine & bit) !== 0n) {
    result.push({
      state: setRangePhase(state, bit, "closedThisLine"),
      selected: false,
    });
  }
  return result;
}

function commandInputBranches(snapshot, metadata, command, state, report) {
  const clause = addressClause(command);
  let branches;
  if (clause === null) {
    branches = [{ state, selected: true }];
  } else {
    const second = clause.childForFieldName("second");
    if (second === null) {
      branches = evaluateAddress(
        snapshot,
        clause.childForFieldName("first"),
        state,
        metadata.regions,
        report,
      ).map(({ state: next, matches }) => ({
        state: next,
        selected: matches,
      }));
    } else {
      branches = rangeAddressBranches(
        snapshot,
        clause,
        state,
        metadata.rangeByCommand.get(command.id),
        metadata.regions,
        report,
      );
    }
  }
  if (command.childForFieldName("negation") !== null) {
    return branches.map((branch) => ({
      ...branch,
      selected: !branch.selected,
    }));
  }
  return branches;
}

function replacementBackreferenceDiagnostic(snapshot, reference) {
  const number = Number(textForNode(snapshot.source, reference).at(-1));
  return diagnosticForNode(
    reference,
    "warning",
    "unmatched-replacement-backreference",
    `Replacement back-reference \\${number} can refer to a regular expression with fewer subexpressions.`,
  );
}

function replacementTransfer(snapshot, substitute, input, report) {
  const state = regexTransfer(snapshot, substitute, input, report);
  for (const reference of descendants(
    substitute,
    "replacement_backreference",
  )) {
    const number = Number(textForNode(snapshot.source, reference).at(-1));
    if (
      number !== 0 &&
      (state.groupCount === null || state.groupCount < number)
    ) {
      report(replacementBackreferenceDiagnostic(snapshot, reference));
    }
  }
  return state.substituted ? [state] : [state, { ...state, substituted: true }];
}

function flowTargets(snapshot) {
  return {
    empty: regexContainers(snapshot.tree.rootNode).filter(
      (container) =>
        hasTerminatingRegexDelimiter(container) &&
        container.childForFieldName("expression") === null,
    ),
    references: descendants(
      snapshot.tree.rootNode,
      "replacement_backreference",
    ).filter(
      (reference) => textForNode(snapshot.source, reference).at(-1) !== "0",
    ),
  };
}

function conservativeFlowDiagnostics(snapshot, targets) {
  const result = new Map();
  const report = (value) => {
    const key = [value.code, value.startOffset, value.endOffset].join(":");
    result.set(key, value);
  };
  for (const container of targets.empty) {
    report(emptyRegularExpressionDiagnostic(container));
  }
  for (const reference of targets.references) {
    report(replacementBackreferenceDiagnostic(snapshot, reference));
  }
  return [...result.values()];
}

function regexFlowDiagnostics(snapshot, symbols) {
  const targets = flowTargets(snapshot);
  if (targets.empty.length === 0 && targets.references.length === 0) {
    return [];
  }
  const { entry, units } = createControlFlow(
    snapshot.source,
    snapshot.tree.rootNode,
    symbols,
  );
  if (entry === undefined) {
    return [];
  }
  const metadata = flowMetadata(snapshot, units);
  const incoming = units.map(() => new Map());
  const queued = new Set();
  const queue = [];
  let queueIndex = 0;
  let remainingWork = regexFlowWorkBudget;
  let exhausted = false;
  const reported = new Map();
  const report = (value) => {
    const key = [value.code, value.startOffset, value.endOffset].join(":");
    reported.set(key, value);
  };

  const rangeWordCost = 1 + Math.ceil(metadata.rangeCount / 64);
  function consumeWork() {
    remainingWork -= rangeWordCost;
    if (remainingWork < 0) {
      exhausted = true;
      return false;
    }
    return true;
  }

  function addState(unit, state) {
    if (unit === undefined || exhausted || !consumeWork()) {
      return;
    }
    const key = stateKey(state);
    const destination = incoming[unit];
    const current = destination.get(key);
    let changed = false;
    if (current === undefined) {
      destination.set(key, state);
      changed = true;
    } else {
      const line = joinIntervals(
        current.line,
        state.line,
        metadata.regions[state.region],
      );
      const searching = current.searching | state.searching;
      const active = current.active | state.active;
      const closedThisLine = current.closedThisLine | state.closedThisLine;
      changed =
        !sameInterval(current.line, line) ||
        searching !== current.searching ||
        active !== current.active ||
        closedThisLine !== current.closedThisLine;
      if (changed) {
        destination.set(key, {
          ...current,
          line,
          searching,
          active,
          closedThisLine,
        });
      }
    }
    const queueKey = `${unit}/${key}`;
    if (changed && !queued.has(queueKey)) {
      queue.push({ key, queueKey, unit });
      queued.add(queueKey);
    }
  }

  function propagate(edge, state) {
    if (edge.target === undefined || exhausted) {
      return;
    }
    const states = edge.advancesInput
      ? advanceInput(state, metadata.regions)
      : [state];
    for (const next of states) {
      addState(edge.target, next);
    }
  }

  const allRanges =
    metadata.rangeCount === 0 ? 0n : (1n << BigInt(metadata.rangeCount)) - 1n;
  for (const lastLine of [false, true]) {
    addState(entry, {
      groupCount: null,
      substituted: false,
      lastLine,
      region: regionForLine(metadata.regions, 1n),
      line: { minimum: 1n, maximum: 1n, stride: 0n },
      searching: allRanges,
      active: 0n,
      closedThisLine: 0n,
    });
  }

  while (queueIndex < queue.length && !exhausted) {
    if (!consumeWork()) {
      break;
    }
    const { key, queueKey, unit: id } = queue[queueIndex];
    queueIndex += 1;
    queued.delete(queueKey);
    const state = incoming[id].get(key);
    if (state === undefined) {
      continue;
    }
    const unit = units[id];
    if (unit.kind === "dispatch") {
      for (const edge of unit.edges) {
        propagate(edge, state);
      }
      continue;
    }
    if (!metadata.trackedByCommand.get(unit.command.id)) {
      const unique = new Map();
      for (const edge of unit.edges) {
        unique.set(
          `${String(edge.target)}/${Number(edge.advancesInput)}`,
          edge,
        );
      }
      for (const edge of unique.values()) {
        propagate(edge, state);
      }
      continue;
    }
    const branches = commandInputBranches(
      snapshot,
      metadata,
      unit.command,
      state,
      report,
    );
    const selected = branches.filter(({ selected }) => selected);
    const skipped = branches.filter(({ selected }) => !selected);
    const applied = selected.flatMap(({ state: input }) =>
      unit.functionNode?.type === "substitute_function"
        ? replacementTransfer(snapshot, unit.functionNode, input, report)
        : [input],
    );
    for (const edge of unit.edges) {
      if (edge.route === "skipped") {
        for (const branch of skipped) {
          propagate(edge, branch.state);
        }
      } else if (edge.route === "test-branch") {
        for (const value of applied.filter(({ substituted }) => substituted)) {
          propagate(edge, { ...value, substituted: false });
        }
      } else if (edge.route === "test-fallthrough") {
        for (const value of applied.filter(({ substituted }) => !substituted)) {
          propagate(edge, value);
        }
      } else {
        for (const value of applied) {
          propagate(edge, value);
        }
      }
    }
  }
  if (exhausted) {
    // Exhaustion preserves soundness by reporting every flow-sensitive site.
    return conservativeFlowDiagnostics(snapshot, targets);
  }
  return [...reported.values()];
}

function semanticDiagnostics(snapshot) {
  const symbols = labelSymbols(snapshot.source, snapshot.tree.rootNode);
  return [
    ...patternBackreferenceDiagnostics(snapshot),
    ...zeroReplacementBackreferenceDiagnostics(snapshot),
    ...intervalDiagnostics(snapshot),
    ...regularExpressionLengthDiagnostics(snapshot),
    ...substitutionFlagDiagnostics(snapshot),
    ...translationDiagnostics(snapshot),
    ...labelDiagnostics(symbols),
    ...wfileDiagnostics(snapshot),
    ...regexFlowDiagnostics(snapshot, symbols),
  ];
}

export function diagnosticMessages() {
  return reasonMessages;
}

export function diagnosticSeverities() {
  return outcomeSeverities;
}

function syntaxDiagnosticsForValidSnapshot(snapshot) {
  const { tree } = snapshot;
  const structured = structuredDiagnostics(tree.rootNode);
  return [
    ...structured.map(({ diagnostic: value }) => value),
    ...nativeDiagnostics(tree.rootNode, structured),
  ].sort(compareDiagnostics);
}

export function syntaxDiagnostics(snapshot) {
  assertSnapshot(snapshot);
  return syntaxDiagnosticsForValidSnapshot(snapshot);
}

export function diagnostics(snapshot) {
  assertSnapshot(snapshot);
  return [
    ...syntaxDiagnosticsForValidSnapshot(snapshot),
    ...semanticDiagnostics(snapshot),
  ].sort(compareDiagnostics);
}

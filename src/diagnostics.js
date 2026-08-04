import { DiagnosticSeverity } from "vscode-languageserver";
import {
  descendants,
  functionForCommand,
  labelSymbols,
  nativeIssues,
  rangeForNode,
  structuredIssues,
  textForNode,
} from "./cst.js";

const diagnosticSource = "sed-language-server";
const portableDuplicationLimit = 255n;
const cycleRestart = -1;
const noRegularExpression = 10;

const outcomeSeverities = Object.freeze({
  implementation_defined_syntax: DiagnosticSeverity.Warning,
  implementation_option_syntax: DiagnosticSeverity.Warning,
  incomplete_syntax: DiagnosticSeverity.Error,
  nonconforming_syntax: DiagnosticSeverity.Error,
  undefined_syntax: DiagnosticSeverity.Warning,
  unspecified_syntax: DiagnosticSeverity.Warning,
});

const reasonPolicies = Object.freeze({
  additional_address: {
    message: "This command has an additional address.",
    range: "artifact",
  },
  adjacent_duplication_symbol: {
    message:
      "Adjacent regular-expression duplication symbols have undefined behavior.",
    range: "artifact",
  },
  ambiguous_bracket_expression: {
    message: "This bracket expression has an unspecified interpretation.",
    range: "artifact",
  },
  blanks_after_negation: {
    message: "Blanks after '!' have unspecified behavior.",
    range: "artifact",
  },
  blanks_around_address_separator: {
    message: "Blanks are not permitted around an address separator.",
    range: "artifact",
  },
  bre_plus_escape: {
    message: "The meaning of '\\+' in a POSIX BRE is implementation-defined.",
    range: "artifact",
  },
  bre_question_mark_escape: {
    message: "The meaning of '\\?' in a POSIX BRE is implementation-defined.",
    range: "artifact",
  },
  bre_subexpression_left_anchor: {
    message:
      "A leading '^' in a BRE subexpression is an implementation option.",
    range: "artifact",
  },
  bre_subexpression_right_anchor: {
    message:
      "A trailing '$' in a BRE subexpression is an implementation option.",
    range: "artifact",
  },
  bre_vertical_line_escape: {
    message: "The meaning of '\\|' in a POSIX BRE is implementation-defined.",
    range: "artifact",
  },
  character_class_range_end: {
    message: "A character class cannot be the ending point of a range.",
    range: "artifact",
  },
  character_class_range_start: {
    message: "A character class cannot be the starting point of a range.",
    range: "artifact",
  },
  duplicate_negation: {
    message: "An editing command can contain at most one '!'.",
    range: "artifact",
  },
  empty_alternative: {
    message: "An empty regular-expression alternative has undefined behavior.",
    range: "artifact",
  },
  empty_subexpression: {
    message:
      "An empty regular-expression subexpression has undefined behavior.",
    range: "artifact",
  },
  equivalence_class_range_end: {
    message:
      "An equivalence class as a range endpoint has unspecified behavior.",
    range: "artifact",
  },
  equivalence_class_range_start: {
    message:
      "An equivalence class as a range endpoint has unspecified behavior.",
    range: "artifact",
  },
  excess_addresses: {
    message: "This function accepts fewer addresses.",
    range: "artifact",
  },
  forbidden_command_separator: {
    message: "This editing command cannot be followed by a semicolon.",
    range: "artifact",
  },
  incomplete_regular_expression: {
    message: "The regular expression is incomplete.",
    range: "artifact",
  },
  incomplete_regular_expression_escape: {
    message: "The regular-expression escape is incomplete.",
    range: "artifact",
  },
  incomplete_replacement: {
    message: "The replacement is incomplete.",
    range: "artifact",
  },
  incomplete_replacement_escape: {
    message: "The replacement escape is incomplete.",
    range: "artifact",
  },
  incomplete_translation: {
    message: "The translation command is incomplete.",
    range: "artifact",
  },
  incomplete_translation_escape: {
    message: "The translation escape is incomplete.",
    range: "artifact",
  },
  invalid_address: {
    message: "This is not a valid POSIX sed address.",
    range: "artifact",
  },
  invalid_delimiter: {
    message: "A backslash or newline cannot delimit this argument.",
    range: "artifact",
  },
  invalid_substitution_flag: {
    message: "This is not a POSIX substitution flag.",
    range: "artifact",
  },
  leading_duplication_symbol: {
    message:
      "A leading regular-expression duplication symbol has undefined behavior.",
    range: "artifact",
  },
  malformed_bracket_term: {
    message: "This bracket-expression term is malformed.",
    range: "artifact",
  },
  malformed_interval: {
    message: "This regular-expression interval is malformed.",
    range: "artifact",
  },
  missing_address_separator: {
    message: "A comma is required between these addresses.",
    range: "artifact",
  },
  missing_bracket_list: {
    message: "The bracket expression has no bracket list.",
    range: "artifact",
  },
  missing_closing_brace: {
    message: "The command block needs a closing brace.",
    range: "artifact",
  },
  missing_command_separator: {
    message: "A newline or permitted semicolon is required between commands.",
    range: "artifact",
  },
  missing_function: {
    message: "The editing command needs a function.",
    range: "artifact",
  },
  missing_label: {
    message: "The label command needs a label.",
    range: "artifact",
  },
  missing_opening_delimiter: {
    message: "The command needs an opening delimiter.",
    range: "artifact",
  },
  missing_rfile: {
    message: "The read command needs an rfile.",
    range: "artifact",
  },
  missing_subexpression: {
    message: "The regular-expression subexpression is incomplete.",
    range: "artifact",
  },
  missing_text: {
    message: "The command needs text.",
    range: "artifact",
  },
  missing_text_introducer: {
    message: "The text argument must be introduced by a backslash and newline.",
    range: "artifact",
  },
  missing_wfile: {
    message: "The write command or flag needs a wfile.",
    range: "artifact",
  },
  omitted_address: {
    message: "Omitting an address around a comma has undefined behavior.",
    range: "artifact",
  },
  omitted_file_separator: {
    message:
      "Accepting a file argument without separating blanks is an implementation option.",
    range: "artifact",
  },
  ordinary_character_escape: {
    message:
      "Escaping this ordinary regular-expression character has undefined behavior.",
    range: "artifact",
  },
  replacement_ampersand_delimiter_escape: {
    message:
      "Escaping an ampersand delimiter in the replacement has unspecified behavior.",
    range: "artifact",
  },
  shared_range_endpoint: {
    message:
      "Sharing a character between bracket-expression ranges has undefined behavior.",
    range: "artifact",
  },
  special_delimiter_escape: {
    message:
      "Escaping this special regular-expression delimiter has unspecified behavior.",
    range: "artifact",
  },
  unclosed_bracket_expression: {
    message: "The bracket expression is not closed.",
    range: "artifact",
  },
  unclosed_subexpression: {
    message: "The regular-expression subexpression is not closed.",
    range: "artifact",
  },
  undefined_translation_escape: {
    message: "This translation-string escape has undefined behavior.",
    range: "artifact",
  },
  unexpected_command_text: {
    message: "Unexpected text follows this editing command.",
    range: "artifact",
  },
  unknown_function: {
    message: "This is not a POSIX sed function.",
    range: "artifact",
  },
  unmatched_closing_brace: {
    message: "This closing brace has no matching command block.",
    range: "artifact",
  },
  unmatched_interval_close: {
    message:
      "This BRE interval closing sequence has no matching opening sequence.",
    range: "artifact",
  },
  unmatched_subexpression_close: {
    message:
      "This BRE subexpression closing sequence has no matching opening sequence.",
    range: "artifact",
  },
  unspecified_replacement_escape: {
    message: "This replacement escape has unspecified behavior.",
    range: "artifact",
  },
  unspecified_text_escape: {
    message: "This text escape has unspecified behavior.",
    range: "artifact",
  },
  zero_substitution_occurrence: {
    message: "A substitution occurrence must be greater than zero.",
    range: "artifact",
  },
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

function rangeNode(issue, policy) {
  if (policy !== "artifact") {
    throw new Error(`Unsupported diagnostic range policy: ${policy}`);
  }
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
    range,
    severity,
    code,
    source: diagnosticSource,
    message,
  };
}

function diagnosticForNode(document, node, severity, code, message) {
  return diagnostic(rangeForNode(document, node), severity, code, message);
}

function diagnosticAt(document, startIndex, endIndex, code, message) {
  return diagnostic(
    {
      start: document.positionAt(startIndex),
      end: document.positionAt(endIndex),
    },
    DiagnosticSeverity.Warning,
    code,
    message,
  );
}

function structuredDiagnostics(document, root) {
  return structuredIssues(root).map((issue) => {
    const policy = reasonPolicies[issue.reason];
    if (policy === undefined) {
      throw new Error(`No diagnostic policy for ${issue.reason}.`);
    }
    const severity = outcomeSeverities[issue.outcome];
    if (severity === undefined) {
      throw new Error(`No diagnostic severity for ${issue.outcome}.`);
    }
    return {
      diagnostic: diagnostic(
        rangeForNode(document, rangeNode(issue, policy.range)),
        severity,
        codeFor(issue.reason),
        policy.message,
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

function nativeDiagnostics(document, root, structured) {
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
          rangeForNode(document, finding.node),
          DiagnosticSeverity.Error,
          "syntax-error",
          "Syntax error.",
        );
      }
      const name = finding.node.type.replaceAll("_", " ");
      return diagnostic(
        rangeForNode(document, finding.node),
        DiagnosticSeverity.Error,
        "missing-syntax",
        `Missing ${name}.`,
      );
    });
}

function compareDiagnostics(left, right) {
  return (
    left.range.start.line - right.range.start.line ||
    left.range.start.character - right.range.start.character ||
    left.range.end.line - right.range.end.line ||
    left.range.end.character - right.range.end.character ||
    left.severity - right.severity ||
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

function countToken(document, node) {
  const value = textForNode(document, node);
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
  const { document, tree } = snapshot;
  const result = [];
  for (const container of regexContainers(tree.rootNode)) {
    const expression = container.childForFieldName("expression");
    if (expression === null) {
      continue;
    }
    const groups = groupsInExpression(expression, "bre");
    for (const reference of descendants(expression, "backreference")) {
      const text = textForNode(document, reference);
      const number = Number(text.at(-1));
      const group = groups[number - 1];
      if (
        group === undefined ||
        group.closingToken === undefined ||
        group.closingToken.endIndex > reference.startIndex
      ) {
        result.push(
          diagnosticForNode(
            document,
            reference,
            DiagnosticSeverity.Error,
            "invalid-pattern-backreference",
            `Back-reference \\${number} is not preceded by its corresponding BRE subexpression.`,
          ),
        );
      }
    }
  }
  return result;
}

function intervalDiagnostics(snapshot) {
  const { document, tree } = snapshot;
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
    const minimum = countToken(document, minimumNode);
    const maximum =
      maximumNode === null ? undefined : countToken(document, maximumNode);
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
            document,
            node,
            DiagnosticSeverity.Warning,
            "nonportable-duplication-count",
            "This duplication count exceeds the POSIX-guaranteed limit of 255.",
          ),
        );
      }
    }
    if (maximum !== undefined && minimum !== undefined && minimum > maximum) {
      result.push(
        diagnosticForNode(
          document,
          interval,
          DiagnosticSeverity.Warning,
          "reversed-interval",
          "The interval minimum is greater than its maximum.",
        ),
      );
    }
  }
  return result;
}

function substitutionFlagDiagnostics(snapshot) {
  const { document, tree } = snapshot;
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
          document,
          occurrence,
          DiagnosticSeverity.Warning,
          "global-occurrence-combination",
          "Combining the global and occurrence substitution flags has unspecified behavior.",
        ),
      );
    }
  }
  return result;
}

function translationEntries(document, string) {
  const entries = [];
  for (const component of string.namedChildren) {
    const text = textForNode(document, component);
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
  const { document, tree } = snapshot;
  const result = [];
  for (const translate of descendants(tree.rootNode, "translate_function")) {
    const first = translate.childForFieldName("string1");
    const second = translate.childForFieldName("string2");
    if (first === null || second === null || hasUnknownSyntax(translate)) {
      continue;
    }
    const firstEntries = translationEntries(document, first);
    const secondEntries = translationEntries(document, second);
    if (firstEntries === undefined || secondEntries === undefined) {
      continue;
    }
    if (firstEntries.length !== secondEntries.length) {
      result.push(
        diagnosticForNode(
          document,
          second,
          DiagnosticSeverity.Warning,
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
            document,
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

function labelDiagnostics(snapshot, symbols) {
  const { document } = snapshot;
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
          document,
          symbol.node,
          DiagnosticSeverity.Warning,
          "nonportable-label",
          "This label contains a character outside the portable filename character set.",
        ),
      );
    }
    if (Buffer.byteLength(symbol.name, "utf8") > 8) {
      result.push(
        diagnosticForNode(
          document,
          symbol.node,
          DiagnosticSeverity.Warning,
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
          document,
          symbol.node,
          DiagnosticSeverity.Warning,
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
          document,
          symbol.node,
          DiagnosticSeverity.Warning,
          "undefined-label",
          `Label '${symbol.name}' is not defined in this script.`,
        ),
      );
    }
  }
  return result;
}

function wfileDiagnostics(snapshot) {
  const { document, tree } = snapshot;
  const result = [];
  const distinct = new Set();
  for (const wfile of descendants(tree.rootNode, "wfile")) {
    const name = textForNode(document, wfile);
    if (distinct.has(name)) {
      continue;
    }
    distinct.add(name);
    if (distinct.size > 10) {
      result.push(
        diagnosticForNode(
          document,
          wfile,
          DiagnosticSeverity.Warning,
          "excess-portable-wfile",
          "POSIX only guarantees support for ten distinct wfile arguments.",
        ),
      );
    }
  }
  return result;
}

function createControlFlow(document, root, symbols) {
  const commands = descendants(root, "editing_command");
  const units = commands.map((command, id) => ({
    id,
    command,
    functionNode: functionForCommand(command),
    fallthrough: cycleRestart,
    edges: [],
  }));
  const unitByCommand = new Map(units.map((unit) => [unit.command.id, unit]));

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

  function edge(target, route, resetsSubstitution = target === cycleRestart) {
    return {
      target: target === cycleRestart ? entry : target,
      route,
      resetsSubstitution,
    };
  }

  for (const unit of units) {
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
      const targets =
        label === null
          ? [cycleRestart]
          : (labels.get(textForNode(document, label)) ?? [cycleRestart]);
      if (canApply) {
        for (const target of targets) {
          unit.edges.push(
            edge(target, type === "test_function" ? "test-branch" : "applied"),
          );
        }
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

function setUnion(...sets) {
  return new Set(sets.flatMap((set) => [...set]));
}

function analysisState(groupCount, hasSubstituted) {
  const group = groupCount === null ? noRegularExpression : groupCount;
  return group * 2 + Number(hasSubstituted);
}

function groupCountOf(state) {
  const group = Math.floor(state / 2);
  return group === noRegularExpression ? null : group;
}

function hasSubstituted(state) {
  return state % 2 === 1;
}

function withGroupCount(state, groupCount) {
  return analysisState(groupCount, hasSubstituted(state));
}

function withSubstitutionState(state, substituted) {
  return analysisState(groupCountOf(state), substituted);
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

function regexTransfer(snapshot, container, input, report) {
  if (!hasTerminatingRegexDelimiter(container)) {
    return new Set(input);
  }
  const expression = container.childForFieldName("expression");
  if (expression !== null) {
    const count = groupCount(expression, snapshot.mode);
    return new Set([...input].map((state) => withGroupCount(state, count)));
  }
  if ([...input].some((state) => groupCountOf(state) === null)) {
    const range = emptyExpressionRange(container);
    report(
      diagnosticAt(
        snapshot.document,
        range.startIndex,
        range.endIndex,
        "empty-regular-expression-without-previous",
        "This empty regular expression can be reached before any previous regular expression.",
      ),
    );
  }
  return new Set(input);
}

function addressTransfer(snapshot, command, input, report) {
  const clause = command.childForFieldName("addresses");
  if (clause === null) {
    return new Set(input);
  }
  const initial = new Set(input);
  const first = clause.childForFieldName("first");
  const second = clause.childForFieldName("second");
  const firstContext = first?.namedChildren.find(
    ({ type }) => type === "context_address",
  );
  const afterFirst =
    firstContext === undefined
      ? initial
      : regexTransfer(snapshot, firstContext, initial, report);
  if (second === null) {
    return afterFirst;
  }

  let activeRange =
    firstContext === undefined
      ? initial
      : new Set([...initial].filter((state) => groupCountOf(state) !== null));
  const secondContext = second?.namedChildren.find(
    ({ type }) => type === "context_address",
  );
  if (secondContext !== undefined) {
    activeRange = regexTransfer(snapshot, secondContext, activeRange, report);
  }
  return setUnion(afterFirst, activeRange);
}

function replacementTransfer(snapshot, substitute, input, report) {
  const state = regexTransfer(snapshot, substitute, input, report);
  for (const reference of descendants(
    substitute,
    "replacement_backreference",
  )) {
    const number = Number(textForNode(snapshot.document, reference).at(-1));
    if (
      [...state].some((value) => {
        const count = groupCountOf(value);
        return count === null || count < number;
      })
    ) {
      report(
        diagnosticForNode(
          snapshot.document,
          reference,
          DiagnosticSeverity.Warning,
          "unmatched-replacement-backreference",
          `Replacement back-reference \\${number} can refer to a regular expression with fewer subexpressions.`,
        ),
      );
    }
  }
  return setUnion(
    state,
    new Set([...state].map((value) => withSubstitutionState(value, true))),
  );
}

function regexFlowDiagnostics(snapshot, symbols) {
  const { entry, units } = createControlFlow(
    snapshot.document,
    snapshot.tree.rootNode,
    symbols,
  );
  if (entry === undefined) {
    return [];
  }
  const incoming = units.map(() => new Set());
  incoming[entry].add(analysisState(null, false));
  const queued = new Set([entry]);
  const queue = [entry];
  let queueIndex = 0;
  const reported = new Map();
  const report = (value) => {
    const key = [
      value.code,
      value.range.start.line,
      value.range.start.character,
      value.range.end.line,
      value.range.end.character,
    ].join(":");
    reported.set(key, value);
  };

  while (queueIndex < queue.length) {
    const id = queue[queueIndex];
    queueIndex += 1;
    queued.delete(id);
    const unit = units[id];
    const beforeFunction = addressTransfer(
      snapshot,
      unit.command,
      incoming[id],
      report,
    );
    const appliesFunction = unit.edges.some(({ route }) => route !== "skipped");
    const applied =
      appliesFunction && unit.functionNode?.type === "substitute_function"
        ? replacementTransfer(
            snapshot,
            unit.functionNode,
            beforeFunction,
            report,
          )
        : new Set(beforeFunction);
    for (const edge of unit.edges) {
      if (edge.target === undefined) {
        continue;
      }
      let outgoing;
      if (edge.route === "skipped") {
        outgoing = beforeFunction;
      } else if (edge.route === "test-branch") {
        outgoing = new Set(
          [...beforeFunction]
            .filter(hasSubstituted)
            .map((state) => withSubstitutionState(state, false)),
        );
      } else if (edge.route === "test-fallthrough") {
        outgoing = new Set(
          [...beforeFunction].map((state) =>
            withSubstitutionState(state, false),
          ),
        );
      } else {
        outgoing = applied;
      }
      if (edge.resetsSubstitution) {
        outgoing = new Set(
          [...outgoing].map((state) => withSubstitutionState(state, false)),
        );
      }
      const destination = incoming[edge.target];
      const previousSize = destination.size;
      for (const state of outgoing) {
        destination.add(state);
      }
      if (destination.size !== previousSize && !queued.has(edge.target)) {
        queue.push(edge.target);
        queued.add(edge.target);
      }
    }
  }
  return [...reported.values()];
}

function semanticDiagnostics(snapshot) {
  const symbols = labelSymbols(snapshot.document, snapshot.tree.rootNode);
  return [
    ...patternBackreferenceDiagnostics(snapshot),
    ...intervalDiagnostics(snapshot),
    ...substitutionFlagDiagnostics(snapshot),
    ...translationDiagnostics(snapshot),
    ...labelDiagnostics(snapshot, symbols),
    ...wfileDiagnostics(snapshot),
    ...regexFlowDiagnostics(snapshot, symbols),
  ];
}

export function diagnosticPolicies() {
  return reasonPolicies;
}

export function syntaxDiagnostics(snapshot) {
  const { document, tree } = snapshot;
  const structured = structuredDiagnostics(document, tree.rootNode);
  return [
    ...structured.map(({ diagnostic: value }) => value),
    ...nativeDiagnostics(document, tree.rootNode, structured),
  ].sort(compareDiagnostics);
}

export function diagnostics(snapshot) {
  return [
    ...syntaxDiagnostics(snapshot),
    ...semanticDiagnostics(snapshot),
  ].sort(compareDiagnostics);
}

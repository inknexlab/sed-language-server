import {
  checkpointInterval,
  countToken,
  cstIndex,
  descendants,
  functionForCommand,
  hasIssue,
  indexedDescendants,
  indexedNodes,
  rangeForNode,
  textForNode,
} from "./cst.js";

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

function diagnosticForOffsets(startOffset, endOffset, severity, code, message) {
  return diagnostic({ startOffset, endOffset }, severity, code, message);
}

function compareDiagnostics(left, right) {
  return (
    left.startOffset - right.startOffset ||
    left.endOffset - right.endOffset ||
    left.severity.localeCompare(right.severity) ||
    left.code.localeCompare(right.code)
  );
}

function uniqueSortedDiagnostics(values) {
  const unique = new Map();
  for (const value of values) {
    const key = JSON.stringify([
      value.startOffset,
      value.endOffset,
      value.severity,
      value.code,
      value.message,
    ]);
    if (!unique.has(key)) {
      unique.set(key, value);
    }
  }
  return [...unique.values()].sort(compareDiagnostics);
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

function reasonMessage(reason) {
  const message = reasonMessages[reason];
  if (message === undefined) {
    throw new Error(`No diagnostic message for ${reason}.`);
  }
  return message;
}

function outcomeSeverity(outcome) {
  const severity = outcomeSeverities[outcome];
  if (severity === undefined) {
    throw new Error(`No diagnostic severity for ${outcome}.`);
  }
  return severity;
}

function codeFor(reason) {
  return reason.replaceAll("_", "-");
}

// A structured issue always spans the source range its grammar rule matched, so
// prefix maxima over the sorted issue starts decide containment in one scan.
function structuredCoverage(issues) {
  const starts = [];
  const maximumEnds = [];
  const zeroWidth = new Set();
  let maximumEnd = -1;
  const sorted = issues
    .map(({ node }) => ({ start: node.startIndex, end: node.endIndex }))
    .sort((left, right) => left.start - right.start || left.end - right.end);
  for (const { start, end } of sorted) {
    starts.push(start);
    maximumEnd = Math.max(maximumEnd, end);
    maximumEnds.push(maximumEnd);
    if (start === end) {
      zeroWidth.add(start);
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

function nativeDiagnostics(findings, issues) {
  if (findings.length === 0) {
    return [];
  }
  const coveredByStructuredIssue = structuredCoverage(issues);
  return findings
    .filter((finding) => {
      if (
        (finding.kind === "error" && finding.hasErrorDescendant) ||
        (finding.kind === "missing" && finding.errorAncestor)
      ) {
        return false;
      }
      return !coveredByStructuredIssue(finding);
    })
    .map((finding) =>
      finding.kind === "error"
        ? diagnosticForNode(
            finding.node,
            "error",
            "syntax-error",
            "Syntax error.",
          )
        : diagnosticForNode(
            finding.node,
            "error",
            "missing-syntax",
            `Missing ${finding.node.type.replaceAll("_", " ")}.`,
          ),
    );
}

function syntaxDiagnostics(index) {
  const { nativeIssues, structuredIssues } = index;
  return [
    ...structuredIssues.map((issue) =>
      diagnosticForNode(
        issue.node,
        outcomeSeverity(issue.outcome),
        codeFor(issue.reason),
        reasonMessage(issue.reason),
      ),
    ),
    ...nativeDiagnostics(nativeIssues, structuredIssues),
  ];
}

// An input-line set is an arithmetic progression `{minimum, maximum, stride}`
// over positive line numbers. A null maximum is unbounded, and a zero stride
// means the set holds the single line `minimum`.

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

// POSIX numbers back-references \1 through \9, so no expression needs more.
const portableGroupLimit = 9;

function backreferenceNumber(source, reference) {
  return Number(textForNode(source, reference).at(-1));
}

function regexContainers(index) {
  return [
    ...indexedNodes(index, "context_address"),
    ...indexedNodes(index, "substitute_function"),
  ].sort(
    (left, right) =>
      left.startIndex - right.startIndex || left.endIndex - right.endIndex,
  );
}

// Entry n-1 holds the closing token of the nth subexpression, or undefined when
// that subexpression is absent or never closed.
function groupClosings(index, expression, mode) {
  const openingType =
    mode === "bre" ? "back_open_parenthesis" : "open_parenthesis";
  const closingTokenType =
    mode === "bre" ? "back_close_parenthesis_token" : "close_parenthesis_token";
  return indexedDescendants(
    index,
    openingType,
    expression,
    portableGroupLimit,
  ).map((opening) => {
    const group = opening.parent;
    if (group === null) {
      throw new Error(`${opening.type} must have a parent group.`);
    }
    return group
      .childForFieldName("closing")
      ?.namedChildren.find(({ type }) => type === closingTokenType);
  });
}

function cachedGroupCounter(index, mode) {
  const counts = new Map();
  return (expression) => {
    let count = counts.get(expression.id);
    if (count === undefined) {
      count = groupClosings(index, expression, mode).filter(
        (closing) => closing !== undefined,
      ).length;
      counts.set(expression.id, count);
    }
    return count;
  };
}

// The regular expression is complete once the delimiter that ends it is
// present: s uses its middle delimiter and a context address its closing one.
function hasTerminatingRegexDelimiter(container) {
  const field = container.type === "substitute_function" ? "middle" : "closing";
  const delimiter = container.childForFieldName(field);
  return (
    delimiter !== null && descendants(delimiter, "delimiter_token").length > 0
  );
}

function emptyRegularExpressionDiagnostic(container) {
  const opening = container.childForFieldName("opening");
  const offset = opening?.endIndex ?? container.startIndex;
  return diagnosticForOffsets(
    offset,
    offset,
    "warning",
    "empty-regular-expression-without-previous",
    "This empty regular expression can be reached before any previous regular expression.",
  );
}

function replacementBackreferenceDiagnostic(number, reference, definite) {
  return diagnosticForNode(
    reference,
    "warning",
    "unmatched-replacement-backreference",
    definite
      ? `Replacement back-reference \\${number} has no corresponding subexpression in this regular expression.`
      : `Replacement back-reference \\${number} can refer to a regular expression with fewer subexpressions.`,
  );
}

// Only these functions can observe whether their command was selected; every
// other command needs address tracking solely for its context expressions.
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

function addressChild(address, type) {
  return address?.namedChildren.find((child) => child.type === type);
}

function addressClause(command) {
  return command.childForFieldName("addresses");
}

function trackedUnit(unit) {
  const clause = addressClause(unit.command);
  return (
    selectionSensitiveFunctions.has(unit.functionNode?.type) ||
    (clause !== null && descendants(clause, "context_address").length > 0)
  );
}

// Input line numbers are abstracted by the regions they fall in: every address
// value gets its own region, and the gaps between them share one.
function lineMetadata(snapshot, units) {
  const boundaries = new Map([["1", 1n]]);
  const rangeByCommand = new Map();
  const trackedByCommand = new Map();
  let rangeCount = 0;
  for (const unit of units) {
    if (unit.kind !== "command") {
      continue;
    }
    const tracked = trackedUnit(unit);
    trackedByCommand.set(unit.command.id, tracked);
    const clause = tracked ? addressClause(unit.command) : null;
    if (clause === null) {
      continue;
    }
    for (const address of descendants(clause, "line_number_address")) {
      const value = countToken(snapshot.source, address);
      if (value !== undefined && value >= 1n) {
        boundaries.set(value.toString(), value);
      }
    }
    if (clause.childForFieldName("second") !== null) {
      rangeByCommand.set(unit.command.id, rangeCount);
      rangeCount += 1;
    }
  }
  const regions = [];
  let next = 1n;
  for (const boundary of [...boundaries.values()].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  )) {
    if (next < boundary) {
      regions.push({ minimum: next, maximum: boundary - 1n });
    }
    regions.push({ minimum: boundary, maximum: boundary });
    next = boundary + 1n;
  }
  regions.push({ minimum: next, maximum: null });
  return { rangeByCommand, rangeCount, regions, trackedByCommand };
}

function isLineTracked(metadata, command) {
  return metadata.trackedByCommand.get(command.id) === true;
}

// One BigInt word per 64 ranges is copied into every state a unit learns.
function stateWorkCost(metadata) {
  return 1 + Math.ceil(metadata.rangeCount / 64);
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

function lineStateKey(state) {
  return [
    state.groupCount === null ? "none" : state.groupCount,
    Number(state.substituted),
    Number(state.lastLine),
    state.region,
  ].join(":");
}

// Every range starts out searching for its first address, and the first input
// line may or may not also be the last one.
function initialLineStates(metadata) {
  const allRanges =
    metadata.rangeCount === 0 ? 0n : (1n << BigInt(metadata.rangeCount)) - 1n;
  return [false, true].map((lastLine) => ({
    groupCount: null,
    substituted: false,
    lastLine,
    region: regionForLine(metadata.regions, 1n),
    line: { minimum: 1n, maximum: 1n, stride: 0n },
    searching: allRanges,
    active: 0n,
    closedThisLine: 0n,
  }));
}

function mergeLineStates(current, incoming, metadata) {
  const line = joinIntervals(
    current.line,
    incoming.line,
    metadata.regions[incoming.region],
  );
  const searching = current.searching | incoming.searching;
  const active = current.active | incoming.active;
  const closedThisLine = current.closedThisLine | incoming.closedThisLine;
  if (
    sameInterval(current.line, line) &&
    searching === current.searching &&
    active === current.active &&
    closedThisLine === current.closedThisLine
  ) {
    return undefined;
  }
  return { ...current, line, searching, active, closedThisLine };
}

function withLine(state, line, regions) {
  return { ...state, region: regionForLine(regions, line.minimum), line };
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

function advanceLineStates(state, metadata, inputAdvances) {
  let states = [state];
  for (let count = 0; count < inputAdvances; count += 1) {
    states = states.flatMap((current) =>
      advanceInput(current, metadata.regions),
    );
  }
  return states;
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

function evaluateAddress(snapshot, address, state, regions) {
  const context = addressChild(address, "context_address");
  if (context !== undefined) {
    return [
      { state, matches: true, context },
      { state, matches: false, context },
    ];
  }
  const lineNumber = addressChild(address, "line_number_address");
  if (lineNumber !== undefined) {
    const number = countToken(snapshot.source, lineNumber);
    if (number !== undefined) {
      if (number < 1n) {
        return [{ state, matches: false }];
      }
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

function numericRangeEndBranches(state, number, regions) {
  const before = restrictStateLine(state, 1n, number - 1n, regions);
  const atOrAfter = restrictStateLine(state, number, null, regions);
  return [
    ...(before === undefined ? [] : [{ state: before, matches: false }]),
    ...(atOrAfter === undefined ? [] : [{ state: atOrAfter, matches: true }]),
  ];
}

function rangeEndNumber(snapshot, address) {
  const numeric = addressChild(address, "line_number_address");
  return numeric === undefined
    ? undefined
    : countToken(snapshot.source, numeric);
}

function rangeAddressBranches(snapshot, clause, state, range, regions) {
  const first = clause.childForFieldName("first");
  const second = clause.childForFieldName("second");
  const bit = 1n << BigInt(range);
  const result = [];
  if ((state.searching & bit) !== 0n) {
    for (const branch of evaluateAddress(snapshot, first, state, regions)) {
      if (!branch.matches) {
        result.push({
          state: setRangePhase(branch.state, bit, "searching"),
          selected: false,
          context: branch.context,
        });
        continue;
      }
      // A range that starts here only ends on the same line when its numeric
      // end address is already reached; a context end is tested from the next.
      const number = rangeEndNumber(snapshot, second);
      const started =
        number === undefined
          ? [{ state: branch.state, matches: false }]
          : numericRangeEndBranches(branch.state, number, regions);
      for (const end of started) {
        result.push({
          state: setRangePhase(
            end.state,
            bit,
            end.matches ? "closedThisLine" : "active",
          ),
          selected: true,
          context: branch.context,
        });
      }
    }
  }
  if ((state.active & bit) !== 0n) {
    const number = rangeEndNumber(snapshot, second);
    const ends =
      number === undefined
        ? evaluateAddress(snapshot, second, state, regions)
        : numericRangeEndBranches(state, number, regions);
    for (const branch of ends) {
      result.push({
        state: setRangePhase(
          branch.state,
          bit,
          branch.matches ? "closedThisLine" : "active",
        ),
        selected: true,
        context: branch.context,
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

// Reports every way the command's addresses can select or skip this state,
// together with the context address each way evaluated.
function commandAddressBranches(snapshot, metadata, command, state) {
  const clause = addressClause(command);
  let branches;
  if (clause === null) {
    branches = [{ state, selected: true }];
  } else if (clause.childForFieldName("second") === null) {
    branches = evaluateAddress(
      snapshot,
      clause.childForFieldName("first"),
      state,
      metadata.regions,
    ).map(({ state: next, matches, context }) => ({
      state: next,
      selected: matches,
      context,
    }));
  } else {
    branches = rangeAddressBranches(
      snapshot,
      clause,
      state,
      metadata.rangeByCommand.get(command.id),
      metadata.regions,
    );
  }
  const negated = command.childForFieldName("negation") !== null;
  return branches.map(({ context, selected, state: next }) => ({
    context,
    selected: negated ? !selected : selected,
    state: next,
  }));
}

const portableDuplicationLimit = 255n;
const portableRegularExpressionLength = 256;
const portableLabelLength = 8;
const portableWfileCount = 10;

// POSIX states its limits in bytes, but the on-disk encoding of the script is
// outside this analysis, so every limit is checked against decoded characters.
function characterCountExceeds(value, maximum) {
  let count = 0;
  for (const _character of value) {
    count += 1;
    if (count > maximum) {
      return true;
    }
  }
  return false;
}

function patternBackreferenceDiagnostics(snapshot, index, containers) {
  if (snapshot.mode !== "bre") {
    return [];
  }
  const { source } = snapshot;
  const result = [];
  for (const container of containers) {
    const expression = container.childForFieldName("expression");
    if (expression === null) {
      continue;
    }
    const closings = groupClosings(index, expression, "bre");
    for (const reference of indexedDescendants(
      index,
      "backreference",
      expression,
    )) {
      const number = backreferenceNumber(source, reference);
      const closing = closings[number - 1];
      if (closing === undefined || closing.endIndex > reference.startIndex) {
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

function intervalDiagnostics(snapshot, index) {
  const { source } = snapshot;
  const result = [];
  for (const interval of [
    ...indexedNodes(index, "bre_dupl_symbol"),
    ...indexedNodes(index, "ere_dupl_symbol"),
  ]) {
    const minimumNode = interval.childForFieldName("minimum");
    if (minimumNode === null || hasIssue(index, interval)) {
      continue;
    }
    const maximumNode = interval.childForFieldName("maximum");
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

function regularExpressionLengthDiagnostics(snapshot, containers) {
  const result = [];
  for (const container of containers) {
    const expression = container.childForFieldName("expression");
    if (
      expression !== null &&
      characterCountExceeds(
        textForNode(snapshot.source, expression),
        portableRegularExpressionLength,
      )
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

function substitutionFlagDiagnostics(snapshot, index) {
  const result = [];
  for (const flags of indexedNodes(index, "substitution_flags")) {
    const hasGlobal = descendants(flags, "global_flag").length > 0;
    for (const occurrence of descendants(flags, "occurrence_flag")) {
      if (countToken(snapshot.source, occurrence) === 0n) {
        result.push(
          diagnosticForNode(
            occurrence,
            "error",
            "invalid-substitution-flag",
            reasonMessages.invalid_substitution_flag,
          ),
        );
      } else if (hasGlobal) {
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
  }
  return result;
}

function localeIndependentCharacter(character) {
  return character.codePointAt(0) <= 0x7f;
}

async function translationEntries(source, string, checkpoint) {
  const entries = [];
  if (string === null) {
    return { entries, localeIndependent: true };
  }
  let localeIndependent = true;
  let processed = 0;
  for (const component of string.namedChildren) {
    const text = textForNode(source, component);
    if (component.type === "translation_literal") {
      let offset = component.startIndex;
      for (const character of text) {
        processed += 1;
        if (checkpoint !== undefined && processed % checkpointInterval === 0) {
          await checkpoint();
        }
        entries.push({
          value: character,
          startIndex: offset,
          endIndex: offset + character.length,
        });
        localeIndependent &&= localeIndependentCharacter(character);
        offset += character.length;
      }
      continue;
    }
    let value;
    if (component.type === "translation_escaped_delimiter") {
      value = Array.from(text).at(-1);
    } else if (component.type === "translation_escape") {
      value = text === "\\n" ? "\n" : text === "\\\\" ? "\\" : undefined;
    } else {
      continue;
    }
    if (value === undefined) {
      localeIndependent = false;
      continue;
    }
    entries.push({
      value,
      startIndex: component.startIndex,
      endIndex: component.endIndex,
    });
    localeIndependent &&= localeIndependentCharacter(value);
  }
  return { entries, localeIndependent };
}

function knownTranslationBoundary(index, boundary) {
  return boundary !== null && !hasIssue(index, boundary);
}

function knownTranslationString(index, string) {
  return string === null || !hasIssue(index, string);
}

async function translationDiagnostics(snapshot, index, checkpoint) {
  const { source } = snapshot;
  const result = [];
  for (const translate of indexedNodes(index, "translate_function")) {
    const first = translate.childForFieldName("string1");
    const second = translate.childForFieldName("string2");
    const opening = translate.childForFieldName("opening");
    const middle = translate.childForFieldName("middle");
    const closing = translate.childForFieldName("closing");
    const firstAnalysis = await translationEntries(source, first, checkpoint);
    const secondAnalysis = await translationEntries(source, second, checkpoint);
    const firstDelimited =
      knownTranslationBoundary(index, opening) &&
      knownTranslationBoundary(index, middle);
    const secondDelimited =
      knownTranslationBoundary(index, middle) &&
      knownTranslationBoundary(index, closing);
    if (
      firstDelimited &&
      secondDelimited &&
      knownTranslationString(index, first) &&
      knownTranslationString(index, second) &&
      firstAnalysis.localeIndependent &&
      secondAnalysis.localeIndependent &&
      firstAnalysis.entries.length !== secondAnalysis.entries.length
    ) {
      const emptyOffset = middle?.endIndex ?? translate.endIndex;
      result.push(
        second === null
          ? diagnosticForOffsets(
              emptyOffset,
              emptyOffset,
              "warning",
              "translation-length-mismatch",
              "The two translation strings contain different numbers of decoded characters.",
            )
          : diagnosticForNode(
              second,
              "warning",
              "translation-length-mismatch",
              "The two translation strings contain different numbers of decoded characters.",
            ),
      );
    }
    if (!firstDelimited) {
      continue;
    }
    const seen = new Set();
    for (const entry of firstAnalysis.entries) {
      if (seen.has(entry.value)) {
        result.push(
          diagnosticForOffsets(
            entry.startIndex,
            entry.endIndex,
            "warning",
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
    if (characterCountExceeds(symbol.name, portableLabelLength)) {
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

function wfileDiagnostics(snapshot, index) {
  const result = [];
  const distinct = new Set();
  for (const wfile of indexedNodes(index, "wfile")) {
    const name = textForNode(snapshot.source, wfile);
    if (distinct.has(name)) {
      continue;
    }
    distinct.add(name);
    if (distinct.size > portableWfileCount) {
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

// A replacement back-reference is checked against its own expression whenever
// the s command has one. An empty expression reuses the previous regular
// expression, so those references are left to the flow analysis.
function replacementBackreferences(snapshot, index, countGroups) {
  const diagnostics = [];
  const bySubstitute = new Map();
  for (const substitute of indexedNodes(index, "substitute_function")) {
    const expression = substitute.childForFieldName("expression");
    for (const reference of indexedDescendants(
      index,
      "replacement_backreference",
      substitute,
    )) {
      const number = backreferenceNumber(snapshot.source, reference);
      if (number === 0) {
        diagnostics.push(
          diagnosticForNode(
            reference,
            "warning",
            "unmatched-replacement-backreference",
            "Replacement back-reference \\0 has no corresponding POSIX regular-expression subexpression.",
          ),
        );
      } else if (expression !== null) {
        if (number > countGroups(expression)) {
          diagnostics.push(
            replacementBackreferenceDiagnostic(number, reference, true),
          );
        }
      } else if (hasTerminatingRegexDelimiter(substitute)) {
        const matching = bySubstitute.get(substitute.id) ?? [];
        matching.push(reference);
        bySubstitute.set(substitute.id, matching);
      }
    }
  }
  return { bySubstitute, diagnostics };
}

async function operandDiagnostics(snapshot, index, containers, checkpoint) {
  return [
    ...patternBackreferenceDiagnostics(snapshot, index, containers),
    ...intervalDiagnostics(snapshot, index),
    ...regularExpressionLengthDiagnostics(snapshot, containers),
    ...substitutionFlagDiagnostics(snapshot, index),
    ...(await translationDiagnostics(snapshot, index, checkpoint)),
    ...labelDiagnostics(index.symbols),
    ...wfileDiagnostics(snapshot, index),
  ];
}

// Reaching the end of the script ends the cycle: sed reads the next input line
// and resumes at the first command.
const cycleRestart = -1;

function directCommands(commandList) {
  return commandList.namedChildren.filter(
    ({ type }) => type === "editing_command",
  );
}

// Wires every command to the command that follows it, entering each block body
// with the block's own successor as the body's continuation.
function wireCommandLists(rootList, unitByCommand) {
  const rootCommands = directCommands(rootList);
  const stack = [
    {
      commands: rootCommands,
      index: rootCommands.length - 1,
      next: cycleRestart,
    },
  ];
  while (stack.length > 0) {
    const frame = stack.at(-1);
    if (frame.index < 0) {
      stack.pop();
      if (frame.blockUnit === undefined) {
        return frame.next;
      }
      frame.blockUnit.blockEntry = frame.next;
      continue;
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
  return cycleRestart;
}

function labelTargets(symbols, unitByCommand) {
  const labels = new Map();
  for (const symbol of symbols) {
    if (symbol.kind !== "definition" || symbol.command === undefined) {
      continue;
    }
    const unit = unitByCommand.get(symbol.command.id);
    if (unit !== undefined) {
      const targets = labels.get(symbol.name) ?? [];
      targets.push(unit.id);
      labels.set(symbol.name, targets);
    }
  }
  return labels;
}

// A command is selected by its addresses, always applied when it has none, and
// never applied when a lone negation inverts that unconditional selection.
function selectionOf(command) {
  if (command.childForFieldName("addresses") !== null) {
    return { canApply: true, canSkip: true };
  }
  const negated = command.childForFieldName("negation") !== null;
  return { canApply: !negated, canSkip: negated };
}

function createControlFlow(source, root, symbols, commands) {
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

  const rootList = root.namedChildren.find(
    ({ type }) => type === "command_list",
  );
  if (rootList === undefined) {
    return { entry: undefined, units };
  }
  const firstCommand = wireCommandLists(rootList, unitByCommand);
  const entry = firstCommand === cycleRestart ? undefined : firstCommand;
  const labels = labelTargets(symbols, unitByCommand);

  function edge(
    target,
    route,
    inputAdvances = Number(target === cycleRestart),
  ) {
    return {
      target: target === cycleRestart ? entry : target,
      route,
      inputAdvances,
    };
  }

  // Several definitions of one label are reachable through the same branch, so
  // they share a dispatch unit instead of duplicating edges per branch.
  const dispatchByLabel = new Map();
  function labelDestination(name) {
    const targets = labels.get(name);
    if (targets === undefined) {
      return cycleRestart;
    }
    if (targets.length === 1) {
      return targets[0];
    }
    let destination = dispatchByLabel.get(name);
    if (destination === undefined) {
      destination = units.length;
      units.push({
        id: destination,
        kind: "dispatch",
        edges: targets.map((target) => edge(target, "dispatch")),
      });
      dispatchByLabel.set(name, destination);
    }
    return destination;
  }

  function branchTarget(unit) {
    const label = unit.functionNode.childForFieldName("label");
    return label === null
      ? cycleRestart
      : labelDestination(textForNode(source, label));
  }

  for (const unit of commandUnits) {
    const { canApply, canSkip } = selectionOf(unit.command);
    const type = unit.functionNode?.type;
    if (canApply) {
      if (type === "block_function") {
        unit.edges.push(edge(unit.blockEntry, "applied"));
      } else if (type === "branch_function") {
        unit.edges.push(edge(branchTarget(unit), "applied"));
      } else if (type === "test_function") {
        unit.edges.push(edge(branchTarget(unit), "test-branch"));
        unit.edges.push(edge(unit.fallthrough, "test-fallthrough"));
      } else if (type === "change_function" || type === "delete_function") {
        unit.edges.push(edge(cycleRestart, "applied"));
      } else if (type === "delete_first_line_function") {
        // D deletes through the first newline and restarts the script without
        // reading, or behaves like d when the pattern space holds no newline.
        unit.edges.push(edge(cycleRestart, "applied"));
        unit.edges.push(edge(entry, "applied", 0));
      } else if (type === "next_function" || type === "next_append_function") {
        unit.edges.push(
          edge(
            unit.fallthrough,
            "applied",
            1 + Number(unit.fallthrough === cycleRestart),
          ),
        );
      } else if (type !== "quit_function") {
        unit.edges.push(edge(unit.fallthrough, "applied"));
      }
    }
    if (canSkip) {
      unit.edges.push(edge(unit.fallthrough, "skipped"));
    }
  }
  return { entry, units };
}

// Bounds the precise analysis. Scripts that exceed it fall back to flow facts
// that ignore input line numbers and two-address range phases.
const regexFlowWorkBudget = 100_000;

function createDiagnosticCollector() {
  const reported = new Map();
  return {
    report(value) {
      reported.set(
        [value.code, value.startOffset, value.endOffset].join(":"),
        value,
      );
    },
    values() {
      return [...reported.values()];
    },
  };
}

// An empty regular expression reuses the last one POSIX considers used, which
// the state tracks as the number of subexpressions that expression contained.

function checkRegularExpression(container, state, report) {
  if (
    hasTerminatingRegexDelimiter(container) &&
    container.childForFieldName("expression") === null &&
    state.groupCount === null
  ) {
    report(emptyRegularExpressionDiagnostic(container));
  }
}

function transferRegularExpression(container, state, countGroups) {
  const expression = container.childForFieldName("expression");
  if (!hasTerminatingRegexDelimiter(container) || expression === null) {
    return state;
  }
  return { ...state, groupCount: countGroups(expression) };
}

function evaluateContextAddress(context, state, selected, analysis) {
  if (context === undefined) {
    return state;
  }
  checkRegularExpression(context, state, analysis.report);
  return selected
    ? transferRegularExpression(context, state, analysis.countGroups)
    : state;
}

// A substitution either matched or did not, and only a matching one can make a
// later t command branch.
function substituteStates(substitute, input, analysis) {
  checkRegularExpression(substitute, input, analysis.report);
  const state = transferRegularExpression(
    substitute,
    input,
    analysis.countGroups,
  );
  for (const reference of analysis.referencesBySubstitute.get(substitute.id) ??
    []) {
    const number = backreferenceNumber(analysis.snapshot.source, reference);
    if (state.groupCount === null || state.groupCount < number) {
      analysis.report(
        replacementBackreferenceDiagnostic(number, reference, false),
      );
    }
  }
  return state.substituted ? [state] : [state, { ...state, substituted: true }];
}

function appliedStates(unit, inputs, analysis) {
  if (unit.functionNode?.type !== "substitute_function") {
    return inputs;
  }
  return inputs.flatMap((input) =>
    substituteStates(unit.functionNode, input, analysis),
  );
}

function routeOutputs(unit, skipped, applied, propagate) {
  for (const edge of unit.edges) {
    if (edge.route === "skipped") {
      for (const state of skipped) {
        propagate(edge, state);
      }
    } else if (edge.route === "test-branch") {
      for (const state of applied) {
        if (state.substituted) {
          propagate(edge, { ...state, substituted: false });
        }
      }
    } else if (edge.route === "test-fallthrough") {
      for (const state of applied) {
        if (!state.substituted) {
          propagate(edge, state);
        }
      }
    } else {
      for (const state of applied) {
        propagate(edge, state);
      }
    }
  }
}

// Runs states along control-flow edges until every unit has seen every state a
// reachable execution can give it, or until the work budget is spent.
async function propagateStates(units, strategy, checkpoint) {
  const incoming = units.map(() => new Map());
  const queue = [];
  const queued = new Set();
  let queueIndex = 0;
  let remainingWork = strategy.budget;
  let processed = 0;
  let exhausted = false;

  function addState(unit, state) {
    if (unit === undefined || exhausted) {
      return;
    }
    const key = strategy.keyFor(state);
    const destination = incoming[unit];
    const current = destination.get(key);
    let next = state;
    if (current !== undefined) {
      next = strategy.merge(current, state);
      if (next === undefined) {
        return;
      }
    }
    destination.set(key, next);
    const queueKey = `${unit}/${key}`;
    if (queued.has(queueKey)) {
      return;
    }
    remainingWork -= strategy.workPerState;
    if (remainingWork < 0) {
      exhausted = true;
      return;
    }
    queue.push({ key, queueKey, unit });
    queued.add(queueKey);
  }

  function propagate(edge, state) {
    if (edge.target === undefined || exhausted) {
      return;
    }
    for (const next of strategy.advance(state, edge.inputAdvances)) {
      addState(edge.target, next);
    }
  }

  for (const seed of strategy.seeds) {
    addState(strategy.entry, seed);
  }
  while (queueIndex < queue.length && !exhausted) {
    processed += 1;
    if (checkpoint !== undefined && processed % checkpointInterval === 0) {
      await checkpoint();
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
    strategy.step(unit, state, propagate);
  }
  return exhausted;
}

async function preciseFlowDiagnostics(context, checkpoint) {
  const collector = createDiagnosticCollector();
  const analysis = { ...context, report: collector.report };
  const { entry, snapshot, units } = analysis;
  const metadata = lineMetadata(snapshot, units);
  const exhausted = await propagateStates(
    units,
    {
      budget: regexFlowWorkBudget,
      entry,
      keyFor: lineStateKey,
      seeds: initialLineStates(metadata),
      workPerState: stateWorkCost(metadata),
      merge: (current, state) => mergeLineStates(current, state, metadata),
      advance: (state, inputAdvances) =>
        advanceLineStates(state, metadata, inputAdvances),
      step(unit, state, propagate) {
        if (!isLineTracked(metadata, unit.command)) {
          // Nothing this command observes depends on the input line, so its
          // routes collapse to their distinct targets.
          const unique = new Map();
          for (const edge of unit.edges) {
            unique.set(`${String(edge.target)}/${edge.inputAdvances}`, edge);
          }
          for (const edge of unique.values()) {
            propagate(edge, state);
          }
          return;
        }
        const skipped = [];
        const selected = [];
        for (const branch of commandAddressBranches(
          snapshot,
          metadata,
          unit.command,
          state,
        )) {
          (branch.selected ? selected : skipped).push(
            evaluateContextAddress(
              branch.context,
              branch.state,
              branch.selected,
              analysis,
            ),
          );
        }
        routeOutputs(
          unit,
          skipped,
          appliedStates(unit, selected, analysis),
          propagate,
        );
      },
    },
    checkpoint,
  );
  return exhausted ? undefined : collector.values();
}

// Coarse analysis treats every address as evaluable on any line, retaining only
// the previous regular expression and the substitution flag.
function coarseStateKey(state) {
  return `${state.groupCount === null ? "none" : state.groupCount}:${Number(state.substituted)}`;
}

function coarseAddressState(address, state, analysis) {
  return evaluateContextAddress(
    addressChild(address, "context_address"),
    state,
    true,
    analysis,
  );
}

function coarseCommandBranches(command, state, analysis) {
  const clause = addressClause(command);
  if (clause === null) {
    return command.childForFieldName("negation") === null
      ? { selected: [state], skipped: [] }
      : { selected: [], skipped: [state] };
  }
  const first = clause.childForFieldName("first");
  const second = clause.childForFieldName("second");
  if (second === null) {
    return {
      selected: [coarseAddressState(first, state, analysis)],
      skipped: [state],
    };
  }
  const unique = new Map();
  for (const value of [
    state,
    coarseAddressState(first, state, analysis),
    coarseAddressState(second, state, analysis),
  ]) {
    unique.set(coarseStateKey(value), value);
  }
  const possible = [...unique.values()];
  return { selected: possible, skipped: possible };
}

async function coarseFlowDiagnostics(context, checkpoint) {
  const collector = createDiagnosticCollector();
  const analysis = { ...context, report: collector.report };
  await propagateStates(
    analysis.units,
    {
      budget: Number.POSITIVE_INFINITY,
      entry: analysis.entry,
      keyFor: coarseStateKey,
      merge: () => undefined,
      seeds: [{ groupCount: null, substituted: false }],
      workPerState: 0,
      advance: (state, inputAdvances) => [
        inputAdvances === 0 ? state : { ...state, substituted: false },
      ],
      step(unit, state, propagate) {
        const branches = coarseCommandBranches(unit.command, state, analysis);
        routeOutputs(
          unit,
          branches.skipped,
          appliedStates(unit, branches.selected, analysis),
          propagate,
        );
      },
    },
    checkpoint,
  );
  return collector.values();
}

// Only an empty regular expression or a replacement back-reference that reuses
// one needs the previous regular expression, so nothing else runs the analysis.
function needsFlowAnalysis(containers, referencesBySubstitute) {
  return (
    referencesBySubstitute.size > 0 ||
    containers.some(
      (container) =>
        hasTerminatingRegexDelimiter(container) &&
        container.childForFieldName("expression") === null,
    )
  );
}

async function regexFlowDiagnostics(
  snapshot,
  index,
  containers,
  referencesBySubstitute,
  countGroups,
  checkpoint,
) {
  if (!needsFlowAnalysis(containers, referencesBySubstitute)) {
    return [];
  }
  const { entry, units } = createControlFlow(
    snapshot.source,
    snapshot.tree.rootNode,
    index.symbols,
    indexedNodes(index, "editing_command"),
  );
  if (entry === undefined) {
    return [];
  }
  const context = {
    countGroups,
    entry,
    referencesBySubstitute,
    snapshot,
    units,
  };
  return (
    (await preciseFlowDiagnostics(context, checkpoint)) ??
    (await coarseFlowDiagnostics(context, checkpoint))
  );
}

const semanticNodeTypes = new Set([
  "back_open_parenthesis",
  "backreference",
  "bre_dupl_symbol",
  "context_address",
  "delimiter",
  "editing_command",
  "ere_dupl_symbol",
  "open_parenthesis",
  "replacement_backreference",
  "substitute_function",
  "substitution_flags",
  "translate_function",
  "translation_string",
  "wfile",
]);

export function diagnosticMessages() {
  return reasonMessages;
}

export function diagnosticSeverities() {
  return outcomeSeverities;
}

export async function analyzeDiagnostics(snapshot, { checkpoint } = {}) {
  const index = await cstIndex(
    snapshot.source,
    snapshot.tree.rootNode,
    semanticNodeTypes,
    { checkpoint },
  );
  await checkpoint?.();
  const containers = regexContainers(index);
  const countGroups = cachedGroupCounter(index, snapshot.mode);
  const replacements = replacementBackreferences(snapshot, index, countGroups);
  return uniqueSortedDiagnostics([
    ...syntaxDiagnostics(index),
    ...(await operandDiagnostics(snapshot, index, containers, checkpoint)),
    ...replacements.diagnostics,
    ...(await regexFlowDiagnostics(
      snapshot,
      index,
      containers,
      replacements.bySubstitute,
      countGroups,
      checkpoint,
    )),
  ]);
}

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

function diagnostic(document, node, severity, code, message) {
  return {
    range: rangeForNode(document, node),
    severity,
    code,
    source: diagnosticSource,
    message,
  };
}

function diagnosticAt(document, startIndex, endIndex, code, message) {
  return {
    range: {
      start: document.positionAt(startIndex),
      end: document.positionAt(endIndex),
    },
    severity: DiagnosticSeverity.Warning,
    code,
    source: diagnosticSource,
    message,
  };
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
          diagnostic(
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
          diagnostic(
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
        diagnostic(
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
        diagnostic(
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
        diagnostic(
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
        diagnostic(
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
        diagnostic(
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
        diagnostic(
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
        diagnostic(
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
        diagnostic(
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
        diagnostic(
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

export function semanticDiagnostics(snapshot) {
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

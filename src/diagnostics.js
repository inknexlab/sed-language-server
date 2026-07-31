import { DiagnosticSeverity } from "vscode-languageserver";
import { nativeIssues, rangeForNode, structuredIssues } from "./cst.js";
import { semanticDiagnostics } from "./semantics.js";

const diagnosticSource = "sed-language-server";

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

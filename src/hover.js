import { MarkupKind } from "vscode-languageserver";
import { rangeForNode, textForNode } from "./cst.js";

const commandReferenceByVerb = Object.freeze({
  "{": {
    title: "Command Block",
    synopsis: "[address[,address]]{ … }",
    description:
      "Executes the enclosed editing commands when the current pattern space is selected.",
  },
  a: {
    title: "Append Text",
    synopsis: "[address]a\\\ntext",
    description:
      "Schedules text for standard output before the next input fetch, before `q`, or at the end of the script.",
  },
  b: {
    title: "Branch",
    synopsis: "[address[,address]]b [label]",
    description:
      "Branches to label, or to the end of the script when label is omitted.",
  },
  c: {
    title: "Change Text",
    synopsis: "[address[,address]]c\\\ntext",
    description:
      "Deletes the pattern space, writes text once for the selected line or completed range, and starts the next cycle.",
  },
  d: {
    title: "Delete",
    synopsis: "[address[,address]]d",
    description: "Deletes the pattern space and starts the next cycle.",
  },
  D: {
    title: "Delete First Line",
    synopsis: "[address[,address]]D",
    description:
      "Deletes through the first newline and restarts the cycle without reading input, or acts like `d` when no newline exists.",
  },
  g: {
    title: "Get",
    synopsis: "[address[,address]]g",
    description: "Replaces the pattern space with the hold space.",
  },
  G: {
    title: "Get and Append",
    synopsis: "[address[,address]]G",
    description: "Appends a newline and the hold space to the pattern space.",
  },
  h: {
    title: "Hold",
    synopsis: "[address[,address]]h",
    description: "Replaces the hold space with the pattern space.",
  },
  H: {
    title: "Hold and Append",
    synopsis: "[address[,address]]H",
    description: "Appends a newline and the pattern space to the hold space.",
  },
  i: {
    title: "Insert Text",
    synopsis: "[address]i\\\ntext",
    description:
      "Writes text to standard output before continuing with the selected pattern space.",
  },
  l: {
    title: "List",
    synopsis: "[address[,address]]l",
    description:
      "Writes an unambiguous escaped representation of the pattern space.",
  },
  n: {
    title: "Next",
    synopsis: "[address[,address]]n",
    description:
      "Writes the pattern space when default output is enabled, then replaces it with the next input line.",
  },
  N: {
    title: "Append Next Line",
    synopsis: "[address[,address]]N",
    description:
      "Appends a newline and the next input line to the pattern space.",
  },
  p: {
    title: "Print",
    synopsis: "[address[,address]]p",
    description: "Writes the pattern space to standard output.",
  },
  P: {
    title: "Print First Line",
    synopsis: "[address[,address]]P",
    description:
      "Writes the first line of the pattern space to standard output.",
  },
  q: {
    title: "Quit",
    synopsis: "[address]q",
    description:
      "Branches to the end of the script and quits without starting a new cycle.",
  },
  r: {
    title: "Read File",
    synopsis: "[address]r rfile",
    description:
      "Schedules the contents of rfile to be written to standard output.",
  },
  s: {
    title: "Substitute",
    synopsis: "[address[,address]]s/RE/replacement/[flags]",
    description:
      "Replaces instances of RE in the pattern space according to flags.",
  },
  t: {
    title: "Test and Branch",
    synopsis: "[address[,address]]t [label]",
    description:
      "Branches to label if a substitution has occurred since the last input read or previous `t`, or to the end when label is omitted.",
  },
  w: {
    title: "Write File",
    synopsis: "[address[,address]]w wfile",
    description: "Appends the pattern space to wfile.",
  },
  x: {
    title: "Exchange",
    synopsis: "[address[,address]]x",
    description: "Exchanges the pattern and hold spaces.",
  },
  y: {
    title: "Translate",
    synopsis: "[address[,address]]y/string1/string2/",
    description:
      "Replaces each occurrence of a character in string1 with the corresponding character in string2.",
  },
  ":": {
    title: "Label",
    synopsis: ":label",
    description:
      "Defines a label for `b` and `t` without otherwise changing processing.",
  },
  "=": {
    title: "Print Line Number",
    synopsis: "[address]=",
    description: "Writes the current input line number to standard output.",
  },
  "#": {
    title: "Comment",
    synopsis: "#comment",
    description:
      "Ignores the remainder of the line; `#n` as the first two script characters also suppresses default output.",
  },
});

const substitutionFlagReferenceByType = Object.freeze({
  occurrence_flag: {
    title: "Occurrence",
    synopsis: "s/RE/replacement/n",
    description: "Replaces only the nth occurrence of RE in the pattern space.",
  },
  global_flag: {
    title: "Global",
    synopsis: "s/RE/replacement/g",
    description:
      "Replaces all non-overlapping instances of RE rather than only the first.",
  },
  case_insensitive_flag: {
    title: "Case-Insensitive",
    synopsis: "s/RE/replacement/i",
    description: "Matches RE case-insensitively.",
  },
  print_flag: {
    title: "Print on Substitution",
    synopsis: "s/RE/replacement/p",
    description:
      "Writes the pattern space to standard output if a replacement was made.",
  },
  substitution_flag: {
    title: "Write on Substitution",
    synopsis: "s/RE/replacement/w wfile",
    description:
      "Appends the pattern space to wfile if a replacement was made.",
  },
});

const addressReferenceByType = Object.freeze({
  line_number_address: {
    title: "Line Number Address",
    synopsis: "number",
    description:
      "Selects the input line with this cumulative line number across all input files.",
  },
  last_line_address: {
    title: "Last-Line Address",
    synopsis: "$",
    description: "Selects the last line of input.",
  },
});

const addressRangeReference = Object.freeze({
  title: "Address Range",
  synopsis: "address1,address2",
  description:
    "Selects each inclusive range from a pattern space selected by address1 through the next pattern space selected by address2; if address2 is a line number no greater than the first selected line number, only that first pattern space is selected.",
});

const negatedSelectionReference = Object.freeze({
  title: "Negated Selection",
  synopsis: "[address[,address]]!function",
  description:
    "Inverts the address selection that controls whether the editing command is applied.",
});

const replacementReferenceByType = Object.freeze({
  matched_text_reference: {
    title: "Matched Text",
    synopsis: "s/RE/&/",
    description: "Inserts the text matched by RE.",
  },
  escaped_newline: {
    title: "Embedded Newline",
    synopsis: "s/RE/first\\\nsecond/",
    description: "Inserts a newline into the replacement.",
  },
});

const replacementEscapeReferenceBySpelling = Object.freeze({
  "\\&": {
    title: "Literal Ampersand",
    synopsis: "s/RE/\\&/",
    description:
      "Inserts a literal ampersand instead of the text matched by RE.",
  },
  "\\\\": {
    title: "Literal Backslash",
    synopsis: "s/RE/\\\\/",
    description: "Inserts a literal backslash.",
  },
});

const replacementParentByTokenType = Object.freeze({
  matched_text_reference_token: "matched_text_reference",
  replacement_backreference_token: "replacement_backreference",
  escaped_delimiter_token: "replacement_escaped_delimiter",
  replacement_escape_token: "replacement_escape",
  escaped_newline_token: "escaped_newline",
});

const graphicDelimiterPattern = /^[\p{L}\p{N}\p{P}\p{S}]$/u;

function directReferenceForNode(node, spelling) {
  return node.type === "function_verb"
    ? commandReferenceByVerb[spelling]
    : substitutionFlagReferenceByType[node.type];
}

function directTargetForNode(document, node) {
  const spelling = textForNode(document, node);
  const reference = directReferenceForNode(node, spelling);
  return reference === undefined
    ? undefined
    : { node, display: spelling, reference };
}

function delimiterTokenFor(contextAddress, field) {
  const delimiter = contextAddress.childForFieldName(field);
  const token = delimiter?.childForFieldName("token");
  return token?.type === "delimiter_token" ? token : undefined;
}

function isCompleteContextAddress(node) {
  return (
    delimiterTokenFor(node, "opening") !== undefined &&
    delimiterTokenFor(node, "closing") !== undefined
  );
}

function isExcessAddressElement(node) {
  return (
    node.parent?.type === "address" &&
    node.parent?.parent?.type === "excess_address"
  );
}

function isValidAddress(node) {
  if (node?.type !== "address") {
    return false;
  }
  const element = node.namedChild(0);
  if (element === null) {
    return false;
  }
  if (
    element.type === "line_number_address" ||
    element.type === "last_line_address"
  ) {
    return true;
  }
  return (
    element.type === "context_address" && isCompleteContextAddress(element)
  );
}

function contextAddressForFrameNode(node) {
  if (
    node.type === "address_escape" &&
    node.parent?.type === "context_address"
  ) {
    return node.parent;
  }
  const delimiter = node.parent;
  const contextAddress = delimiter?.parent;
  return node.type === "delimiter_token" &&
    delimiter?.type === "delimiter" &&
    contextAddress?.type === "context_address"
    ? contextAddress
    : undefined;
}

function contextAddressTarget(document, selected) {
  const node = contextAddressForFrameNode(selected);
  if (
    node === undefined ||
    !isCompleteContextAddress(node) ||
    isExcessAddressElement(node)
  ) {
    return undefined;
  }
  const opening = delimiterTokenFor(node, "opening");
  if (opening === undefined) {
    return undefined;
  }
  const delimiter = visibleDelimiter(textForNode(document, opening));
  const empty = node.childForFieldName("expression") === null;
  const escaped = node.childForFieldName("escape") !== null;
  const display = escaped
    ? `\\${delimiter}${empty ? "" : "RE"}${delimiter}`
    : empty
      ? "//"
      : "/RE/";
  return {
    node,
    display,
    reference: {
      title: empty ? "Empty Regular Expression" : "Context Address",
      synopsis: display,
      description: empty
        ? "Behaves as if the most recently applied regular expression from a context address or substitute command were specified."
        : "Selects each pattern space that matches RE; use `/RE/` or `\\cREc`, where c is any character other than backslash or newline.",
    },
  };
}

function addressTargetForNode(document, selected) {
  const directReference = addressReferenceByType[selected.type];
  if (directReference !== undefined && !isExcessAddressElement(selected)) {
    return {
      node: selected,
      display: textForNode(document, selected),
      reference: directReference,
    };
  }

  if (selected.type === "address_separator_token") {
    const separator = selected.parent;
    const clause = separator?.parent;
    if (
      separator?.type === "address_separator" &&
      clause?.type === "address_clause" &&
      isValidAddress(clause.childForFieldName("first")) &&
      isValidAddress(clause.childForFieldName("second"))
    ) {
      return {
        node: selected,
        display: textForNode(document, selected),
        reference: addressRangeReference,
      };
    }
    return undefined;
  }

  if (selected.type === "negation_operator") {
    const negation = selected.parent;
    const first = negation?.childForFieldName("operator");
    if (
      negation?.type === "negation" &&
      first?.startIndex === selected.startIndex &&
      first.endIndex === selected.endIndex
    ) {
      return {
        node: selected,
        display: textForNode(document, selected),
        reference: negatedSelectionReference,
      };
    }
    return undefined;
  }

  return contextAddressTarget(document, selected);
}

function replacementNodeForToken(token) {
  const expectedParentType = replacementParentByTokenType[token.type];
  const parent = token.parent;
  return expectedParentType !== undefined && parent?.type === expectedParentType
    ? parent
    : undefined;
}

function visibleDelimiter(delimiter) {
  const codePoint = delimiter.codePointAt(0);
  if (codePoint === 0x20) {
    return "<space>";
  }
  if (codePoint === 0x09) {
    return "<tab>";
  }
  if (codePoint === 0x0d) {
    return "<carriage-return>";
  }
  if (!graphicDelimiterPattern.test(delimiter)) {
    return `<U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}>`;
  }
  return delimiter;
}

function replacementReferenceFor(node, spelling) {
  const reference = replacementReferenceByType[node.type];
  if (reference !== undefined) {
    return reference;
  }
  if (node.type === "replacement_escape") {
    return replacementEscapeReferenceBySpelling[spelling];
  }
  if (node.type === "replacement_backreference") {
    const number = spelling.at(-1);
    if (number === "0") {
      return undefined;
    }
    return {
      title: "Back-Reference",
      synopsis: `s/RE/\\${number}/`,
      description: `Inserts the text matched by regular-expression subexpression ${number}, or an empty string if that subexpression did not match.`,
    };
  }
  if (node.type === "replacement_escaped_delimiter") {
    const delimiter = visibleDelimiter(spelling.slice(1));
    return {
      title: "Literal Delimiter",
      synopsis: `s${delimiter}RE${delimiter}\\${delimiter}${delimiter}`,
      description: "Inserts the substitution delimiter as a literal character.",
    };
  }
  return undefined;
}

function replacementTargetForNode(document, selected) {
  const node = replacementNodeForToken(selected);
  if (node === undefined) {
    return undefined;
  }
  const spelling = textForNode(document, node);
  const reference = replacementReferenceFor(node, spelling);
  if (reference === undefined) {
    return undefined;
  }
  return {
    node,
    display:
      node.type === "escaped_newline"
        ? "\\<newline>"
        : node.type === "replacement_escaped_delimiter"
          ? `\\${visibleDelimiter(spelling.slice(1))}`
          : spelling,
    reference,
  };
}

function targetForNode(document, selected) {
  return (
    directTargetForNode(document, selected) ??
    addressTargetForNode(document, selected) ??
    replacementTargetForNode(document, selected)
  );
}

function maximumBacktickRun(value) {
  let current = 0;
  let maximum = 0;
  for (const character of value) {
    current = character === "`" ? current + 1 : 0;
    maximum = Math.max(maximum, current);
  }
  return maximum;
}

function inlineCode(value) {
  const backticks = maximumBacktickRun(value);
  if (backticks === 0) {
    return `\`${value}\``;
  }
  const fence = "`".repeat(backticks + 1);
  return `${fence} ${value} ${fence}`;
}

function markdownFor(display, reference) {
  return `### ${inlineCode(display)} — ${reference.title}\n\n\`\`\`sed\n${reference.synopsis}\n\`\`\`\n\n${reference.description}`;
}

export function hover(snapshot, position) {
  const { document, tree } = snapshot;
  const offset = document.offsetAt(position);
  const root = tree.rootNode;
  if (offset >= root.endIndex) {
    return undefined;
  }
  const node = root.namedDescendantForIndex(offset, offset + 1);
  if (node === null || offset < node.startIndex || offset >= node.endIndex) {
    return undefined;
  }

  const target = targetForNode(document, node);
  if (target === undefined) {
    return undefined;
  }
  return {
    contents: {
      kind: MarkupKind.Markdown,
      value: markdownFor(target.display, target.reference),
    },
    range: rangeForNode(document, target.node),
  };
}

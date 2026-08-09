import { MarkupKind } from "vscode-languageserver";
import {
  commandReferenceForVerb,
  referenceDocumentation,
  substitutionFlagReferenceForType,
} from "./catalog.js";
import {
  delimiterTokenFor,
  isCompleteContextAddress,
  rangeForNode,
  textForNode,
} from "./cst.js";

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
    ? commandReferenceForVerb(spelling)
    : substitutionFlagReferenceForType(node.type);
}

function directTargetForNode(document, node) {
  const spelling = textForNode(document, node);
  const reference = directReferenceForNode(node, spelling);
  return reference === undefined
    ? undefined
    : { node, display: spelling, reference };
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

function contentsFor(display, reference, kind) {
  const markupKind = kind === null ? MarkupKind.Markdown : kind;
  const documentation = referenceDocumentation(reference, markupKind);
  const value =
    markupKind === MarkupKind.Markdown
      ? `### ${inlineCode(display)} — ${reference.title}\n\n${documentation.value}`
      : `${display} — ${reference.title}\n\n${documentation.value}`;
  return kind === null ? value : { kind, value };
}

export function hover(snapshot, position, contentKind) {
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
    contents: contentsFor(target.display, target.reference, contentKind),
    range: rangeForNode(document, target.node),
  };
}

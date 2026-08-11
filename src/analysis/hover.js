import {
  commandReferenceForVerb,
  substitutionFlagReferenceForType,
} from "./catalog.js";
import {
  delimiterTokenFor,
  isCompleteContextAddress,
  rangeForNode as offsetRangeForNode,
  textForNode,
} from "./cst.js";
import { assertSnapshot } from "./snapshot.js";

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

function directTargetForNode(source, node) {
  const spelling = textForNode(source, node);
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

function contextAddressTarget(source, selected) {
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
  const delimiter = visibleDelimiter(textForNode(source, opening));
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
        : "Selects each pattern space that matches RE; use /RE/ or \\cREc, where c is any character other than backslash or newline.",
    },
  };
}

function addressTargetForNode(source, selected) {
  const directReference = addressReferenceByType[selected.type];
  if (directReference !== undefined && !isExcessAddressElement(selected)) {
    return {
      node: selected,
      display: textForNode(source, selected),
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
        display: textForNode(source, selected),
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
        display: textForNode(source, selected),
        reference: negatedSelectionReference,
      };
    }
    return undefined;
  }

  return contextAddressTarget(source, selected);
}

function replacementNodeForToken(token) {
  const expectedParentType = replacementParentByTokenType[token.type];
  const parent = token.parent;
  return expectedParentType !== undefined && parent?.type === expectedParentType
    ? parent
    : undefined;
}

function visibleDelimiter(delimiter) {
  const visible = visibleCharacter(delimiter);
  return visible === " " ? "<space>" : visible;
}

function visibleCharacter(character) {
  if (character === " ") {
    return character;
  }
  if (character === "\t") {
    return "<tab>";
  }
  if (character === "\r") {
    return "<carriage-return>";
  }
  if (character === "\n") {
    return "<newline>";
  }
  if (!graphicDelimiterPattern.test(character)) {
    const codePoint = character.codePointAt(0);
    return `<U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}>`;
  }
  return character;
}

function visibleText(value) {
  return Array.from(value, visibleCharacter).join("");
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

function replacementTargetForNode(source, selected) {
  const node = replacementNodeForToken(selected);
  if (node === undefined) {
    return undefined;
  }
  const spelling = textForNode(source, node);
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

const regularExpressionReferenceByOperatorType = Object.freeze({
  left_anchor: {
    title: "Beginning Anchor",
    synopsis: "^RE",
    description: "Matches only at the beginning of the string being searched.",
  },
  right_anchor: {
    title: "End Anchor",
    synopsis: "RE$",
    description: "Matches only at the end of the string being searched.",
  },
  wildcard: {
    title: "Any-Character Expression",
    synopsis: ".",
    description:
      "Matches any character in the supported character set except NUL.",
  },
  zero_or_more_operator: {
    title: "Zero-or-More Duplication",
    synopsis: "RE*",
    description: "Matches zero or more consecutive occurrences of RE.",
  },
  one_or_more_operator: {
    title: "One-or-More Duplication",
    synopsis: "RE+",
    description: "Matches one or more consecutive occurrences of RE.",
  },
  zero_or_one_operator: {
    title: "Zero-or-One Duplication",
    synopsis: "RE?",
    description: "Matches zero or one occurrence of RE.",
  },
  ere_alternation_operator: {
    title: "Alternation",
    synopsis: "RE|RE",
    description: "Matches either the expression on the left or the right.",
  },
});

const regularExpressionOperatorWrapperByTokenType = Object.freeze({
  left_anchor_token: "left_anchor",
  right_anchor_token: "right_anchor",
  wildcard_token: "wildcard",
  ere_alternation_operator_token: "ere_alternation_operator",
});

const minimalRepetitionReference = Object.freeze({
  title: "Minimal Repetition Modifier",
  description:
    "Makes the preceding duplication prefer the shortest match that permits the complete ERE to match.",
});

const bracketExpressionReference = Object.freeze({
  title: "Bracket Expression",
  synopsis: "[list]",
  description:
    "Matches a character, and may match a multi-character collating element, represented by its non-empty list.",
});

const nonmatchingListReference = Object.freeze({
  title: "Non-Matching List",
  synopsis: "[^list]",
  description:
    "Makes the bracket expression match a character not represented by its list.",
});

const rangeReference = Object.freeze({
  title: "Range Expression",
  synopsis: "[start-end]",
  description:
    "In the POSIX locale, represents the collating elements from start through end, inclusive; its behavior in other locales is unspecified.",
});

const characterClassReference = Object.freeze({
  title: "Character Class Expression",
  synopsis: "[[:class:]]",
  description:
    "Represents the set of characters belonging to this locale-defined character class.",
});

function namedCharacterClassReference(name, title, description) {
  return Object.freeze({
    title: `${title} Character Class`,
    synopsis: `[[:${name}:]]`,
    description,
  });
}

const characterClassReferences = Object.freeze({
  alnum: namedCharacterClassReference(
    "alnum",
    "Alphanumeric",
    "Represents letters and decimal digits in the current locale.",
  ),
  alpha: namedCharacterClassReference(
    "alpha",
    "Alphabetic",
    "Represents letters in the current locale.",
  ),
  blank: namedCharacterClassReference(
    "blank",
    "Blank",
    "Represents blank characters in the current locale; in the POSIX locale, these are space and tab.",
  ),
  cntrl: namedCharacterClassReference(
    "cntrl",
    "Control",
    "Represents control characters in the current locale.",
  ),
  digit: namedCharacterClassReference(
    "digit",
    "Decimal Digit",
    "Represents exactly the decimal digits 0 through 9 in every locale.",
  ),
  graph: namedCharacterClassReference(
    "graph",
    "Graphical",
    "Represents printable characters other than space in the current locale.",
  ),
  lower: namedCharacterClassReference(
    "lower",
    "Lowercase",
    "Represents lowercase letters in the current locale.",
  ),
  print: namedCharacterClassReference(
    "print",
    "Printable",
    "Represents printable characters, including space, in the current locale.",
  ),
  punct: namedCharacterClassReference(
    "punct",
    "Punctuation",
    "Represents punctuation characters in the current locale.",
  ),
  space: namedCharacterClassReference(
    "space",
    "White-Space",
    "Represents white-space characters; in the POSIX locale, these are space, tab, newline, carriage return, form feed, and vertical tab.",
  ),
  upper: namedCharacterClassReference(
    "upper",
    "Uppercase",
    "Represents uppercase letters in the current locale.",
  ),
  xdigit: namedCharacterClassReference(
    "xdigit",
    "Hexadecimal Digit",
    "Represents exactly 0 through 9, A through F, and a through f in every locale.",
  ),
});

const collatingSymbolReference = Object.freeze({
  title: "Collating Symbol",
  synopsis: "[[.element.]]",
  description:
    "Represents this collating element as a single bracket-expression element.",
});

const equivalenceClassReference = Object.freeze({
  title: "Equivalence Class Expression",
  synopsis: "[[=element=]]",
  description:
    "Represents the set of collating elements in the same equivalence class as this element.",
});

const bracketTermReferences = Object.freeze({
  character_class: characterClassReference,
  collating_symbol: collatingSymbolReference,
  equivalence_class: equivalenceClassReference,
});

function sameNode(left, right) {
  return left != null && right != null && left.equals(right);
}

function completeNode(node) {
  return node != null && !node.isMissing && node.endIndex > node.startIndex;
}

function hasIssue(node) {
  return node?.childForFieldName("issue") != null;
}

function directWrapper(node, wrapperType) {
  return node.parent?.type === wrapperType ? node.parent : undefined;
}

function regularExpressionRepetitionModifierTarget(source, selected) {
  if (selected.type !== "zero_or_one_operator") {
    return undefined;
  }
  const modifier = selected.parent;
  const symbol = modifier?.parent;
  const expression = symbol?.parent;
  const operand = expression?.childForFieldName("operand");
  const baseSymbol = operand?.childForFieldName("operator");
  if (
    modifier?.type !== "repetition_modifier" ||
    !completeNode(selected) ||
    !sameNode(selected, modifier.childForFieldName("operator")) ||
    symbol?.type !== "ere_dupl_symbol" ||
    hasIssue(symbol) ||
    expression?.type !== "ere_expression" ||
    !sameNode(symbol, expression.childForFieldName("operator")) ||
    operand?.type !== "ere_expression" ||
    baseSymbol?.type !== "ere_dupl_symbol" ||
    hasIssue(baseSymbol) ||
    baseSymbol.namedChild(0)?.type === "repetition_modifier"
  ) {
    return undefined;
  }
  return {
    node: selected,
    display: textForNode(source, selected),
    reference: Object.freeze({
      ...minimalRepetitionReference,
      synopsis: `RE${textForNode(source, baseSymbol)}?`,
    }),
  };
}

function rightmostEreBranch(node) {
  let current = node;
  while (current !== null) {
    if (current.type === "ere_branch") {
      return current;
    }
    const right = current.childForFieldName("right");
    current =
      right ??
      (current.namedChildCount === 0
        ? null
        : current.namedChild(current.namedChildCount - 1));
  }
  return undefined;
}

function regularExpressionOperatorTarget(source, selected) {
  const wrapperType =
    regularExpressionOperatorWrapperByTokenType[selected.type];
  const node =
    wrapperType === undefined ? selected : directWrapper(selected, wrapperType);
  const reference = node && regularExpressionReferenceByOperatorType[node.type];
  if (reference === undefined || !completeNode(node) || hasIssue(node)) {
    return undefined;
  }

  if (node.type === "ere_alternation_operator") {
    const expression = node.parent;
    const left = expression?.childForFieldName("left");
    const right = expression?.childForFieldName("right");
    if (
      expression?.type !== "extended_reg_exp" ||
      !sameNode(node, expression.childForFieldName("operator")) ||
      !completeNode(rightmostEreBranch(left)) ||
      !completeNode(right)
    ) {
      return undefined;
    }
  }

  if (
    node.type === "zero_or_more_operator" ||
    node.type === "one_or_more_operator" ||
    node.type === "zero_or_one_operator"
  ) {
    const symbol = node.parent;
    const expressionType =
      symbol?.type === "bre_dupl_symbol" ? "simple_bre" : "ere_expression";
    if (
      (symbol?.type !== "bre_dupl_symbol" &&
        symbol?.type !== "ere_dupl_symbol") ||
      hasIssue(symbol) ||
      symbol.parent?.type !== expressionType
    ) {
      return undefined;
    }
  }

  return {
    node,
    display: textForNode(source, node),
    reference,
  };
}

function regularExpressionGroupTarget(source, selected) {
  let delimiter = selected;
  if (
    selected.type === "back_close_parenthesis_token" &&
    selected.parent?.type === "back_close_parenthesis"
  ) {
    delimiter = selected.parent;
  } else if (
    selected.type === "close_parenthesis_token" &&
    selected.parent?.type === "close_parenthesis"
  ) {
    delimiter = selected.parent;
  }

  const bre = delimiter.type.startsWith("back_");
  if (
    delimiter.type !== "back_open_parenthesis" &&
    delimiter.type !== "back_close_parenthesis" &&
    delimiter.type !== "open_parenthesis" &&
    delimiter.type !== "close_parenthesis"
  ) {
    return undefined;
  }
  const group = delimiter.parent;
  const expectedGroup = bre ? "nondupl_bre" : "ere_expression";
  if (group?.type !== expectedGroup || hasIssue(group)) {
    return undefined;
  }
  const opening = group.childForFieldName("opening");
  const expression = group.childForFieldName("expression");
  const closing = group.childForFieldName("closing");
  if (
    !completeNode(opening) ||
    !completeNode(expression) ||
    !completeNode(closing) ||
    hasIssue(closing) ||
    (!sameNode(delimiter, opening) && !sameNode(delimiter, closing))
  ) {
    return undefined;
  }
  return {
    node: delimiter,
    display: textForNode(source, delimiter),
    reference: {
      title: "Subexpression",
      synopsis: bre ? "\\(RE\\)" : "(RE)",
      description:
        "Groups RE as one expression; duplication applies to the group as a whole.",
    },
  };
}

function duplicationSymbolFor(selected) {
  let node = selected;
  while (node !== null) {
    if (node.type === "bre_dupl_symbol" || node.type === "ere_dupl_symbol") {
      return node;
    }
    if (
      node.type === "basic_reg_exp" ||
      node.type === "extended_reg_exp" ||
      node.type === "script"
    ) {
      return undefined;
    }
    node = node.parent;
  }
  return undefined;
}

function regularExpressionIntervalTarget(source, selected) {
  const node = duplicationSymbolFor(selected);
  const expressionType =
    node?.type === "bre_dupl_symbol" ? "simple_bre" : "ere_expression";
  if (
    node === undefined ||
    hasIssue(node) ||
    !completeNode(node.childForFieldName("opening")) ||
    !completeNode(node.childForFieldName("minimum")) ||
    !completeNode(node.childForFieldName("closing")) ||
    node.parent?.type !== expressionType
  ) {
    return undefined;
  }
  const bre = node.type === "bre_dupl_symbol";
  return {
    node,
    display: textForNode(source, node),
    reference: {
      title: "Interval Duplication",
      synopsis: bre ? "RE\\{m,n\\}" : "RE{m,n}",
      description:
        "Matches a number of consecutive occurrences of RE within the interval's minimum and optional maximum bounds.",
    },
  };
}

function regularExpressionBackreferenceTarget(source, selected) {
  const node =
    selected.type === "backreference_token"
      ? directWrapper(selected, "backreference")
      : selected.type === "backreference"
        ? selected
        : undefined;
  if (!completeNode(node)) {
    return undefined;
  }
  const spelling = textForNode(source, node);
  const number = spelling.at(-1);
  return {
    node,
    display: spelling,
    reference: {
      title: "Back-Reference",
      synopsis: `\\${number}`,
      description: `Matches the same string matched by preceding BRE subexpression ${number}.`,
    },
  };
}

function completeBracket(node) {
  const opening = node?.childForFieldName("opening");
  const list = node?.childForFieldName("list");
  const closing = node?.childForFieldName("closing");
  return (
    node?.type === "bracket_expression" &&
    !hasIssue(node) &&
    completeNode(opening) &&
    !hasIssue(opening) &&
    completeNode(list) &&
    !hasIssue(list) &&
    completeNode(closing) &&
    !hasIssue(closing)
  );
}

function ancestorOfType(node, type) {
  let current = node;
  while (current !== null) {
    if (current.type === type) {
      return current;
    }
    current = current.parent;
  }
  return undefined;
}

function regularExpressionBracketFrameTarget(source, selected) {
  let delimiter = selected;
  if (
    selected.type === "close_bracket_token" &&
    selected.parent?.type === "close_bracket"
  ) {
    delimiter = selected.parent;
  }
  if (delimiter.type !== "open_bracket" && delimiter.type !== "close_bracket") {
    return undefined;
  }
  const bracket = delimiter.parent;
  return completeBracket(bracket)
    ? {
        node: delimiter,
        display: textForNode(source, delimiter),
        reference: bracketExpressionReference,
      }
    : undefined;
}

function regularExpressionBracketOperatorTarget(source, selected) {
  if (selected.type === "nonmatching_list_operator") {
    const list = selected.parent;
    const bracket = list?.parent;
    if (
      list?.type === "nonmatching_list" &&
      sameNode(selected, list.childForFieldName("operator")) &&
      completeBracket(bracket)
    ) {
      return {
        node: selected,
        display: textForNode(source, selected),
        reference: nonmatchingListReference,
      };
    }
  }
  const range = selected.parent?.parent;
  const end =
    range?.childForFieldName("end") ??
    range?.childForFieldName("ending_hyphen");
  if (
    selected.type === "range_operator" &&
    selected.parent?.type === "start_range" &&
    range?.type === "range_expression" &&
    sameNode(selected, selected.parent.childForFieldName("operator")) &&
    !hasIssue(selected.parent) &&
    completeNode(end) &&
    !hasIssue(end) &&
    completeBracket(ancestorOfType(selected, "bracket_expression"))
  ) {
    return {
      node: selected,
      display: textForNode(source, selected),
      reference: rangeReference,
    };
  }
  return undefined;
}

function regularExpressionBracketTermTarget(source, selected) {
  let node = selected;
  while (node !== null) {
    let reference = bracketTermReferences[node.type];
    if (reference !== undefined) {
      const opening = node.childForFieldName("opening");
      const middle =
        node.childForFieldName("name") ?? node.childForFieldName("element");
      const closing = node.childForFieldName("closing");
      if (
        !hasIssue(node) &&
        completeNode(opening) &&
        completeNode(middle) &&
        completeNode(closing) &&
        completeBracket(ancestorOfType(node, "bracket_expression"))
      ) {
        if (node.type === "character_class") {
          const name = textForNode(source, middle);
          if (Object.hasOwn(characterClassReferences, name)) {
            reference = characterClassReferences[name];
          }
        }
        return {
          node,
          display: textForNode(source, node),
          reference,
        };
      }
      return undefined;
    }
    if (node.type === "bracket_expression") {
      return undefined;
    }
    node = node.parent;
  }
  return undefined;
}

const regularExpressionOperatorTypes = new Set([
  ...Object.keys(regularExpressionReferenceByOperatorType),
  ...Object.keys(regularExpressionOperatorWrapperByTokenType),
]);
const regularExpressionGroupTypes = new Set([
  "back_close_parenthesis",
  "back_close_parenthesis_token",
  "back_open_parenthesis",
  "close_parenthesis",
  "close_parenthesis_token",
  "open_parenthesis",
]);
const regularExpressionIntervalTypes = new Set([
  "back_close_brace",
  "back_open_brace",
  "close_brace",
  "dup_count",
  "dup_count_token",
  "interval_separator",
  "open_brace",
]);
const regularExpressionBackreferenceTypes = new Set([
  "backreference",
  "backreference_token",
]);
const regularExpressionBracketFrameTypes = new Set([
  "close_bracket",
  "close_bracket_token",
  "open_bracket",
]);
const regularExpressionBracketOperatorTypes = new Set([
  "nonmatching_list_operator",
  "range_operator",
]);
const regularExpressionBracketTermTypes = new Set([
  ...Object.keys(bracketTermReferences),
  "class_name",
  "coll_elem_multi",
  "coll_elem_single",
  "colon_close",
  "dot_close",
  "equal_close",
  "open_colon",
  "open_dot",
  "open_equal",
]);

function regularExpressionTargetForNode(source, selected) {
  if (
    selected.type === "zero_or_one_operator" &&
    selected.parent?.type === "repetition_modifier"
  ) {
    return regularExpressionRepetitionModifierTarget(source, selected);
  }
  if (regularExpressionOperatorTypes.has(selected.type)) {
    return regularExpressionOperatorTarget(source, selected);
  }
  if (regularExpressionGroupTypes.has(selected.type)) {
    return regularExpressionGroupTarget(source, selected);
  }
  if (regularExpressionIntervalTypes.has(selected.type)) {
    return regularExpressionIntervalTarget(source, selected);
  }
  if (regularExpressionBackreferenceTypes.has(selected.type)) {
    return regularExpressionBackreferenceTarget(source, selected);
  }
  if (regularExpressionBracketFrameTypes.has(selected.type)) {
    return regularExpressionBracketFrameTarget(source, selected);
  }
  if (regularExpressionBracketOperatorTypes.has(selected.type)) {
    return regularExpressionBracketOperatorTarget(source, selected);
  }
  return regularExpressionBracketTermTypes.has(selected.type)
    ? regularExpressionBracketTermTarget(source, selected)
    : undefined;
}

function targetForNode(source, selected) {
  return (
    directTargetForNode(source, selected) ??
    addressTargetForNode(source, selected) ??
    replacementTargetForNode(source, selected) ??
    regularExpressionTargetForNode(source, selected)
  );
}

export function hover(snapshot, offset) {
  assertSnapshot(snapshot);
  if (!Number.isInteger(offset)) {
    throw new TypeError("The sed hover offset must be an integer.");
  }
  if (offset < 0 || offset > snapshot.source.length) {
    throw new RangeError("The sed hover offset is outside the source.");
  }
  const { source, tree } = snapshot;
  const root = tree.rootNode;
  if (offset >= root.endIndex) {
    return undefined;
  }
  const node = root.namedDescendantForIndex(offset, offset + 1);
  if (node === null || offset < node.startIndex || offset >= node.endIndex) {
    return undefined;
  }

  const target = targetForNode(source, node);
  if (target === undefined) {
    return undefined;
  }
  const range = offsetRangeForNode(target.node);
  return {
    startOffset: range.startOffset,
    endOffset: range.endOffset,
    documentation: {
      display: visibleText(target.display),
      title: target.reference.title,
      synopsis: target.reference.synopsis,
      description: target.reference.description,
    },
  };
}

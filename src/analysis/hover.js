import {
  addressReference,
  commandReferenceForVerb,
  regularExpressionReference,
  replacementReference,
  substitutionFlagReferenceForType,
} from "./catalog.js";
import {
  delimiterTokenFor,
  invalidStructure,
  isCompleteContextAddress,
  mayContainInvalidStructure,
  rangeForNode as offsetRangeForNode,
  textForNode,
} from "./cst.js";
import { assertSnapshot } from "./snapshot.js";

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
    reference: addressReference(
      empty ? "emptyRegularExpression" : "contextAddress",
      display,
    ),
  };
}

function addressTargetForNode(source, selected) {
  const directReference = addressReference(selected.type);
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
        reference: addressReference("range"),
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
        reference: addressReference("negatedSelection"),
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
  if (node.type === "replacement_backreference") {
    const number = spelling.at(-1);
    return number === "0" ? undefined : replacementReference(node.type, number);
  }
  if (node.type === "replacement_escaped_delimiter") {
    const delimiter = visibleDelimiter(spelling.slice(1));
    return replacementReference(node.type, delimiter);
  }
  return replacementReference(node.type, spelling);
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

const regularExpressionOperatorWrapperByTokenType = Object.freeze({
  left_anchor_token: "left_anchor",
  right_anchor_token: "right_anchor",
  wildcard_token: "wildcard",
  ere_alternation_operator_token: "ere_alternation_operator",
});

function sameNode(left, right) {
  return left != null && right != null && left.equals(right);
}

function completeNode(node) {
  return (
    node != null && !invalidStructure(node) && node.endIndex > node.startIndex
  );
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
    expression?.type !== "ere_expression" ||
    !sameNode(symbol, expression.childForFieldName("operator")) ||
    operand?.type !== "ere_expression" ||
    baseSymbol?.type !== "ere_dupl_symbol" ||
    baseSymbol.namedChild(0)?.type === "repetition_modifier"
  ) {
    return undefined;
  }
  return {
    node: selected,
    display: textForNode(source, selected),
    reference: regularExpressionReference(
      "repetition_modifier",
      `RE${textForNode(source, baseSymbol)}?`,
    ),
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
  const reference = node && regularExpressionReference(node.type);
  if (reference === undefined || !completeNode(node)) {
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
  if (group?.type !== expectedGroup) {
    return undefined;
  }
  const opening = group.childForFieldName("opening");
  const expression = group.childForFieldName("expression");
  const closing = group.childForFieldName("closing");
  if (
    !completeNode(opening) ||
    !completeNode(expression) ||
    !completeNode(closing) ||
    (!sameNode(delimiter, opening) && !sameNode(delimiter, closing))
  ) {
    return undefined;
  }
  return {
    node: delimiter,
    display: textForNode(source, delimiter),
    reference: regularExpressionReference("group", bre ? "bre" : "ere"),
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
    !completeNode(node.childForFieldName("opening")) ||
    !completeNode(node.childForFieldName("minimum")) ||
    !completeNode(node.childForFieldName("closing")) ||
    node.parent?.type !== expressionType
  ) {
    return undefined;
  }
  return {
    node,
    display: textForNode(source, node),
    reference: regularExpressionReference(
      "interval",
      node.type === "bre_dupl_symbol" ? "bre" : "ere",
    ),
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
    reference: regularExpressionReference("backreference", number),
  };
}

function completeBracketFrame(node) {
  const opening = node?.childForFieldName("opening");
  const list = node?.childForFieldName("list");
  const closing = node?.childForFieldName("closing");
  return (
    node?.type === "bracket_expression" &&
    completeNode(opening) &&
    !hasIssue(opening) &&
    completeNode(list) &&
    completeNode(closing) &&
    !hasIssue(closing)
  );
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
  return completeBracketFrame(bracket)
    ? {
        node: delimiter,
        display: textForNode(source, delimiter),
        reference: regularExpressionReference("bracket_expression"),
      }
    : undefined;
}

function regularExpressionBracketOperatorTarget(source, selected) {
  if (selected.type === "nonmatching_list_operator") {
    const list = selected.parent;
    if (
      list?.type === "nonmatching_list" &&
      sameNode(selected, list.childForFieldName("operator"))
    ) {
      return {
        node: selected,
        display: textForNode(source, selected),
        reference: regularExpressionReference("nonmatching_list"),
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
    !hasIssue(end)
  ) {
    return {
      node: selected,
      display: textForNode(source, selected),
      reference: regularExpressionReference("range_expression"),
    };
  }
  return undefined;
}

function regularExpressionBracketTermTarget(source, selected) {
  let node = selected;
  while (node !== null) {
    let reference = regularExpressionReference(node.type);
    if (reference !== undefined) {
      const opening = node.childForFieldName("opening");
      const middle =
        node.childForFieldName("name") ?? node.childForFieldName("element");
      const closing = node.childForFieldName("closing");
      if (
        !hasIssue(node) &&
        completeNode(opening) &&
        completeNode(middle) &&
        completeNode(closing)
      ) {
        if (node.type === "character_class") {
          const name = textForNode(source, middle);
          reference = regularExpressionReference("character_class", name);
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
  "ere_alternation_operator",
  "left_anchor",
  "one_or_more_operator",
  "right_anchor",
  "wildcard",
  "zero_or_more_operator",
  "zero_or_one_operator",
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
  "character_class",
  "collating_symbol",
  "equivalence_class",
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

function selectedNode(root, offset) {
  if (offset >= root.endIndex) {
    return undefined;
  }
  const selected = root.namedDescendantForIndex(offset, offset + 1);
  if (
    selected === null ||
    offset < selected.startIndex ||
    offset >= selected.endIndex
  ) {
    return undefined;
  }
  if (mayContainInvalidStructure(root)) {
    for (let node = selected; node !== null; node = node.parent) {
      if (invalidStructure(node)) {
        return undefined;
      }
    }
  }
  return selected;
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
  const node = selectedNode(root, offset);
  if (node === undefined) {
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

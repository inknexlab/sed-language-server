import {
  delimiterTokenFor,
  descendants,
  functionForCommand,
  isCompleteContextAddress,
  nativeIssues,
  structuredIssues,
  labelSymbols as syntaxLabelSymbols,
  textForIndices as syntaxTextForIndices,
  textForNode as syntaxTextForNode,
} from "./analysis/syntax.js";

export {
  delimiterTokenFor,
  descendants,
  functionForCommand,
  isCompleteContextAddress,
  nativeIssues,
  structuredIssues,
};

export function textForIndices(document, startIndex, endIndex) {
  return syntaxTextForIndices(document.getText(), startIndex, endIndex);
}

export function textForNode(document, node) {
  return syntaxTextForNode(document.getText(), node);
}

export function rangeForNode(document, node) {
  return {
    start: document.positionAt(node.startIndex),
    end: document.positionAt(node.endIndex),
  };
}

export function labelSymbols(document, root) {
  return syntaxLabelSymbols(document.getText(), root);
}

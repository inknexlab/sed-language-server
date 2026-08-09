import { MarkupKind } from "vscode-languageserver";

const addressPrefixByMaximum = Object.freeze([
  "",
  "[address]",
  "[address[,address]]",
]);

function defineCommand({ verb, maximumAddresses, title, syntax, description }) {
  return Object.freeze({
    verb,
    maximumAddresses,
    title,
    synopsis: `${addressPrefixByMaximum[maximumAddresses]}${syntax}`,
    description,
  });
}

const references = Object.freeze([
  defineCommand({
    verb: "{",
    maximumAddresses: 2,
    title: "Command Block",
    syntax: "{ … }",
    description:
      "Executes the enclosed editing commands when the current pattern space is selected.",
  }),
  defineCommand({
    verb: "a",
    maximumAddresses: 1,
    title: "Append Text",
    syntax: "a\\\ntext",
    description:
      "Schedules text for standard output before the next input fetch, before `q`, or at the end of the script.",
  }),
  defineCommand({
    verb: "b",
    maximumAddresses: 2,
    title: "Branch",
    syntax: "b [label]",
    description:
      "Branches to label, or to the end of the script when label is omitted.",
  }),
  defineCommand({
    verb: "c",
    maximumAddresses: 2,
    title: "Change Text",
    syntax: "c\\\ntext",
    description:
      "Deletes the pattern space, writes text once for the selected line or completed range, and starts the next cycle.",
  }),
  defineCommand({
    verb: "d",
    maximumAddresses: 2,
    title: "Delete",
    syntax: "d",
    description: "Deletes the pattern space and starts the next cycle.",
  }),
  defineCommand({
    verb: "D",
    maximumAddresses: 2,
    title: "Delete First Line",
    syntax: "D",
    description:
      "Deletes through the first newline and restarts the cycle without reading input, or acts like `d` when no newline exists.",
  }),
  defineCommand({
    verb: "g",
    maximumAddresses: 2,
    title: "Get",
    syntax: "g",
    description: "Replaces the pattern space with the hold space.",
  }),
  defineCommand({
    verb: "G",
    maximumAddresses: 2,
    title: "Get and Append",
    syntax: "G",
    description: "Appends a newline and the hold space to the pattern space.",
  }),
  defineCommand({
    verb: "h",
    maximumAddresses: 2,
    title: "Hold",
    syntax: "h",
    description: "Replaces the hold space with the pattern space.",
  }),
  defineCommand({
    verb: "H",
    maximumAddresses: 2,
    title: "Hold and Append",
    syntax: "H",
    description: "Appends a newline and the pattern space to the hold space.",
  }),
  defineCommand({
    verb: "i",
    maximumAddresses: 1,
    title: "Insert Text",
    syntax: "i\\\ntext",
    description:
      "Writes text to standard output before continuing with the selected pattern space.",
  }),
  defineCommand({
    verb: "l",
    maximumAddresses: 2,
    title: "List",
    syntax: "l",
    description:
      "Writes an unambiguous escaped representation of the pattern space.",
  }),
  defineCommand({
    verb: "n",
    maximumAddresses: 2,
    title: "Next",
    syntax: "n",
    description:
      "Writes the pattern space when default output is enabled, then replaces it with the next input line.",
  }),
  defineCommand({
    verb: "N",
    maximumAddresses: 2,
    title: "Append Next Line",
    syntax: "N",
    description:
      "Appends a newline and the next input line to the pattern space.",
  }),
  defineCommand({
    verb: "p",
    maximumAddresses: 2,
    title: "Print",
    syntax: "p",
    description: "Writes the pattern space to standard output.",
  }),
  defineCommand({
    verb: "P",
    maximumAddresses: 2,
    title: "Print First Line",
    syntax: "P",
    description:
      "Writes the first line of the pattern space to standard output.",
  }),
  defineCommand({
    verb: "q",
    maximumAddresses: 1,
    title: "Quit",
    syntax: "q",
    description:
      "Branches to the end of the script and quits without starting a new cycle.",
  }),
  defineCommand({
    verb: "r",
    maximumAddresses: 1,
    title: "Read File",
    syntax: "r rfile",
    description:
      "Schedules the contents of rfile to be written to standard output.",
  }),
  defineCommand({
    verb: "s",
    maximumAddresses: 2,
    title: "Substitute",
    syntax: "s/RE/replacement/[flags]",
    description:
      "Replaces instances of RE in the pattern space according to flags.",
  }),
  defineCommand({
    verb: "t",
    maximumAddresses: 2,
    title: "Test and Branch",
    syntax: "t [label]",
    description:
      "Branches to label if a substitution has occurred since the last input read or previous `t`, or to the end when label is omitted.",
  }),
  defineCommand({
    verb: "w",
    maximumAddresses: 2,
    title: "Write File",
    syntax: "w wfile",
    description: "Appends the pattern space to wfile.",
  }),
  defineCommand({
    verb: "x",
    maximumAddresses: 2,
    title: "Exchange",
    syntax: "x",
    description: "Exchanges the pattern and hold spaces.",
  }),
  defineCommand({
    verb: "y",
    maximumAddresses: 2,
    title: "Translate",
    syntax: "y/string1/string2/",
    description:
      "Replaces each occurrence of a character in string1 with the corresponding character in string2.",
  }),
  defineCommand({
    verb: ":",
    maximumAddresses: 0,
    title: "Label",
    syntax: ":label",
    description:
      "Defines a label for `b` and `t` without otherwise changing processing.",
  }),
  defineCommand({
    verb: "=",
    maximumAddresses: 1,
    title: "Print Line Number",
    syntax: "=",
    description: "Writes the current input line number to standard output.",
  }),
  defineCommand({
    verb: "#",
    maximumAddresses: 0,
    title: "Comment",
    syntax: "#comment",
    description:
      "Ignores the remainder of the line; `#n` as the first two script characters also suppresses default output.",
  }),
]);

const referenceByVerb = new Map(
  references.map((reference) => [reference.verb, reference]),
);

export function commandReferences() {
  return references;
}

export function commandReferenceForVerb(verb) {
  return referenceByVerb.get(verb);
}

function plainReferenceProse(value) {
  return value.replace(/`([^`]*)`/g, "$1");
}

export function referenceDocumentation(reference, kind) {
  if (kind === MarkupKind.Markdown) {
    return {
      kind,
      value: `\`\`\`sed\n${reference.synopsis}\n\`\`\`\n\n${reference.description}`,
    };
  }
  if (kind === MarkupKind.PlainText) {
    return {
      kind,
      value: `${reference.synopsis}\n\n${plainReferenceProse(reference.description)}`,
    };
  }
  if (kind === null) {
    return `${reference.synopsis}\n\n${plainReferenceProse(reference.description)}`;
  }
  throw new TypeError(`Unsupported markup kind: ${String(kind)}`);
}

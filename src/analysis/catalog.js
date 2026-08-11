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

function defineSubstitutionFlag({
  nodeType,
  spelling,
  terminal,
  title,
  synopsis,
  description,
}) {
  return Object.freeze({
    nodeType,
    spelling,
    terminal,
    title,
    synopsis,
    description,
  });
}

const commandReferenceList = Object.freeze([
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
      "Schedules text for standard output before the next input fetch, before q, or at the end of the script.",
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
      "Deletes through the first newline and restarts the cycle without reading input, or acts like d when no newline exists.",
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
      "Branches to label if a substitution has occurred since the last input read or previous t, or to the end when label is omitted.",
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
      "Defines a label for b and t without otherwise changing processing.",
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
      "Ignores the remainder of the line; #n as the first two script characters also suppresses default output.",
  }),
]);

const substitutionFlagReferenceList = Object.freeze([
  defineSubstitutionFlag({
    nodeType: "occurrence_flag",
    spelling: null,
    terminal: false,
    title: "Occurrence",
    synopsis: "s/RE/replacement/n",
    description: "Replaces only the nth occurrence of RE in the pattern space.",
  }),
  defineSubstitutionFlag({
    nodeType: "global_flag",
    spelling: "g",
    terminal: false,
    title: "Global",
    synopsis: "s/RE/replacement/g",
    description:
      "Replaces all non-overlapping instances of RE rather than only the first.",
  }),
  defineSubstitutionFlag({
    nodeType: "case_insensitive_flag",
    spelling: "i",
    terminal: false,
    title: "Case-Insensitive",
    synopsis: "s/RE/replacement/i",
    description: "Matches RE case-insensitively.",
  }),
  defineSubstitutionFlag({
    nodeType: "print_flag",
    spelling: "p",
    terminal: false,
    title: "Print on Substitution",
    synopsis: "s/RE/replacement/p",
    description:
      "Writes the pattern space to standard output if a replacement was made.",
  }),
  defineSubstitutionFlag({
    nodeType: "substitution_flag",
    spelling: "w",
    terminal: true,
    title: "Write on Substitution",
    synopsis: "s/RE/replacement/w wfile",
    description:
      "Appends the pattern space to wfile if a replacement was made.",
  }),
]);

const commandReferenceByVerb = new Map(
  commandReferenceList.map((reference) => [reference.verb, reference]),
);
const substitutionFlagReferenceByType = new Map(
  substitutionFlagReferenceList.map((reference) => [
    reference.nodeType,
    reference,
  ]),
);

export function assertDocumentationKind(kind) {
  if (kind !== "markdown" && kind !== "plaintext") {
    throw new TypeError(`Unsupported markup kind: ${String(kind)}`);
  }
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

export function referenceDocumentation(reference, kind) {
  assertDocumentationKind(kind);
  return kind === "markdown"
    ? `\`\`\`sed\n${reference.synopsis}\n\`\`\`\n\n${reference.description}`
    : `${reference.synopsis}\n\n${reference.description}`;
}

export function hoverDocumentation(documentation, kind) {
  const reference = referenceDocumentation(documentation, kind);
  return kind === "markdown"
    ? `### ${inlineCode(documentation.display)} — ${documentation.title}\n\n${reference}`
    : `${documentation.display} — ${documentation.title}\n\n${reference}`;
}

export function commandReferences() {
  return commandReferenceList;
}

export function commandReferenceForVerb(verb) {
  return commandReferenceByVerb.get(verb);
}

export function substitutionFlagReferences() {
  return substitutionFlagReferenceList;
}

export function substitutionFlagReferenceForType(nodeType) {
  return substitutionFlagReferenceByType.get(nodeType);
}

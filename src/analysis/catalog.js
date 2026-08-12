const addressPrefixByMaximum = Object.freeze([
  "",
  "[address]",
  "[address[,address]]",
]);

function defineCommand({ verb, maximumAddresses, title, syntax, description }) {
  return Object.freeze({
    verb,
    title,
    synopsis: `${addressPrefixByMaximum[maximumAddresses]}${syntax}`,
    description,
  });
}

function defineSubstitutionFlag({ nodeType, title, synopsis, description }) {
  return Object.freeze({
    nodeType,
    title,
    synopsis,
    description,
  });
}

function defineReference(title, synopsis, description) {
  return Object.freeze({ title, synopsis, description });
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
    title: "Occurrence",
    synopsis: "s/RE/replacement/n",
    description: "Replaces only the nth occurrence of RE in the pattern space.",
  }),
  defineSubstitutionFlag({
    nodeType: "global_flag",
    title: "Global",
    synopsis: "s/RE/replacement/g",
    description:
      "Replaces all non-overlapping instances of RE rather than only the first.",
  }),
  defineSubstitutionFlag({
    nodeType: "case_insensitive_flag",
    title: "Case-Insensitive",
    synopsis: "s/RE/replacement/i",
    description: "Matches RE case-insensitively.",
  }),
  defineSubstitutionFlag({
    nodeType: "print_flag",
    title: "Print on Substitution",
    synopsis: "s/RE/replacement/p",
    description:
      "Writes the pattern space to standard output if a replacement was made.",
  }),
  defineSubstitutionFlag({
    nodeType: "substitution_flag",
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

const addressReferences = Object.freeze({
  line_number_address: defineReference(
    "Line Number Address",
    "number",
    "Selects the input line with this cumulative line number across all input files.",
  ),
  last_line_address: defineReference(
    "Last-Line Address",
    "$",
    "Selects the last line of input.",
  ),
  range: defineReference(
    "Address Range",
    "address1,address2",
    "Selects each inclusive range from a pattern space selected by address1 through the next pattern space selected by address2; if address2 is a line number no greater than the first selected line number, only that first pattern space is selected.",
  ),
  negatedSelection: defineReference(
    "Negated Selection",
    "[address[,address]]!function",
    "Inverts the address selection that controls whether the editing command is applied.",
  ),
});

const replacementReferences = Object.freeze({
  matched_text_reference: defineReference(
    "Matched Text",
    "s/RE/&/",
    "Inserts the text matched by RE.",
  ),
  escaped_newline: defineReference(
    "Embedded Newline",
    "s/RE/first\\\nsecond/",
    "Inserts a newline into the replacement.",
  ),
  "\\&": defineReference(
    "Literal Ampersand",
    "s/RE/\\&/",
    "Inserts a literal ampersand instead of the text matched by RE.",
  ),
  "\\\\": defineReference(
    "Literal Backslash",
    "s/RE/\\\\/",
    "Inserts a literal backslash.",
  ),
});

const regularExpressionReferences = Object.freeze({
  left_anchor: defineReference(
    "Beginning Anchor",
    "^RE",
    "Matches only at the beginning of the string being searched.",
  ),
  right_anchor: defineReference(
    "End Anchor",
    "RE$",
    "Matches only at the end of the string being searched.",
  ),
  wildcard: defineReference(
    "Any-Character Expression",
    ".",
    "Matches any character in the supported character set except NUL.",
  ),
  zero_or_more_operator: defineReference(
    "Zero-or-More Duplication",
    "RE*",
    "Matches zero or more consecutive occurrences of RE.",
  ),
  one_or_more_operator: defineReference(
    "One-or-More Duplication",
    "RE+",
    "Matches one or more consecutive occurrences of RE.",
  ),
  zero_or_one_operator: defineReference(
    "Zero-or-One Duplication",
    "RE?",
    "Matches zero or one occurrence of RE.",
  ),
  ere_alternation_operator: defineReference(
    "Alternation",
    "RE|RE",
    "Matches either the expression on the left or the right.",
  ),
  bracket_expression: defineReference(
    "Bracket Expression",
    "[list]",
    "Matches a character, and may match a multi-character collating element, represented by its non-empty list.",
  ),
  nonmatching_list: defineReference(
    "Non-Matching List",
    "[^list]",
    "Makes the bracket expression match a character not represented by its list.",
  ),
  range_expression: defineReference(
    "Range Expression",
    "[start-end]",
    "In the POSIX locale, represents the collating elements from start through end, inclusive; its behavior in other locales is unspecified.",
  ),
  character_class: defineReference(
    "Character Class Expression",
    "[[:class:]]",
    "Represents the set of characters belonging to this locale-defined character class.",
  ),
  collating_symbol: defineReference(
    "Collating Symbol",
    "[[.element.]]",
    "Represents this collating element as a single bracket-expression element.",
  ),
  equivalence_class: defineReference(
    "Equivalence Class Expression",
    "[[=element=]]",
    "Represents the set of collating elements in the same equivalence class as this element.",
  ),
});

function namedCharacterClassReference(name, title, description) {
  return defineReference(
    `${title} Character Class`,
    `[[:${name}:]]`,
    description,
  );
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

export function commandReferenceForVerb(verb) {
  return commandReferenceByVerb.get(verb);
}

export function substitutionFlagReferenceForType(nodeType) {
  return substitutionFlagReferenceByType.get(nodeType);
}

export function addressReference(kind, synopsis) {
  if (kind === "contextAddress") {
    return defineReference(
      "Context Address",
      synopsis,
      "Selects each pattern space that matches RE; use /RE/ or \\cREc, where c is any character other than backslash or newline.",
    );
  }
  if (kind === "emptyRegularExpression") {
    return defineReference(
      "Empty Regular Expression",
      synopsis,
      "Behaves as if the most recently applied regular expression from a context address or substitute command were specified.",
    );
  }
  return addressReferences[kind];
}

export function replacementReference(kind, value) {
  if (kind === "replacement_backreference") {
    return defineReference(
      "Back-Reference",
      `s/RE/\\${value}/`,
      `Inserts the text matched by regular-expression subexpression ${value}, or an empty string if that subexpression did not match.`,
    );
  }
  if (kind === "replacement_escaped_delimiter") {
    return defineReference(
      "Literal Delimiter",
      `s${value}RE${value}\\${value}${value}`,
      "Inserts the substitution delimiter as a literal character.",
    );
  }
  if (kind === "replacement_escape") {
    return replacementReferences[value];
  }
  return replacementReferences[kind];
}

export function regularExpressionReference(kind, value) {
  if (kind === "repetition_modifier") {
    return defineReference(
      "Minimal Repetition Modifier",
      value,
      "Makes the preceding duplication prefer the shortest match that permits the complete ERE to match.",
    );
  }
  if (kind === "group") {
    return defineReference(
      "Subexpression",
      value === "bre" ? "\\(RE\\)" : "(RE)",
      "Groups RE as one expression; duplication applies to the group as a whole.",
    );
  }
  if (kind === "interval") {
    return defineReference(
      "Interval Duplication",
      value === "bre" ? "RE\\{m,n\\}" : "RE{m,n}",
      "Matches a number of consecutive occurrences of RE within the interval's minimum and optional maximum bounds.",
    );
  }
  if (kind === "backreference") {
    return defineReference(
      "Back-Reference",
      `\\${value}`,
      `Matches the same string matched by preceding BRE subexpression ${value}.`,
    );
  }
  if (kind === "character_class") {
    return Object.hasOwn(characterClassReferences, value)
      ? characterClassReferences[value]
      : regularExpressionReferences[kind];
  }
  return regularExpressionReferences[kind];
}

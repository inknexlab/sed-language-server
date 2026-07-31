# sed-language-server

[![npm version](https://img.shields.io/npm/v/@inknexlab/sed-language-server)](https://www.npmjs.com/package/@inknexlab/sed-language-server)

A Language Server Protocol implementation for the POSIX.1-2024 `sed`
specification.

## Installation

Requires Node.js 22 or later.

```sh
npm install --global @inknexlab/sed-language-server
```

## Features

- POSIX syntax and static semantic diagnostics
- One-command-per-line formatting with block indentation
- Label definitions, references, and rename

## Emacs

Emacs does not include a major mode for `sed`. After defining one, register its
mode symbol with Eglot:

```elisp
(require 'eglot)

(add-to-list 'eglot-server-programs
             '(your-sed-mode .
               ("sed-language-server" "--stdio")))
```

The server uses POSIX Basic Regular Expressions by default. To use POSIX
Extended Regular Expressions, add the `regex` initialization option to the
server entry:

```elisp
(add-to-list 'eglot-server-programs
             '(your-sed-mode .
               ("sed-language-server" "--stdio"
                :initializationOptions (:regex "ere"))))
```

The selected regular expression mode remains fixed for the server process.

## Diagnostics

The server consumes the POSIX CST from
[tree-sitter-sed](https://github.com/inknexlab/tree-sitter-sed). Incomplete and
nonconforming syntax is reported as an error. Undefined, unspecified,
implementation-defined, and implementation-option syntax is reported as a
warning.

Document-level checks cover regular expression and replacement
back-references, interval limits, substitution flags, translation strings,
labels, write files, and use of an empty regular expression before a previous
one exists.

## License

[MIT](LICENSE)

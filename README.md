# sed-language-server

[![npm version](https://img.shields.io/npm/v/@inknexlab/sed-language-server)](https://www.npmjs.com/package/@inknexlab/sed-language-server)

A language server for POSIX.1-2024 `sed`.

## Installation

Requires Node.js 22 or later.

```sh
npm install --global @inknexlab/sed-language-server
```

## Features

- Completion
- Diagnostics
- Find References
- Formatting
- Go to Definition
- Hover

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

## License

[MIT](LICENSE)

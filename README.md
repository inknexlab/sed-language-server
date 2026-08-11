# sed-language-server

[![npm version](https://img.shields.io/npm/v/@inknexlab/sed-language-server)](https://www.npmjs.com/package/@inknexlab/sed-language-server)

A language server for POSIX.1-2024 `sed`.

## Requirements

- Node.js 22 or later

## Installation

```sh
npm install --global @inknexlab/sed-language-server
```

## Features

- Diagnostics
- Find References
- Formatting
- Go to Definition
- Hover

## Emacs

Install `sed-ts-mode` and either Eglot or `lsp-mode`.

For Eglot:

```elisp
(require 'eglot)

(add-to-list 'eglot-server-programs
             '((sed-ts-mode :language-id "sed")
               .
               ("sed-language-server" "--stdio")))
(add-hook 'sed-ts-mode-hook #'eglot-ensure)
```

For `lsp-mode`:

```elisp
(require 'lsp-mode)

(add-to-list 'lsp-language-id-configuration '(sed-ts-mode . "sed"))
(add-hook 'sed-ts-mode-hook #'lsp-deferred)
```

The server uses POSIX Basic Regular Expressions by default. To use POSIX
Extended Regular Expressions with Eglot, replace the server entry above with:

```elisp
(add-to-list 'eglot-server-programs
             '((sed-ts-mode :language-id "sed")
               .
               ("sed-language-server" "--stdio"
                :initializationOptions (:regex "ere"))))
```

The selected regular expression mode remains fixed for the server process.

## Parser

Includes a WebAssembly parser generated from
[tree-sitter-posix-sed](https://github.com/inknexlab/tree-sitter-posix-sed).
Its source revision is recorded in `vendor/tree-sitter-posix-sed.json`.

## License

[MIT](LICENSE)

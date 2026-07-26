# sed-language-server

[![CI](https://github.com/inknexlab/sed-language-server/actions/workflows/ci.yml/badge.svg)](https://github.com/inknexlab/sed-language-server/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@inknexlab/sed-language-server)](https://www.npmjs.com/package/@inknexlab/sed-language-server)

A Language Server Protocol implementation for POSIX and GNU `sed`, with
explicit BRE and ERE support.

## Installation

Requires Node.js 22 or later.

```sh
npm install --global @inknexlab/sed-language-server
```

## Features

- Diagnostics
- Document formatting
- Find references
- Go to definition
- Rename labels

## Configuration

Pass `dialect` and `regex` as LSP initialization options:

| `dialect` | `regex` | Syntax |
| --- | --- | --- |
| `"posix"` | `"bre"` | POSIX sed with basic regular expressions |
| `"posix"` | `"ere"` | POSIX sed with extended regular expressions |
| `"gnu"` | `"bre"` | GNU sed with basic regular expressions |
| `"gnu"` | `"ere"` | GNU sed with extended regular expressions |

The defaults are `"posix"` and `"bre"`. The selection remains fixed for the
server process.

## Editor setup

Configure the LSP client to run `sed-language-server --stdio` for the `sed`
language ID or filetype.

### Emacs

```elisp
(require 'eglot)

(add-to-list 'eglot-server-programs
             '((sed-ts-mode sed-mode) .
               ("sed-language-server" "--stdio"
                :initializationOptions (:dialect "posix" :regex "bre"))))
```

Run `M-x eglot` in a `sed-ts-mode` or `sed-mode` buffer.

### Neovim

```lua
vim.lsp.config("sed_language_server", {
  cmd = { "sed-language-server", "--stdio" },
  filetypes = { "sed" },
  init_options = { dialect = "posix", regex = "bre" },
})

vim.lsp.enable("sed_language_server")
```

## Parser

Parsing is powered by the
[tree-sitter-sed](https://github.com/inknexlab/tree-sitter-sed) grammars.

## License

[MIT](LICENSE)

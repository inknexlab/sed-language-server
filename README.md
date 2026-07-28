# sed-language-server

[![CI](https://github.com/inknexlab/sed-language-server/actions/workflows/ci.yml/badge.svg)](https://github.com/inknexlab/sed-language-server/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@inknexlab/sed-language-server)](https://www.npmjs.com/package/@inknexlab/sed-language-server)

A Language Server Protocol implementation for POSIX and GNU `sed`.

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

## Editor setup

Configure the LSP client to run `sed-language-server --stdio` for the `sed`
language ID or filetype.

### Neovim

```lua
vim.lsp.config("sed_language_server", {
  cmd = { "sed-language-server", "--stdio" },
  filetypes = { "sed" },
})

vim.lsp.enable("sed_language_server")
```

### Emacs

Emacs does not include a major mode for `sed`. After installing or defining
one, register its mode symbol with Eglot:

```elisp
(require 'eglot)

(add-to-list 'eglot-server-programs
             '(your-sed-mode .
               ("sed-language-server" "--stdio")))
```

## Variants

The default syntax is GNU `sed` 4.10 using Basic Regular Expressions (BRE).
Pass `dialect` and `regex` as LSP initialization options to select another
syntax:

| `dialect` | `regex` | Syntax |
| --- | --- | --- |
| `"gnu"` | `"bre"` | GNU sed with basic regular expressions |
| `"gnu"` | `"ere"` | GNU sed with extended regular expressions |
| `"posix"` | `"bre"` | POSIX sed with basic regular expressions |
| `"posix"` | `"ere"` | POSIX sed with extended regular expressions |

Either option may be omitted; its axis keeps the default shown above.
The selection remains fixed for the server process.

### Neovim

```lua
init_options = { dialect = "posix", regex = "ere" }
```

### Emacs

```elisp
:initializationOptions (:dialect "posix" :regex "ere")
```

## Parser

Parsing is powered by the
[tree-sitter-sed](https://github.com/inknexlab/tree-sitter-sed) grammars.

## License

[MIT](LICENSE)

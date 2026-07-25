# sed-language-server

[![CI](https://github.com/inknexlab/sed-language-server/actions/workflows/ci.yml/badge.svg)](https://github.com/inknexlab/sed-language-server/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@inknexlab/sed-language-server)](https://www.npmjs.com/package/@inknexlab/sed-language-server)

A Language Server Protocol implementation for POSIX and GNU `sed`.

## Installation

Requires Node.js 22 or later.

```sh
npm install --global @inknexlab/sed-language-server
```

Start the server with:

```sh
sed-language-server --stdio
```

## Features

- Tree-sitter-based diagnostics
- go to definition from `b`, `t`, and GNU `T` label references
- document formatting for command lists and nested blocks

## Configuration

The default dialect is `posix`. To use GNU syntax, pass the following LSP
initialization options:

```json
{
  "dialect": "gnu"
}
```

## Editor setup

Configure the LSP client to run `sed-language-server --stdio` for the `sed`
language ID or filetype. The examples enable GNU syntax; omit the dialect
option to use the default POSIX dialect.

For example, with Emacs and Eglot:

```elisp
(require 'eglot)

(add-to-list 'eglot-server-programs
             '((sed-ts-mode sed-mode) .
               ("sed-language-server" "--stdio"
                :initializationOptions (:dialect "gnu"))))
```

Run `M-x eglot` in a `sed-ts-mode` or `sed-mode` buffer.

For Neovim 0.11 or later:

```lua
vim.lsp.config("sed_language_server", {
  cmd = { "sed-language-server", "--stdio" },
  filetypes = { "sed" },
  init_options = { dialect = "gnu" },
})

vim.lsp.enable("sed_language_server")
```

## Development

```sh
npm ci
npm run check
npm test
```

To rebuild the bundled grammar Wasm files from `tree-sitter-sed`:

```sh
npm run build:grammar -- /path/to/tree-sitter-sed
```

## License

[MIT](LICENSE)

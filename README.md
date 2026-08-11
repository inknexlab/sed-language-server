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

## Parser

Includes a WebAssembly parser generated from
[tree-sitter-posix-sed](https://github.com/inknexlab/tree-sitter-posix-sed).
Its source revision is recorded in `vendor/tree-sitter-posix-sed.json`.

## License

[MIT](LICENSE)

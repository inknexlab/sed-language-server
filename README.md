# sed-language-server

[![npm version](https://img.shields.io/npm/v/@inknexlab/sed-language-server)](https://www.npmjs.com/package/@inknexlab/sed-language-server)

A language server for POSIX.1-2024 `sed`.

## Requirements

- Node.js 22 or later

## Installation

```sh
npm install --global @inknexlab/sed-language-server
```

## Usage

Start the server over standard input and output:

```sh
sed-language-server --stdio
```

Select the regular-expression mode at initialization with `regex`: `bre`
(default) or `ere`.

## Features

- Diagnostics
- Formatting

## Parser

Includes a WebAssembly parser generated from
[tree-sitter-posix-sed](https://github.com/inknexlab/tree-sitter-posix-sed).

## License

[MIT](LICENSE)

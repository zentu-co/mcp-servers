# svelte-docs-server MCP Server

An MCP to access the docs for Svelte 5 present in llms.small.txt file

This is a TypeScript-based MCP server that provides access to Svelte 5 documentation. It demonstrates core MCP concepts by providing:

- Resources representing documentation lines with URIs
- Tools for searching documentation

## Features

### Resources

- List and access documentation lines via `svelte://` URIs
- Each line contains a portion of the Svelte documentation
- Plain text mime type for simple content access

### Tools

- `search_docs` - Search Svelte documentation
  - Takes a search query as a required parameter
  - Returns relevant documentation lines

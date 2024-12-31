# MCP Servers Monorepo

This monorepo contains MCP (Model Context Protocol) server implementations for various purposes, managed using pnpm workspaces.

## Packages

- [svelte-docs-server](./svelte-docs-server) - MCP server for accessing Svelte 5 documentation

## Development Setup

1. Install pnpm if not already installed:

   ```bash
   npm install -g pnpm
   ```

2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Build all packages:

   ```bash
   pnpm run build
   ```

4. For development with auto-rebuild:
   ```bash
   pnpm run watch
   ```

## Installation

To use with Claude Desktop, add the server config:

On MacOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
On Windows: `%APPDATA%/Claude/claude_desktop_config.json`

It can also be used with Cline, a VSCode extension that makes it easy to use [MCP servers](https://github.com/cline/cline/releases/tag/v2.2.0) right from the editor. Just tell Cline the route to your cloned repo with this MCP and it should handle everything or at least tell you what to do.

```json
{
  "mcpServers": {
    "svelte-docs-server": {
      "command": "/path/to/svelte-docs-server/build/index.js"
    }
  }
}
```

## Usage

Each package contains its own README with specific usage instructions. Refer to the package's documentation for details.

## Debugging

For debugging MCP servers, we recommend using the [MCP Inspector](https://github.com/modelcontextprotocol/inspector). You can run it using:

```bash
pnpm run inspector
```

The Inspector will provide a URL to access debugging tools in your browser.

#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
interface DocumentationLine {
  id: string;
  text: string;
}

let documentationLines: DocumentationLine[] = [];

async function fetchDocumentation() {
  let retries = 3;
  while (retries > 0) {
    try {
      console.log(`Fetching Svelte documentation (attempt ${4 - retries})...`);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch("https://svelte.dev/llms-small.txt", {
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const content = await response.text();

      // Simply split into lines
      const lines = content.split('\n');
      documentationLines = lines.map((line: string, index: number) => ({
        id: `line-${index}`,
        text: line
      }));

      console.log("Successfully fetched Svelte documentation");
      console.log(`Loaded ${documentationLines.length} lines of documentation`);
      // Log a few sample lines to verify content
      console.log("Sample lines:");
      documentationLines.slice(0, 3).forEach(line => {
        console.log(`- ${line.text}`);
      });
      return;
    } catch (error) {
      console.error("Failed to fetch Svelte documentation:", error instanceof Error ? error.message : String(error));
      retries--;
      if (retries > 0) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      } else {
        console.error("Exhausted all retry attempts");
        process.exit(1);
      }
    }
  }
}

const server = new Server(
  {
    name: "svelte-docs-server",
    version: "1.0.0",
    description: "Provides access to Svelte documentation"
  },
  {
    capabilities: {
      resources: {
        listChanged: false
      },
      tools: {
        listChanged: false
      },
    },
  }
);

// List available documentation lines as resources
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  console.log(`Total documentation lines: ${documentationLines.length}`);
  const resources = documentationLines.map(line => ({
    uri: `svelte:///${line.id}`,
    mimeType: "text/plain",
    name: "Documentation Line",
    description: `Svelte documentation line: ${line.text.slice(0, 50)}...`
  }));
  console.log("First 5 resources:");
  resources.slice(0, 5).forEach(r => console.log(`- ${r.uri}: ${r.description}`));
  return { resources };
});

// Read specific documentation line
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const id = request.params.uri.split('/').pop();
  const line = documentationLines.find(l => l.id === id);

  if (!line) {
    throw new Error(`Documentation line ${id} not found`);
  }

  return {
    contents: [{
      uri: request.params.uri,
      mimeType: "text/plain",
      text: line.text
    }]
  };
});

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "search_docs",
        description: "Search Svelte documentation",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query"
            }
          },
          required: ["query"]
        }
      }
    ]
  };
});

// Handle search_docs tool
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "search_docs") {
    const query = String(request.params.arguments?.query).toLowerCase();
    console.log(`Searching for query: "${query}"`);
    const queryWords = query.split(/\s+/);
    console.log(`Query words:`, queryWords);

    // Score lines based purely on frequency of query matches
    const scoredLines = documentationLines.map(line => {
      const text = line.text;
      // Escape special regex characters and count exact occurrences
      const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matches = (text.match(new RegExp(escapedQuery, 'gi')) || []).length;
      return { ...line, score: matches };
    });

    // Get top 3 lines with most matches
    const results = scoredLines
      .filter(line => line.score > 0) // Only include lines with matches
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(line => ({
        uri: `svelte:///${line.id}`,
        content: line.text
      }));

    // Ensure we return an empty array if no results found
    return {
      content: results.length > 0 ? results.map(result => ({
        type: "text",
        text: result.content
      })) : [{
        type: "text",
        text: "No matches found"
      }]
    };
  }

  throw new Error("Unknown tool");
});

// Start the server
async function main() {
  console.log("Starting svelte-docs-server...");
  try {
    await fetchDocumentation();
    console.log("Documentation loaded successfully");

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.log("Successfully connected to MCP");
  } catch (error) {
    console.error("Error during server startup:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});

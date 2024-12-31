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

      // Split into lines and filter out empty ones
      const lines = content.split('\n');
      documentationLines = lines
        .filter((line: string) => line.trim().length > 0)
        .map((line: string, index: number) => ({
          id: `line-${index}`,
          text: line
        }));
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
  const resources = documentationLines.map(line => ({
    uri: `svelte:///${line.id}`,
    mimeType: "text/plain",
    name: "Documentation Line",
    description: `Svelte documentation line: ${line.text.slice(0, 50)}...`
  }));
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
    const queryWords = query.split(/\s+/).filter(word => word.length > 0);

    if (queryWords.length === 0) {
      return {
        content: [{
          type: "text",
          text: "Please provide a valid search query"
        }]
      };
    }

    // Search each word separately and get top results
    const wordResults = queryWords.map(word => {
      // Score lines based on frequency of word matches
      const scoredLines = documentationLines.map(line => {
        const text = line.text.toLowerCase();
        // Escape special regex characters and count exact occurrences
        const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const matches = (text.match(new RegExp(escapedWord, 'gi')) || []).length;
        return { ...line, score: matches };
      });

      // Get top result for this word
      return scoredLines
        .filter(line => line.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 1)
        .map(line => ({
          word,
          uri: `svelte:///${line.id}`,
          content: line.text
        }))[0];
    }).filter(result => result !== undefined);

    // Return results or no matches message
    return {
      content: wordResults.length > 0 ? wordResults.map(result => ({
        type: "text",
        text: `Match for "${result.word}": ${result.content}`
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
  try {
    await fetchDocumentation();
    const transport = new StdioServerTransport();
    await server.connect(transport);
  } catch (error) {
    console.error("Error during server startup:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});

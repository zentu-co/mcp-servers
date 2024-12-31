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
      resources: {},
      tools: {},
    },
  }
);

// List available documentation lines as resources
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: documentationLines.map(line => ({
      uri: `svelte:///${line.id}`,
      mimeType: "text/plain",
      name: "Documentation Line",
      description: `Svelte documentation line`
    }))
  };
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
    const queryWords = query.split(/\s+/);

    // Calculate TF-IDF scores for all words in documentation
    const wordCounts = new Map<string, number>();
    const docFreq = new Map<string, number>();

    // First pass: count word frequencies and document frequencies
    documentationLines.forEach(line => {
      const words = line.text.toLowerCase().match(/\w+/g) || [];
      const uniqueWords = new Set(words);

      uniqueWords.forEach(word => {
        docFreq.set(word, (docFreq.get(word) || 0) + 1);
      });

      words.forEach(word => {
        wordCounts.set(word, (wordCounts.get(word) || 0) + 1);
      });
    });

    // Second pass: score each line based on query words
    const scoredLines = documentationLines.map(line => {
      const text = line.text.toLowerCase();
      const words = text.match(/[\w$\.]+/g) || [];
      const totalWords = words.length;

      let score = 0;
      queryWords.forEach(queryWord => {
        // Exact match bonus
        const exactMatches = words.filter(w => w === queryWord).length;
        // Partial match
        const partialMatches = words.filter(w => w.includes(queryWord)).length;
        // Full text match bonus
        const fullTextMatch = text.includes(queryWord) ? 1 : 0;

        // Calculate TF-IDF
        const tf = (exactMatches * 2 + partialMatches + fullTextMatch) / totalWords;
        const idf = Math.log(documentationLines.length / (docFreq.get(queryWord) || 1));

        score += tf * idf;
      });

      // Add bonus for exact phrase match
      if (text.includes(query.toLowerCase())) {
        score *= 2;
      }

      // Bonus for multiple query words appearing close together
      const allWordsIndexes = queryWords.map(word =>
        words.findIndex(w => w.includes(word))
      ).filter(index => index !== -1);

      if (allWordsIndexes.length > 1) {
        const maxIndex = Math.max(...allWordsIndexes);
        const minIndex = Math.min(...allWordsIndexes);
        if (maxIndex - minIndex <= 3) {
          score *= 1.5; // Boost score for close proximity
        }
      }

      return { ...line, score };
    });

    // Get top 3 scoring lines
    const results = scoredLines
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map(line => ({
        uri: `svelte:///${line.id}`,
        content: line.text
      }));

    return {
      content: results.map(result => ({
        type: "text",
        text: result.content
      }))
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

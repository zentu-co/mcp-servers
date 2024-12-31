#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

interface DocumentationLine {
  text: string;
  isHeader: boolean;
}

interface DocumentationSection {
  id: string;
  header: string;
  content: string[];
}

let documentationSections: DocumentationSection[] = [];

// Improved relevance scoring
function getRelevanceScore(text: string, query: string): number {
  text = text.toLowerCase();
  query = query.toLowerCase();

  // Exact match gets highest score
  if (text.includes(query)) return 3;

  // Count individual word matches
  const queryWords = query.split(/\s+/);
  return queryWords.reduce((score, word) => {
    return score + (text.includes(word) ? 1 : 0);
  }, 0);
}

async function fetchDocumentation() {
  let retries = 3;
  let error: Error | null = null;
  while (retries > 0) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch("https://svelte.dev/llms-small.txt", {
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new McpError(ErrorCode.InternalError, `HTTP error! status: ${response.status}`);
      }
      const content = await response.text();
      if (!content) {
        throw new McpError(ErrorCode.InternalError, "Received empty content from documentation URL");
      }

      // Split into lines and filter out empty ones
      const lines = content.split('\n')
        .filter((line: string) => line.trim().length > 0)
        .map((line: string) => ({
          text: line.trim(), // Ensure no leading/trailing whitespace
          isHeader: line.trim().startsWith('# ')
        }));

      if (lines.length === 0) {
        throw new McpError(ErrorCode.InternalError, "No content lines found in documentation");
      }

      // Process lines into sections
      let currentSection: DocumentationSection | null = null;
      documentationSections = [];

      // Create initial section
      currentSection = {
        id: 'start-of-svelte-documentation',
        header: '# Start of Svelte documentation',
        content: []
      };

      lines.forEach(line => {
        if (line.isHeader && line.text.trim() !== '# Start of Svelte documentation') {
          if (currentSection) {
            documentationSections.push(currentSection);
          }
          currentSection = {
            id: line.text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^#+\s*/, ''),
            header: line.text,
            content: []
          };
        } else if (currentSection) {
          currentSection.content.push(line.text.trim());
        }
      });

      // Add the last section
      if (currentSection) {
        documentationSections.push(currentSection);
      }

      // Validate sections were loaded
      if (documentationSections.length === 0) {
        throw new McpError(ErrorCode.InternalError, "No documentation sections were loaded");
      }

      // Success - break out of retry loop
      break;
    } catch (err) {
      error = err instanceof Error ? err : new Error(String(err));
      retries--;
      if (retries > 0) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }
  if (error) {
    throw new McpError(ErrorCode.InternalError, `Failed to fetch documentation after all retries: ${error.message}`);
  }
  if (documentationSections.length === 0) {
    throw new McpError(ErrorCode.InternalError, "No documentation sections were loaded");
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

// Add error handler
server.onerror = (error) => {
  console.error(`[MCP Error] ${error}`);
};

// List available documentation sections as resources
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const resources = documentationSections.flatMap(section => [
    {
      uri: `svelte:///section/${section.id}`,
      mimeType: "text/plain",
      name: section.header,
      description: `Documentation section: ${section.header}`
    },
    {
      uri: `svelte:///section/${section.id}/content`,
      mimeType: "text/plain",
      name: `${section.header} Content`,
      description: `Content for section: ${section.header}`
    }
  ]);
  return { resources };
});

// Read specific documentation section or content
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const match = request.params.uri.match(/^svelte:\/\/\/section\/([^/]+)(\/content)?$/);
  if (!match) {
    throw new McpError(ErrorCode.InvalidRequest, `Invalid URI format: ${request.params.uri}`);
  }

  const sectionId = match[1];
  const isContent = match[2] === '/content';
  const section = documentationSections.find(s => s.id === sectionId);

  if (!section) {
    throw new McpError(ErrorCode.InvalidRequest, `Documentation section ${sectionId} not found`);
  }

  const text = isContent ? section.content.join('\n') : section.header;

  // Throw error if content is empty for debugging
  if (isContent && (!section.content || section.content.length === 0)) {
    throw new McpError(ErrorCode.InternalError, `Section ${sectionId} has no content. Header: ${section.header}`);
  }

  return {
    contents: [{
      uri: request.params.uri,
      mimeType: "text/plain",
      text
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

    // Search through all content
    const allContent = documentationSections.flatMap(section =>
      section.content.map(text => ({
        header: section.header,
        text,
        score: getRelevanceScore(text, query)
      }))
    );

    // Get top 3 results
    const results = allContent
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    // Return results or no matches message
    return {
      content: results.length > 0 ? results.map(result => ({
        type: "text",
        text: `[${result.header}] ${result.text}`
      })) : [{
        type: "text",
        text: "No matches found"
      }]
    };
  }

  throw new McpError(ErrorCode.MethodNotFound, "Unknown tool");
});

// Start the server
async function main() {
  try {
    await fetchDocumentation();
    const transport = new StdioServerTransport();
    await server.connect(transport);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    throw new McpError(ErrorCode.InternalError, `Server startup failed: ${error.message}`);
  }
}

main().catch((err) => {
  const error = err instanceof McpError ? err : new McpError(ErrorCode.InternalError, String(err));
  console.error(`[MCP Error] ${error.message}`);
  process.exit(1);
});

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "devcontext", version: "0.1.0" });

server.registerTool(
  "ping",
  {
    description: "Health check. Returns pong.",
    inputSchema: {
      message: z.string().optional().describe("Optional text to echo"),
    },
  },
  async ({ message }) => ({
    content: [{ type: "text", text: `pong${message ? `: ${message}` : ""}` }],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("devcontext MCP server running on stdio");

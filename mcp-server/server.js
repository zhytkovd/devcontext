import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getRepoStructure, readFile, searchCode } from "./github.js";

const server = new McpServer({ name: "devcontext", version: "0.1.0" });

const ownerRepo = {
  owner: z
    .string()
    .describe("GitHub user or organization, e.g. 'BCStudentSoftwareDevTeam'"),
  repo: z.string().describe("Repository name, e.g. 'lsf'"),
};

/** Wrap a tool body so any thrown error becomes a readable MCP error result. */
function tool(fn) {
  return async (args) => {
    try {
      const result = await fn(args);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const status = err.status ? ` (HTTP ${err.status})` : "";
      return {
        isError: true,
        content: [{ type: "text", text: `Error${status}: ${err.message}` }],
      };
    }
  };
}

server.registerTool(
  "repo_structure",
  {
    description:
      "List the files in a GitHub repository (default branch). Optionally restrict to a " +
      "directory with 'path'. Use this first to orient yourself before reading files.",
    inputSchema: {
      ...ownerRepo,
      path: z
        .string()
        .optional()
        .describe(
          "Directory to list, e.g. 'app/models'. Omit for the whole repo.",
        ),
    },
  },
  tool(({ owner, repo, path }) => getRepoStructure(owner, repo, path ?? "")),
);

server.registerTool(
  "read_file",
  {
    description:
      "Read the contents of a single file from a GitHub repository (default branch). " +
      "Large files are truncated; the response says so.",
    inputSchema: {
      ...ownerRepo,
      path: z.string().describe("File path within the repo, e.g. 'app/app.py'"),
    },
  },
  tool(({ owner, repo, path }) => readFile(owner, repo, path)),
);

server.registerTool(
  "search_code",
  {
    description:
      "Search for code in a GitHub repository by keyword or identifier. Returns matching " +
      "file paths. Good for finding where a function, class, or string is defined or used.",
    inputSchema: {
      ...ownerRepo,
      query: z
        .string()
        .describe(
          "Search terms, e.g. 'def resetDatabase' or 'LaborStatusForm'",
        ),
    },
  },
  tool(({ owner, repo, query }) => searchCode(owner, repo, query)),
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error("devcontext MCP server running on stdio");

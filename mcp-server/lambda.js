import { fileURLToPath } from "node:url";
import {
  APIGatewayProxyEventHandler,
  StdioServerAdapterRequestHandler,
} from "@aws/run-mcp-servers-with-aws-lambda";

// Absolute path to server.js, wherever this bundle is unpacked.
const serverPath = fileURLToPath(new URL("./server.js", import.meta.url));

// The child process does not inherit the Lambda environment, so pass through
// exactly what the server needs and nothing else.
const serverParams = {
  command: process.execPath, // the same node binary Lambda is running
  args: [serverPath],
  env: {
    PATH: process.env.PATH ?? "",
    GITHUB_TOKEN: process.env.GITHUB_TOKEN ?? "",
  },
};

const requestHandler = new APIGatewayProxyEventHandler(
  new StdioServerAdapterRequestHandler(serverParams),
);

export const handler = async (event, context) =>
  requestHandler.handle(event, context);

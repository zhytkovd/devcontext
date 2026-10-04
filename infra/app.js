import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { App, Stack, Duration, CfnOutput } from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import {
  HttpApi,
  HttpMethod,
  PayloadFormatVersion,
} from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";

const __dirname = dirname(fileURLToPath(import.meta.url));
const mcpServerDir = join(__dirname, "..", "mcp-server");

/** Read KEY=value lines from mcp-server/.env so secrets never live in this file. */
function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const vars = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m) vars[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return vars;
}

const env = { ...loadEnvFile(join(mcpServerDir, ".env")), ...process.env };
if (!env.GITHUB_TOKEN) {
  throw new Error(
    "GITHUB_TOKEN not found. Put it in mcp-server/.env or set it in the environment.",
  );
}

class DevContextStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    // --- MCP server Lambda -------------------------------------------------
    const mcpFunction = new lambda.Function(this, "McpServerFunction", {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "lambda.handler",
      code: lambda.Code.fromAsset(mcpServerDir, {
        exclude: [".env", ".env.*", ".gitkeep", "*.log"],
      }),
      memorySize: 1024,
      timeout: Duration.seconds(60),
      environment: {
        GITHUB_TOKEN: env.GITHUB_TOKEN,
      },
    });

    // --- Public HTTP endpoint ---------------------------------------------
    const api = new HttpApi(this, "McpApi", {
      apiName: "devcontext-mcp",
    });

    api.addRoutes({
      path: "/mcp",
      methods: [HttpMethod.ANY],
      integration: new HttpLambdaIntegration("McpIntegration", mcpFunction, {
        // The AWS MCP adapter expects the v1 (REST-style) event shape.
        payloadFormatVersion: PayloadFormatVersion.VERSION_1_0,
      }),
    });

    new CfnOutput(this, "McpUrl", {
      value: `${api.apiEndpoint}/mcp`,
      description: "Streamable HTTP MCP endpoint",
    });
  }
}

const app = new App();
new DevContextStack(app, "DevContextStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});

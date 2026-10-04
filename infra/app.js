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
const apiServerDir = join(__dirname, "..", "api-server");

/** Read KEY=value lines from a .env file so secrets never live in this file. */
function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const vars = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m) vars[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return vars;
}

const env = {
  ...loadEnvFile(join(mcpServerDir, ".env")),
  ...loadEnvFile(join(apiServerDir, ".env")),
  ...process.env,
};
for (const key of ["GITHUB_TOKEN", "OPENAI_API_KEY"]) {
  if (!env[key])
    throw new Error(
      `${key} not found in mcp-server/.env, api-server/.env, or the environment.`,
    );
}

const ASSET_EXCLUDES = [".env", ".env.*", ".gitkeep", "*.log"];

class DevContextStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props);

    // --- MCP server Lambda + HTTP API --------------------------------------
    const mcpFunction = new lambda.Function(this, "McpServerFunction", {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "lambda.handler",
      code: lambda.Code.fromAsset(mcpServerDir, { exclude: ASSET_EXCLUDES }),
      memorySize: 1024,
      timeout: Duration.seconds(60),
      environment: { GITHUB_TOKEN: env.GITHUB_TOKEN },
    });

    const mcpApi = new HttpApi(this, "McpApi", { apiName: "devcontext-mcp" });
    mcpApi.addRoutes({
      path: "/mcp",
      methods: [HttpMethod.ANY],
      integration: new HttpLambdaIntegration("McpIntegration", mcpFunction, {
        payloadFormatVersion: PayloadFormatVersion.VERSION_1_0,
      }),
    });
    const mcpUrl = `${mcpApi.apiEndpoint}/mcp`;

    // --- Chat Lambda + Function URL ----------------------------------------
    // A Function URL instead of API Gateway: no 30-second timeout, which
    // matters when the model chains several tool calls before answering.
    const chatFunction = new lambda.Function(this, "ChatFunction", {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: "handler.handler",
      code: lambda.Code.fromAsset(apiServerDir, { exclude: ASSET_EXCLUDES }),
      memorySize: 512,
      timeout: Duration.seconds(120),
      environment: {
        OPENAI_API_KEY: env.OPENAI_API_KEY,
        OPENAI_MODEL: env.OPENAI_MODEL ?? "gpt-6-sol",
        MCP_SERVER_URL: mcpUrl,
      },
    });

    const chatUrl = chatFunction.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ["*"], // tightened to the Amplify domain in Phase 5
        allowedMethods: [lambda.HttpMethod.POST],
        allowedHeaders: ["Content-Type"],
      },
    });

    new CfnOutput(this, "McpUrl", {
      value: mcpUrl,
      description: "Streamable HTTP MCP endpoint",
    });
    new CfnOutput(this, "ChatUrl", {
      value: chatUrl.url,
      description: "POST a question here",
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

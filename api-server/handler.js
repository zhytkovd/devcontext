const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MCP_SERVER_URL = process.env.MCP_SERVER_URL;
const MODEL = process.env.OPENAI_MODEL || "gpt-6-sol";

const INSTRUCTIONS = `You are DevContext, an assistant that answers questions about a GitHub repository.
You have tools to list the repo's files, read any file, and search its code.
Always ground answers in what the tools return: call repo_structure first if you are unsure
where something lives, then read_file for details. Never guess file contents.
When you answer, cite the file paths you relied on. Be concise and specific.`;

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export const handler = async (event) => {
  // Function URLs deliver the body as a string (possibly base64-encoded).
  let payload;
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body ?? "", "base64").toString("utf8")
      : (event.body ?? "{}");
    payload = JSON.parse(raw);
  } catch {
    return json(400, { error: "Request body must be JSON." });
  }

  const { question, owner, repo } = payload;
  if (!question || !owner || !repo) {
    return json(400, { error: "Required fields: question, owner, repo." });
  }

  const request = {
    model: MODEL,
    instructions: INSTRUCTIONS,
    input: `Repository: ${owner}/${repo}\n\nQuestion: ${question}`,
    tools: [
      {
        type: "mcp",
        server_label: "devcontext",
        server_description:
          "Tools for exploring the GitHub repository being discussed.",
        server_url: MCP_SERVER_URL,
        require_approval: "never",
      },
    ],
  };

  let data;
  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify(request),
    });
    data = await res.json();
    if (!res.ok) {
      console.error("OpenAI error:", JSON.stringify(data));
      return json(502, {
        error: data.error?.message ?? `OpenAI returned ${res.status}`,
      });
    }
  } catch (err) {
    console.error("OpenAI request failed:", err);
    return json(502, { error: "Could not reach OpenAI." });
  }

  // Pull the final text and a summary of each tool call out of the output items.
  const answer = (data.output ?? [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text")
    .map((part) => part.text)
    .join("\n");

  const toolCalls = (data.output ?? [])
    .filter((item) => item.type === "mcp_call")
    .map((item) => ({
      tool: item.name,
      arguments: safeParse(item.arguments),
      error: item.error ?? null,
    }));

  return json(200, {
    answer,
    toolCalls,
    model: data.model,
    usage: data.usage,
  });
};

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

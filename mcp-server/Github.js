import { Octokit } from "@octokit/rest";

const token = process.env.GITHUB_TOKEN;
if (!token) {
  console.error(
    "GITHUB_TOKEN is not set; GitHub requests will be unauthenticated and rate-limited.",
  );
}

const octokit = new Octokit({ auth: token, userAgent: "devcontext/0.1" });

// Limits chosen so a single tool response stays small enough for the model
// to use without blowing up token counts.
const MAX_TREE_ENTRIES = 1500;
const MAX_FILE_CHARS = 60_000;
const MAX_SEARCH_RESULTS = 15;

/** Return the full file tree of a repo (blobs only), relative to the default branch. */
export async function getRepoStructure(owner, repo, pathPrefix = "") {
  const { data } = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: "HEAD",
    recursive: "true",
  });

  const prefix = pathPrefix.replace(/^\/+|\/+$/g, "");
  let files = data.tree.filter((e) => e.type === "blob").map((e) => e.path);
  if (prefix)
    files = files.filter((p) => p === prefix || p.startsWith(prefix + "/"));

  const truncated = data.truncated || files.length > MAX_TREE_ENTRIES;
  return {
    total: files.length,
    truncated,
    files: files.slice(0, MAX_TREE_ENTRIES),
  };
}

/** Return the decoded text content of one file. */
export async function readFile(owner, repo, path) {
  const { data } = await octokit.rest.repos.getContent({ owner, repo, path });

  if (Array.isArray(data)) {
    throw new Error(
      `"${path}" is a directory. Use repo_structure to list its files.`,
    );
  }
  if (data.type !== "file") {
    throw new Error(`"${path}" is a ${data.type}, not a regular file.`);
  }
  if (data.encoding !== "base64") {
    // Very large files come back with encoding "none" and no content.
    throw new Error(
      `"${path}" is too large to read via the API (${data.size} bytes).`,
    );
  }

  const text = Buffer.from(data.content, "base64").toString("utf8");
  const truncated = text.length > MAX_FILE_CHARS;
  return {
    path: data.path,
    size: data.size,
    truncated,
    content: truncated ? text.slice(0, MAX_FILE_CHARS) : text,
  };
}

/** Search code within a single repo using GitHub's code search. */
export async function searchCode(owner, repo, query) {
  const { data } = await octokit.rest.search.code({
    q: `${query} repo:${owner}/${repo}`,
    per_page: MAX_SEARCH_RESULTS,
  });

  return {
    total: data.total_count,
    results: data.items.map((item) => ({
      path: item.path,
      url: item.html_url,
    })),
  };
}

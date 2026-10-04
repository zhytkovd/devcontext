import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

const CHAT_URL = import.meta.env.VITE_CHAT_URL;
const DEFAULT_REPO = "BCStudentSoftwareDevTeam/lsf";

const STARTERS = [
  "What does the app folder contain and what is the entry point?",
  "Where are the database models defined?",
  "How does login work?",
];

export default function App() {
  const [repo, setRepo] = useState(DEFAULT_REPO);
  const [turns, setTurns] = useState([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const lastResponseId = useRef(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, busy]);

  function startNewThread(nextRepo) {
    setRepo(nextRepo);
    setTurns([]);
    setError(null);
    lastResponseId.current = null;
  }

  async function ask(question) {
    const q = question.trim();
    const [owner, name] = repo.trim().split("/");
    if (!q || busy) return;
    if (!owner || !name) {
      setError(
        "Enter the repository as owner/name, for example BCStudentSoftwareDevTeam/lsf.",
      );
      return;
    }

    setError(null);
    setDraft("");
    setBusy(true);
    setTurns((t) => [...t, { question: q }]);

    try {
      const res = await fetch(CHAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q,
          owner,
          repo: name,
          previousResponseId: lastResponseId.current,
        }),
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.error ?? `Request failed (${res.status})`);

      lastResponseId.current = data.responseId;
      setTurns((t) => {
        const next = [...t];
        next[next.length - 1] = {
          question: q,
          answer: data.answer,
          toolCalls: data.toolCalls,
        };
        return next;
      });
    } catch (err) {
      setError(err.message);
      setTurns((t) => t.slice(0, -1));
      setDraft(q);
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e) {
    e.preventDefault();
    ask(draft);
  }

  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      ask(draft);
    }
  }

  const empty = turns.length === 0 && !busy;

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="brand">DevContext</h1>
        <label className="repo">
          <span className="repo-label">Repository</span>
          <input
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            onBlur={(e) =>
              e.target.value !== repo && startNewThread(e.target.value)
            }
            spellCheck={false}
            aria-label="GitHub repository, owner/name"
          />
        </label>
        {turns.length > 0 && (
          <button
            type="button"
            className="ghost"
            onClick={() => startNewThread(repo)}
          >
            New conversation
          </button>
        )}
      </header>

      <main className="thread">
        {empty && (
          <section className="intro">
            <p className="intro-lead">
              Ask about any public GitHub repository. Answers come from reading
              the actual code, and every file the model opened is listed under
              its reply.
            </p>
            <ul className="starters">
              {STARTERS.map((s) => (
                <li key={s}>
                  <button type="button" onClick={() => ask(s)}>
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {turns.map((turn, i) => (
          <Turn
            key={i}
            turn={turn}
            repo={repo}
            pending={busy && i === turns.length - 1 && !turn.answer}
          />
        ))}

        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <div ref={bottomRef} />
      </main>

      <form className="composer" onSubmit={onSubmit}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={
            turns.length
              ? "Ask a follow-up"
              : "Ask a question about this repository"
          }
          rows={1}
          disabled={busy}
          aria-label="Your question"
        />
        <button type="submit" disabled={busy || !draft.trim()}>
          Ask
        </button>
      </form>
    </div>
  );
}

function Turn({ turn, repo, pending }) {
  return (
    <article className="turn">
      <p className="question">{turn.question}</p>

      {pending && (
        <div className="trail trail-pending" aria-live="polite">
          <span className="pulse" /> Reading the repository
        </div>
      )}

      {turn.toolCalls?.length > 0 && <Trail calls={turn.toolCalls} />}

      {turn.answer && (
        <div className="answer">
          <ReactMarkdown
            components={{ a: (props) => <RepoLink {...props} repo={repo} /> }}
          >
            {turn.answer}
          </ReactMarkdown>
        </div>
      )}
    </article>
  );
}

/** Paths the model writes as links open the real file on GitHub. */
function RepoLink({ href = "", children, repo }) {
  const isAbsolute = /^https?:\/\//.test(href);
  const path = href.replace(/^\.?\//, "");
  const url = isAbsolute
    ? href
    : `https://github.com/${repo}/blob/HEAD/${path}`;
  return (
    <a href={url} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

function Trail({ calls }) {
  return (
    <ol className="trail" aria-label="Files and tools used">
      {calls.map((c, i) => (
        <li key={i} className={c.error ? "trail-error" : undefined}>
          <span className="tool">{c.tool}</span>
          <span className="arg">{describeArgs(c)}</span>
        </li>
      ))}
    </ol>
  );
}

function describeArgs(call) {
  const a = call.arguments ?? {};
  if (call.tool === "read_file") return a.path ?? "";
  if (call.tool === "repo_structure")
    return a.path ? `${a.path}/` : "whole repository";
  if (call.tool === "search_code") return `"${a.query ?? ""}"`;
  return "";
}

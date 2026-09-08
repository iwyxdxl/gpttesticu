// Wire format reference: openai/codex, rust-v0.153.0 (41e22fee981a63b3698df7ed36bad393cda24715).
// core/src/client.rs, core/src/responses_metadata.rs and codex-api/src/requests/headers.rs.
export const CODEX_CLIENT_HEADERS = {
  originator: "codex_cli_rs",
  version: "0.153.0",
};

export interface CodexSession {
  readonly sessionId: string;
  readonly threadId: string;
  readonly installationId: string;
  readonly windowId: string;
}

function randomId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // randomUUID requires a secure context; support HTTP deployments too.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createCodexSession(): CodexSession {
  const sessionId = randomId();
  // Ephemeral identities for one test flow, never the site's persistent anonymous ID.
  return {
    sessionId,
    threadId: sessionId,
    installationId: randomId(),
    windowId: randomId(),
  };
}

export function buildCodexRequest(
  prompt: { model: string; instructions: string; input: string },
  session: CodexSession,
) {
  return {
    headers: {
      ...CODEX_CLIENT_HEADERS,
      "session-id": session.sessionId,
      "thread-id": session.threadId,
      "x-client-request-id": session.threadId,
      "x-codex-window-id": session.windowId,
      // Do not set User-Agent: Chromium drops overrides made through fetch.
    },
    body: {
      model: prompt.model,
      ...(prompt.instructions ? { instructions: prompt.instructions } : {}),
      input: [{
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: prompt.input }],
      }],
      // No tools are executable here. Omit the entire optional tool configuration
      // as in the original web client; relays may handle omission and [] differently.
      reasoning: { effort: "low" },
      store: false,
      stream: true,
      include: ["reasoning.encrypted_content"],
      prompt_cache_key: session.sessionId,
      client_metadata: {
        "x-codex-installation-id": session.installationId,
        session_id: session.sessionId,
        thread_id: session.threadId,
        "x-codex-window-id": session.windowId,
        turn_id: randomId(),
      },
    },
  };
}

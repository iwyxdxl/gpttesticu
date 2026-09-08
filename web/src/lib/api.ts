import { describeError, readJsonResponse, RequestError } from "./errors";

export interface SiteConfig {
  keywords_dumbed: string[];
  keywords_normal: string[];
  sample_paragraphs: number;
  sample_max_chars: number;
  user_prompt: string;
  codex_system_prompt: string;
}

export interface WorkItem {
  id: number;
  title: string;
  html: string;
  model_name: string;
  is_gpt6astra: number;
  verdict: string | null;
  nickname: string;
  funny_value: number;
  created_at: number;
  anon_id?: string;
  status?: string;
  chat_log?: string | null;
  auto_verdict?: string | null;
  source: "test" | "custom";
}

export interface WorksPage {
  items: WorkItem[];
  page: number;
  pages: number;
  total: number;
}

async function jfetch<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (error) {
    throw new RequestError(`请求未能收到响应\n${describeError(error)}`);
  }
  return readJsonResponse<T>(res);
}

const jsonInit = (body: unknown, method = "POST"): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const fetchConfig = () => jfetch<SiteConfig>("/api/config");

export const fetchStats = () =>
  jfetch<{
    total_tests: number;
    today_tests: number;
    verdicts: Record<string, number>;
  }>("/api/stats");

export const reportVisit = (anon_id: string) =>
  jfetch<{ ok: boolean }>("/api/stats/visit", jsonInit({ anon_id }));

export const reportTest = (verdict: string, ran_full: boolean) =>
  jfetch<{ ok: boolean }>("/api/stats/test", {
    ...jsonInit({ verdict, ran_full }),
    keepalive: true,
  });

export const reportFeedback = (body: { test_id: string; verdict: string; auto_verdict: string; model_name: string }) =>
  jfetch<{ ok: boolean }>("/api/stats/feedback", jsonInit(body));

export const fetchReference = () => jfetch<{ html: string }>("/api/reference");

export const fetchWorks = (params: {
  board: string;
  page: number;
  model?: string;
  q?: string;
}) => {
  const u = new URLSearchParams({
    board: params.board,
    page: String(params.page),
  });
  if (params.model && params.model !== "all") u.set("model", params.model);
  if (params.q) u.set("q", params.q);
  return jfetch<WorksPage>(`/api/works?${u}`);
};

export const fetchWorkModels = () =>
  jfetch<{ models: { model_name: string; is_gpt6astra: number; n: number }[] }>(
    "/api/works/models",
  );

export const fetchWork = (id: string | number) =>
  jfetch<{ work: WorkItem }>(`/api/works/${id}`);

export const likeWork = (id: number, anon_id: string) =>
  jfetch<{ ok: boolean; funny_value: number; already_liked: boolean }>(
    `/api/works/${id}/like`,
    jsonInit({ anon_id }),
  );

export interface UploadPayload {
  chat_log?: string | null;
  auto_verdict?: string | null;
  source: "test" | "custom";
  title: string;
  html: string;
  is_gpt6astra: boolean;
  model_name: string;
  verdict?: string | null;
  nickname: string;
  anon_id: string;
}

export const uploadWork = (p: UploadPayload) =>
  jfetch<{ ok: boolean; id: number }>("/api/works", jsonInit(p));

// ---------- 管理端 ----------

export const adminLogin = (password: string) =>
  jfetch<{ ok: boolean }>("/api/admin/login", jsonInit({ password }));

export function adminFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  return jfetch<T>(url, {
    ...init,
    credentials: "same-origin",
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  }).catch((err) => {
    if (
      err instanceof RequestError &&
      err.status === 401 &&
      !url.endsWith("/session")
    )
      window.dispatchEvent(
        new CustomEvent("admin-session-expired", { detail: err.message }),
      );
    throw err;
  });
}

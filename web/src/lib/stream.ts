import { describeError, readResponseText, responseError } from "./errors";
import {
  buildCodexRequest,
  CODEX_CLIENT_HEADERS,
  createCodexSession,
  type CodexSession,
} from "./codex";

// 浏览器直连 OpenAI Responses 格式端点（中转站）。
// 隐私红线：以下请求只发往用户自己填写的地址，本站服务器不经手、也没有任何接收 Key/URL 的接口。

export type ConnectErrorKind =
  "cors" | "http" | "network" | "aborted" | "unknown";

export class ConnectError extends Error {
  kind: ConnectErrorKind;
  status?: number;
  constructor(kind: ConnectErrorKind, message: string, status?: number) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

export function normalizeBaseUrl(raw: string): {
  base: string;
  fixed: boolean;
} {
  const value = raw.trim();
  if (!value || /\s/.test(value))
    throw new ConnectError(
      "unknown",
      "请输入有效的端点地址，地址中不能包含空格",
    );
  let url: URL;
  try {
    url = new URL(
      /^[a-z][a-z\d+.-]*:/i.test(value) ? value : `https://${value}`,
    );
  } catch {
    throw new ConnectError("unknown", "端点地址格式不正确");
  }
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new ConnectError(
      "unknown",
      "请使用不含用户名、密码、查询参数或锚点的 HTTP(S) 地址",
    );
  if (typeof window !== "undefined" && url.origin === window.location.origin)
    throw new ConnectError("unknown", "请填写你的中转站地址，不能使用本站地址");
  let path = url.pathname
    .replace(/\/+$/, "")
    .replace(/\/v1\/(models|responses)$/i, "/v1");
  if (/\/v1$/i.test(path)) path = path.replace(/\/v1$/i, "/v1");
  else path += "/v1";
  url.pathname = path;
  const base = url.toString().replace(/\/$/, "");
  return { base, fixed: base !== value };
}

export async function fetchModels(
  base: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<string[]> {
  let res: Response;
  try {
    res = await fetch(`${base}/models`, {
      headers: {
        ...CODEX_CLIENT_HEADERS,
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal,
    });
  } catch (err: any) {
    if (err?.name === "AbortError")
      throw new ConnectError("aborted", `已取消\n${describeError(err)}`);
    throw new ConnectError(
      "cors",
      `浏览器无法连接该端点（可能是 CORS 跨域限制或地址不可达）。浏览器未提供 HTTP 状态码或响应体。\n\n原始浏览器错误：\n${describeError(err)}`,
    );
  }
  const raw = await readResponseText(res);
  if (!res.ok)
    throw new ConnectError(
      "http",
      responseError(res, raw, "拉取模型失败").message,
      res.status,
    );
  let j: any;
  try {
    j = JSON.parse(raw);
  } catch (error) {
    throw new ConnectError(
      "unknown",
      responseError(
        res,
        raw,
        `模型列表不是有效的 JSON\n${describeError(error)}`,
      ).message,
      res.status,
    );
  }
  const list = j?.data ?? j?.models;
  if (!Array.isArray(list))
    throw new ConnectError(
      "unknown",
      responseError(res, raw, "端点返回的模型列表格式不正确").message,
      res.status,
    );
  const ids: string[] = list
    .map((m: any) => m?.id ?? m?.name)
    .filter((x: any) => typeof x === "string" && x);
  return ids.sort();
}

export interface StreamOptions {
  base: string;
  apiKey: string;
  model: string;
  instructions: string;
  input: string;
  session?: CodexSession;
  signal: AbortSignal;
  onDelta: (delta: string, full: string) => void;
}

// 流式调用 POST {base}/responses，reasoning effort 固定 low（模拟 Codex 环境）
export async function streamResponses(
  opts: StreamOptions,
): Promise<{ text: string; completed: boolean }> {
  const request = buildCodexRequest(opts, opts.session ?? createCodexSession());
  let res: Response;
  try {
    res = await fetch(`${opts.base}/responses`, {
      method: "POST",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      headers: {
        ...request.headers,
        Authorization: `Bearer ${opts.apiKey.trim()}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(request.body),
      signal: opts.signal,
    });
  } catch (err: any) {
    if (err?.name === "AbortError")
      throw new ConnectError("aborted", `已断开\n${describeError(err)}`);
    throw new ConnectError(
      "cors",
      `浏览器无法连接该端点（可能是 CORS 跨域限制或地址不可达）。浏览器未提供 HTTP 状态码或响应体。\n\n原始浏览器错误：\n${describeError(err)}`,
    );
  }

  const contentType = res.headers.get("content-type") || "";
  if (
    !res.ok ||
    !res.body ||
    (contentType && !contentType.toLowerCase().includes("text/event-stream"))
  ) {
    const raw = await readResponseText(res);
    throw new ConnectError(
      "http",
      responseError(
        res,
        raw,
        !res.ok ? "请求被端点拒绝" : "端点未返回预期的 SSE 流",
      ).message,
      res.status,
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  let completed = false;

  const handleEvent = (dataStr: string, eventType: string) => {
    if (!dataStr) return;
    if (dataStr === "[DONE]") {
      if (text) completed = true;
      return;
    }
    let evt: any;
    try {
      evt = JSON.parse(dataStr);
    } catch (error) {
      throw new ConnectError(
        "unknown",
        `SSE 数据不是有效的 JSON\n${describeError(error)}\n\n完整事件内容：\n${dataStr}`,
      );
    }
    switch (evt?.type || eventType || (evt?.error ? "error" : "")) {
      case "response.output_text.delta": {
        if (typeof evt.delta === "string" && evt.delta) {
          text += evt.delta;
          if (text.length > 2 * 1024 * 1024)
            throw new ConnectError(
              "unknown",
              "输出超过 2MB 字符保护上限，已停止接收",
            );
          opts.onDelta(evt.delta, text);
        }
        break;
      }
      case "response.completed":
        completed = true;
        break;
      case "response.incomplete":
        throw new ConnectError(
          "unknown",
          `生成未完成：${evt?.response?.incomplete_details?.reason || "端点提前停止"}\n\n完整事件内容：\n${dataStr}`,
        );
      case "response.failed":
        throw new ConnectError(
          "unknown",
          `生成失败：${evt?.response?.error?.message || evt?.error?.message || evt?.message || "未知原因"}\n\n完整事件内容：\n${dataStr}`,
        );
      case "error":
        throw new ConnectError(
          "unknown",
          `流式返回错误：${evt?.error?.message || evt?.message || "未知错误"}\n\n完整事件内容：\n${dataStr}`,
        );
    }
  };

  const dispatch = (event: string) => {
    const data = event
      .split(/\r\n|\n|\r/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    const eventType =
      event
        .split(/\r\n|\n|\r/)
        .find((line) => line.startsWith("event:"))
        ?.slice(6)
        .trim() || "";
    handleEvent(data, eventType);
  };
  try {
    while (!completed) {
      if (opts.signal.aborted) throw new ConnectError("aborted", "已断开");
      const { done, value } = await reader.read();
      if (done) {
        buf += decoder.decode();
        if (buf.trim()) dispatch(buf);
        break;
      }
      buf += decoder.decode(value, { stream: true });
      if (buf.length > 2 * 1024 * 1024)
        throw new ConnectError("network", "流事件过大，已停止接收");
      let match: RegExpExecArray | null;
      while ((match = /\r\n\r\n|\n\n|\r\r/.exec(buf))) {
        const event = buf.slice(0, match.index);
        buf = buf.slice(match.index + match[0].length);
        dispatch(event);
        if (opts.signal.aborted) throw new ConnectError("aborted", "已断开");
        if (completed) break;
      }
    }
    if (!completed)
      throw new ConnectError(
        "network",
        `连接提前结束，未收到生成完成事件，请重试${buf.trim() ? `\n\n流末尾内容：\n${buf}` : ""}`,
      );
    if (!text.trim())
      throw new ConnectError("unknown", "端点未返回任何文本，无法完成测试");
  } catch (err: any) {
    if (err instanceof ConnectError) throw err;
    if (opts.signal.aborted || err?.name === "AbortError")
      throw new ConnectError("aborted", "已断开");
    throw new ConnectError(
      "network",
      `读取流式响应失败\n${describeError(err)}`,
    );
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return { text, completed };
}

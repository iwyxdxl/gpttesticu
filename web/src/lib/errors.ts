// Error details stay in page memory and are rendered as text, never HTML.
export class RequestError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
    this.name = "RequestError";
  }
}

export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const cause =
      error.cause === undefined ? "" : `\n原因：${describeError(error.cause)}`;
    return `${error.stack || `${error.name}: ${error.message}`}${cause}`;
  }
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error, null, 2) ?? String(error);
  } catch {
    return String(error);
  }
}

export function responseError(
  response: Response,
  body: string,
  title: string,
): RequestError {
  const headers = [
    "content-type",
    "x-request-id",
    "request-id",
    "x-trace-id",
    "cf-ray",
    "retry-after",
  ].flatMap((name) =>
    response.headers.has(name)
      ? [`${name}: ${response.headers.get(name)}`]
      : [],
  );
  return new RequestError(
    [
      title,
      `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`,
      ...headers,
      "",
      "完整响应内容：",
      body || "（响应体为空）",
    ].join("\n"),
    response.status,
  );
}

export async function readResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
    throw responseError(
      response,
      `响应体读取失败，浏览器未能提供完整内容。\n${describeError(error)}`,
      "读取响应失败",
    );
  }
}

export async function readJsonResponse<T>(
  response: Response,
  title = "请求失败",
): Promise<T> {
  const body = await readResponseText(response);
  if (!response.ok) throw responseError(response, body, title);
  try {
    return JSON.parse(body) as T;
  } catch (error) {
    throw responseError(
      response,
      body,
      `响应不是有效的 JSON\n${describeError(error)}`,
    );
  }
}

import { test, expect, type Page } from "@playwright/test";
const relay = "http://127.0.0.1:19797/v1";
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "authorization,content-type,originator,version,session-id,thread-id,x-client-request-id,x-codex-window-id",
  "access-control-expose-headers": "x-request-id",
};
async function ready(page: Page) {
  await page.goto("/");
  await page.getByLabel("服务端点").fill(relay);
  await page.getByPlaceholder("sk-...").fill("error-test-key");
  await page
    .getByRole("textbox", { name: "测试模型" })
    .fill("gpt-6astra-mystery");
}
async function start(page: Page) {
  await page.getByRole("button", { name: "开始快速测试" }).click();
  await page.getByRole("button", { name: "确认消耗，开始测试" }).click();
}
test("model error shows the full structured response and request ID", async ({
  page,
}) => {
  const raw = JSON.stringify({
    error: {
      message: "denied",
      code: "model_access",
      details: { help: "first\nsecond" },
    },
    request_id: "body-id",
    last_field: "tail retained",
  });
  await ready(page);
  await page.route("**/v1/models", (r) =>
    r.fulfill({
      status: 403,
      contentType: "application/json",
      headers: { ...cors, "x-request-id": "header-id" },
      body: raw,
    }),
  );
  await page.getByRole("button", { name: "拉取模型", exact: true }).click();
  const error = page.locator(".field-hint-warn .request-error-text");
  await expect(error).toContainText("HTTP 403");
  await expect(error).toContainText("x-request-id: header-id");
  expect(await error.textContent()).toContain(raw);
});
test("quick HTTP error preserves long JSON responses without truncation", async ({
  page,
}) => {
  const raw = JSON.stringify({
    error: {
      message: "request rejected",
      code: "invalid_parameter",
      param: "reasoning",
    },
    details: "detail ".repeat(1200),
    tail: "last diagnostic",
  });
  await ready(page);
  await page.route("**/v1/responses", (r) =>
    r.fulfill({
      status: 422,
      contentType: "application/json",
      headers: cors,
      body: raw,
    }),
  );
  await start(page);
  const error = page.getByRole("alert").locator(".request-error-text");
  await expect(error).toContainText("HTTP 422");
  expect(await error.textContent()).toContain(raw);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("full HTTP HTML error is visible as literal text and cannot execute", async ({
  page,
}) => {
  await ready(page);
  await start(page);
  await expect(page.locator(".stamp-label")).toHaveText("无法判断");
  const raw =
    "<html><h1>502 Bad Gateway</h1>\n<script>window.errorExecuted=true</script>\nUpstream timeout\nrequest_id: html-tail</html>";
  await page.route("**/v1/responses", (r) =>
    r.fulfill({
      status: 502,
      contentType: "text/html",
      headers: cors,
      body: raw,
    }),
  );
  await page.getByRole("button", { name: "上完整测试" }).click();
  await page.getByRole("button", { name: "确认消耗，开始测试" }).click();
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("HTTP 502");
  expect(await alert.locator(".request-error-text").textContent()).toContain(
    raw,
  );
  await expect(alert.locator("script, h1")).toHaveCount(0);
  expect(await page.evaluate(() => "errorExecuted" in window)).toBe(false);
});
test("SSE error event shows every diagnostic field including top-level message", async ({
  page,
}) => {
  const raw =
    '{"message":"upstream unavailable","code":"busy","request_id":"sse-id","details":{"retry_after":30}}';
  await ready(page);
  await page.route("**/v1/responses", (r) =>
    r.fulfill({
      contentType: "text/event-stream",
      headers: cors,
      body: `event: error\ndata: ${raw}\n\n`,
    }),
  );
  await start(page);
  const error = page.getByRole("alert").locator(".request-error-text");
  await expect(error).toContainText("upstream unavailable");
  expect(await error.textContent()).toContain(raw);
});
test("network failures show the original browser exception and the unavailable-response limitation", async ({
  page,
}) => {
  await ready(page);
  await page.route("**/v1/responses", (r) => r.abort());
  await start(page);
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("TypeError: Failed to fetch");
  await expect(alert).toContainText("浏览器未提供 HTTP 状态码或响应体");
});
test("site API non-JSON errors remain readable on the leaderboard", async ({
  page,
}) => {
  const raw = "Service unavailable\nreason: maintenance\nrequest_id: site-tail";
  await page.route("**/api/works?*", (r) =>
    r.fulfill({ status: 503, contentType: "text/plain", body: raw }),
  );
  await page.goto("/leaderboard");
  const error = page.getByRole("alert").locator(".request-error-text");
  await expect(error).toContainText("HTTP 503");
  expect(await error.textContent()).toContain(raw);
});
test("admin save failures keep the complete response visible after the success-toast timeout", async ({
  page,
}) => {
  await page.goto("/admin");
  await page
    .getByLabel("管理员密码", { exact: true })
    .fill("qa-local-password-only");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("button", { name: "参数与提示词" }).click();
  const raw =
    '{"error":"save failed","code":"db_readonly","details":"database is read-only","request_id":"admin-tail"}';
  await page.route("**/api/admin/config", (r) =>
    r.request().method() === "PUT"
      ? r.fulfill({ status: 500, contentType: "application/json", body: raw })
      : r.continue(),
  );
  await page.clock.install();
  await page.getByRole("button", { name: "保存参数与提示词" }).click();
  const error = page.getByRole("alert").locator(".request-error-text");
  await expect(error).toContainText("HTTP 500");
  expect(await error.textContent()).toContain(raw);
  await page.clock.runFor(3000);
  await expect(error).toBeVisible();
  expect(await error.textContent()).toContain(raw);
});

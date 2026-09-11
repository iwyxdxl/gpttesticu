import { test, expect, type Request } from "@playwright/test";

const relay = "http://127.0.0.1:19797/v1";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

for (const fallback of [false, true]) {
  test(`Codex wire contract, cross-origin flow and identity lifetime${fallback ? " without randomUUID" : ""}`, async ({ page }) => {
    if (fallback) {
      await page.addInitScript(() => {
        Object.defineProperty(crypto, "randomUUID", { value: undefined });
      });
    }
    const responses: Request[] = [];
    const siteRequests: Request[] = [];
    let models: Request | undefined;
    page.on("request", (request) => {
      if (request.url() === `${relay}/responses` && request.method() === "POST") {
        responses.push(request);
      }
      if (request.url() === `${relay}/models` && request.method() === "GET") {
        models = request;
      }
      if (request.url().includes("/api/")) siteRequests.push(request);
    });
    await page.goto("/test");
    await page.getByLabel("服务端点").fill(relay);
    await page.getByPlaceholder("sk-...").fill("codex-wire-test-key");
    await page.getByRole("button", { name: "拉取模型", exact: true }).click();
    await page.getByRole("combobox", { name: "测试模型" }).selectOption("gpt-6astra-mystery");
    expect(await models!.allHeaders()).toMatchObject({
      originator: "codex_cli_rs",
      version: "0.153.0",
    });

    await page.getByRole("button", { name: "开始快速测试" }).click();
    await page.getByRole("button", { name: "确认消耗，开始测试" }).click();
    await expect(page.locator(".stamp-label")).toHaveText("无法判断");
    await page.getByRole("button", { name: "上完整测试" }).click();
    await page.getByRole("button", { name: "确认消耗，开始测试" }).click();
    await expect(page.getByRole("button", { name: "把这次结果上传" })).toBeVisible();
    expect(responses).toHaveLength(2);

    // Regression for the rejected string input and missing Codex fields;
    // these requests must also pass a real browser CORS preflight and stream.
    for (const request of responses) {
      const body = request.postDataJSON();
      const headers = await request.allHeaders();
      expect(body).toMatchObject({
        model: "gpt-6astra-mystery",
        input: [{ type: "message", role: "user", content: [{ type: "input_text", text: expect.any(String) }] }],
        store: false,
        stream: true,
        include: ["reasoning.encrypted_content"],
        reasoning: { effort: "low" },
      });
      // The web client cannot execute tools. Restore its original omission of
      // all tool fields after the reported "Tools must be a list" regression.
      for (const field of ["tools", "tool_choice", "parallel_tool_calls"]) {
        expect(body).not.toHaveProperty(field);
      }
      expect(body.prompt_cache_key).toMatch(uuid);
      expect(headers).toMatchObject({
        originator: "codex_cli_rs",
        version: "0.153.0",
        "session-id": body.prompt_cache_key,
        "thread-id": body.client_metadata.thread_id,
        "x-client-request-id": body.client_metadata.thread_id,
        "x-codex-window-id": body.client_metadata["x-codex-window-id"],
        authorization: "Bearer codex-wire-test-key",
      });
      expect(headers.cookie).toBeUndefined();
      expect(headers.referer).toBeUndefined();
      expect(body.client_metadata.session_id).toBe(body.prompt_cache_key);
      for (const value of Object.values(body.client_metadata)) expect(value).toMatch(uuid);
    }
    const quick = responses[0].postDataJSON();
    const full = responses[1].postDataJSON();
    expect(full.prompt_cache_key).toBe(quick.prompt_cache_key);
    expect(full.client_metadata.turn_id).not.toBe(quick.client_metadata.turn_id);
    expect(full.client_metadata).toMatchObject({
      ...quick.client_metadata,
      turn_id: full.client_metadata.turn_id,
    });

    await page.getByRole("button", { name: "再测一次" }).click();
    await page.getByRole("button", { name: "开始快速测试" }).click();
    await page.getByRole("button", { name: "确认消耗，开始测试" }).click();
    await expect(page.locator(".stamp-label")).toHaveText("无法判断");
    expect(responses).toHaveLength(3);
    const next = responses[2].postDataJSON();
    expect(next.prompt_cache_key).not.toBe(quick.prompt_cache_key);
    expect(next.client_metadata["x-codex-installation-id"]).not.toBe(quick.client_metadata["x-codex-installation-id"]);

    const storage = await page.evaluate(() => JSON.stringify({ localStorage: { ...localStorage }, sessionStorage: { ...sessionStorage } }));
    const sitePayloads = siteRequests.map((r) => `${r.url()}${r.postData()}${JSON.stringify(r.headers())}`).join("\n");
    for (const value of ["codex-wire-test-key", quick.prompt_cache_key, next.prompt_cache_key, quick.client_metadata["x-codex-installation-id"]]) {
      expect(storage).not.toContain(value);
      expect(sitePayloads).not.toContain(value);
    }
  });
}

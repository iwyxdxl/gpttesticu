import { test, expect, type Page } from "@playwright/test";
const relay = "http://127.0.0.1:19797/v1";
const secret = "qa-browser-only-key";
// Chromium can omit offscreen out-of-process iframes in a full-page capture.
// Expand the capture viewport, then restore the viewport used by layout assertions.
async function capturePage(page: Page, path: string) {
  const viewport = page.viewportSize()!;
  const height = await page.evaluate(
    () => document.documentElement.scrollHeight,
  );
  await page.setViewportSize({ width: viewport.width, height });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(350); // compositor-only settling for documentation captures
  await page.screenshot({ path, fullPage: true });
  await page.setViewportSize(viewport);
}
async function connect(page: Page, model = "gpt-6astra-mystery") {
  await page.goto("/");
  await page.getByLabel("服务端点").fill(relay);
  await page.getByPlaceholder("sk-...").fill(secret);
  await page.getByRole("button", { name: "拉取模型", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "测试模型" })).toBeVisible();
  await page.getByRole("combobox", { name: "测试模型" }).selectOption(model);
}
async function quick(page: Page) {
  await page.getByRole("button", { name: "开始快速测试" }).click();
  await expect(page.getByRole("dialog")).toContainText("消耗 token");
  await page.getByRole("button", { name: "确认消耗，开始测试" }).click();
  await expect(page.locator(".stamp-label")).toBeVisible();
}
async function admin(page: Page) {
  await page.goto("/admin");
  await page
    .getByLabel("管理员密码", { exact: true })
    .fill("qa-local-password-only");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("button", { name: "退出登录" })).toBeVisible();
}
for (const [model, verdict] of [
  ["gpt-6astra-dumbed", "疑似降智版"],
  ["gpt-6astra-normal", "疑似正常版"],
]) {
  test(`quick ${verdict}: automatic disconnect, one private statistics event`, async ({
    page,
  }) => {
    const events: any[] = [],
      leaked: string[] = [],
      errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (r.url().includes("/api/stats/test")) events.push(r.postDataJSON());
      if (
        r.url().startsWith("http://127.0.0.1:15173/api/") &&
        `${r.postData()}${JSON.stringify(r.headers())}`.includes(secret)
      )
        leaked.push(r.url());
    });
    await connect(page, model);
    await quick(page);
    await expect(page.locator(".stamp-label")).toHaveText(verdict);
    await expect(page.locator(".raw-text mark").first()).toBeVisible();
    await expect(
      page.getByRole("button", { name: "上完整测试" }),
    ).toBeVisible();
    expect(events).toHaveLength(0);
    await page
      .getByRole("button", { name: "结束本次检测", exact: true })
      .click();
    await expect.poll(() => events.length).toBe(1);
    expect(Object.keys(events[0]).sort()).toEqual(["ran_full", "verdict"]);
    expect(events[0].ran_full).toBe(false);
    expect(leaked).toEqual([]);
    expect(errors).toEqual([]);
    const storage = await page.evaluate(() =>
      JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage },
      }),
    );
    expect(storage).not.toContain(secret);
    expect(storage).not.toContain(relay);
    await page.reload();
    await expect(page.getByPlaceholder("sk-...")).toHaveValue("");
    await expect(page.getByLabel("服务端点")).toHaveValue("");
  });
}
for (const [model, verdict] of [
  ["gpt-6astra-dumbed", "dumbed"],
  ["gpt-6astra-normal", "normal"],
]) {
  test(`${verdict} verdict can continue to full test with one correctly classified event`, async ({
    page,
  }) => {
    const events: any[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/stats/test")) events.push(r.postDataJSON());
    });
    await connect(page, model);
    await quick(page);
    expect(events).toHaveLength(0);
    await page.getByRole("button", { name: "上完整测试" }).click();
    await expect(page.getByRole("dialog")).toContainText("显著高于快速测试");
    // Dismissing the cost confirmation keeps the same flow open.
    await page.getByRole("button", { name: "再想想" }).click();
    expect(events).toHaveLength(0);
    await page.getByRole("button", { name: "上完整测试" }).click();
    await page.getByRole("button", { name: "确认消耗，开始测试" }).click();
    await expect(
      page.getByRole("button", { name: "把这次结果上传" }),
    ).toBeVisible({ timeout: 15000 });
    await expect.poll(() => events).toEqual([{ verdict, ran_full: true }]);
    await page.getByRole("button", { name: "再测一次" }).click();
    await page.getByRole("link", { name: "搞笑排行榜" }).click();
    expect(events).toEqual([{ verdict, ran_full: true }]);
  });
}
test("unknown → full → upload → moderation → detail and deduplicated like", async ({
  page,
  request,
}) => {
  const events: any[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/stats/test")) events.push(r.postDataJSON());
  });
  await connect(page);
  await quick(page);
  await expect(page.locator(".stamp-label")).toHaveText("无法判断");
  expect(events).toHaveLength(0);
  await page.getByRole("button", { name: "上完整测试" }).click();
  await expect(page.getByRole("dialog")).toContainText("显著高于快速测试");
  await page.getByRole("button", { name: "确认消耗，开始测试" }).click();
  await expect(
    page.getByRole("button", { name: "把这次结果上传" }),
  ).toBeVisible();
  expect(events).toEqual([{ verdict: "unknown", ran_full: true }]);
  const feedbackGroup = page.getByRole("group", { name: "说说你的判断" });
  const feedbackResponse = page.waitForResponse("**/api/stats/feedback");
  await feedbackGroup.getByRole("button", { name: "已降智", exact: true }).click();
  expect((await feedbackResponse).ok()).toBe(true);
  await expect(feedbackGroup).toContainText("你的判断已记录");
  await feedbackGroup.getByRole("button", { name: "无法判断", exact: true }).click();
  await expect(feedbackGroup.getByRole("button", { name: "无法判断", exact: true })).toHaveAttribute("aria-pressed", "true");
  for (const frame of await page.locator("iframe").all())
    expect(await frame.getAttribute("sandbox")).toBe("");
  await page.getByRole("button", { name: "把这次结果上传" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("标题 *", { exact: true }).fill("QA 海岸骑士");
  await dialog.getByRole("button", { name: "提交审核" }).click();
  await expect(dialog.getByRole("alert")).toContainText("请手动选择是否降智");
  await dialog.getByRole("button", { name: "正常未降智", exact: true }).click();
  const transcript = await dialog.getByLabel("完整聊天记录", { exact: true }).inputValue();
  const records = JSON.parse(transcript);
  expect(records).toHaveLength(2);
  expect(records[0].stage).toBe("快速测试");
  expect(records[1]).toMatchObject({ stage: "完整测试", status: "已完成" });
  expect(records[1].response).toContain("svg");
  expect(records[1].instructions).toBeTruthy();
  expect(records[1].prompt).toBeTruthy();
  expect(transcript).not.toContain(secret);
  const uploaded = page.waitForResponse(
    (r) => r.url().endsWith("/api/works") && r.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "提交审核" }).click();
  const id = (await (await uploaded).json()).id;
  await expect(dialog).toContainText("提交成功");
  expect((await request.get(`/api/works/${id}`)).status()).toBe(404);
  await dialog.getByRole("button", { name: "好的", exact: true }).click();
  await admin(page);
  const overview = await page.evaluate(async () => (await fetch("/api/admin/overview")).json());
  expect(overview.human_verdicts).toEqual([{ verdict: "unknown", n: 1 }]);
  expect(overview.feedback_comparison).toEqual([{ auto_verdict: "unknown", verdict: "unknown", n: 1 }]);
  const cookies = await page.context().cookies();
  expect(
    cookies.find((c) => c.name === "gpttest_admin_session")?.httpOnly,
  ).toBe(true);
  expect(
    cookies.find((c) => c.name === "gpttest_admin_session")?.sameSite,
  ).toBe("Strict");
  await page
    .getByRole("button", { name: "审核", exact: false })
    .first()
    .click();
  const item = page.locator(".mod-item").filter({ hasText: "QA 海岸骑士" });
  await item.getByRole("button", { name: "预览", exact: true }).click();
  await expect(page.locator('iframe[title="审核预览"]')).toHaveAttribute(
    "sandbox",
    "",
  );
  await item.getByRole("button", { name: "通过", exact: true }).click();
  await expect(item).toHaveCount(0);
  await page.goto(`/work/${id}`);
  await expect(
    page.getByRole("heading", { name: "QA 海岸骑士" }),
  ).toBeVisible();
  await expect(page.locator(".model-badge")).toHaveText("gpt-6astra-mystery");
  await expect(page.locator(".source-badge")).toHaveText("来自完整测试");
  await expect(page.locator(".verdict-badge")).toContainText("正常");
  await page.getByText("查看完整聊天记录", { exact: true }).click();
  await expect(page.locator(".chat-log pre")).toHaveText(transcript);
  await page.getByRole("button", { name: "搞笑值" }).click();
  await expect(page.getByRole("button", { name: "搞笑值 1" })).toBeDisabled();
  const anon = await page.evaluate(() =>
    localStorage.getItem("gpttest_anon_id"),
  );
  const duplicate = await request.post(`/api/works/${id}/like`, {
    data: { anon_id: anon },
  });
  expect(await duplicate.json()).toMatchObject({
    already_liked: true,
    funny_value: 1,
  });
  await capturePage(page, "../docs/verification/work-detail.png");
});
test("unknown decline closes the flow; reset and navigation flush exactly once", async ({
  page,
}) => {
  const events: any[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/stats/test")) events.push(r.postDataJSON());
  });
  await connect(page);
  await quick(page);
  await page.getByRole("button", { name: "结束本次检测", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "本次检测已结束" }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "上完整测试" })).toHaveCount(0);
  await page.getByRole("button", { name: "再测一次" }).click();
  await quick(page);
  await page.getByRole("link", { name: "搞笑排行榜" }).click();
  await expect.poll(() => events.length).toBe(2);
  expect(events.every((e) => e.ran_full === false)).toBe(true);
});
test("model fetch failure supports manual fallback; invalid URLs never send credentials", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("服务端点").fill("https://user:pass@invalid.test/v1");
  await page.getByPlaceholder("sk-...").fill(secret);
  await page.getByRole("button", { name: "拉取模型", exact: true }).click();
  await expect(page.locator(".field-hint-warn")).toContainText("不含用户名");
  await expect(
    page.getByRole("button", { name: "拉取模型", exact: true }),
  ).toBeEnabled();
  await page.getByLabel("服务端点").fill(relay);
  await page.route("**/v1/models", (route) => route.abort());
  await page.getByRole("button", { name: "拉取模型", exact: true }).click();
  await expect(page.locator(".field-hint-warn")).toContainText("CORS");
  await page.getByRole("textbox", { name: "测试模型" }).fill("vendor-mystery");
  await quick(page);
  await expect(page.locator(".stamp-label")).toHaveText("无法判断");
  await page.getByRole("button", { name: "上完整测试" }).click();
  await page.getByRole("button", { name: "确认消耗，开始测试" }).click();
  await page.getByRole("button", { name: "把这次结果上传" }).click();
  await expect(page.getByRole("dialog").getByLabel("实际模型名 *")).toHaveValue(
    "vendor-mystery",
  );
  await page.keyboard.press("Escape");
});
test("full stream interruption is displayed as a failure, without upload success UI", async ({
  page,
}) => {
  await connect(page);
  await quick(page);
  await page.route("**/v1/responses", (route) =>
    route.fulfill({
      contentType: "text/event-stream",
      body: 'data: {"type":"response.output_text.delta","delta":"<svg></svg>"}\n\n',
    }),
  );
  await page.getByRole("button", { name: "上完整测试" }).click();
  await page.getByRole("button", { name: "确认消耗，开始测试" }).click();
  await expect(page.getByRole("alert")).toContainText("连接提前结束");
  await expect(
    page.getByRole("button", { name: "把这次结果上传" }),
  ).toHaveCount(0);
});
test("responsive pages, keyboard dialog and safe animated reference", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await expect(page.locator("iframe").first()).toBeVisible();
  await page.frameLocator("iframe").first().locator("#scene").waitFor();
  await page.waitForTimeout(250);
  await capturePage(page, "../docs/verification/home-desktop.png");
  const reference = page.frameLocator("iframe").first();
  await expect(reference.locator("svg#scene")).toBeVisible();
  await expect(reference.locator("script")).toHaveCount(0);
  expect(await reference.locator("animateTransform").count()).toBeGreaterThan(
    0,
  );
  for (const width of [390, 320, 768]) {
    await page.setViewportSize({ width, height: 844 });
    for (const path of ["/", "/leaderboard", "/admin"]) {
      await page.goto(path);
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBe(true);
      if (path === "/") {
        await page.locator("iframe").first().scrollIntoViewIfNeeded();
        await expect(
          page.frameLocator("iframe").first().locator("svg#scene"),
        ).toBeVisible();
        expect(
          await page
            .frameLocator("iframe")
            .first()
            .locator("#scene")
            .evaluate(
              (e) => e.getBoundingClientRect().bottom <= innerHeight + 1,
            ),
        ).toBe(true);
        // Allow the isolated iframe's compositor to paint before documentation screenshots.
        await page.waitForTimeout(250);
        await page.evaluate(() => window.scrollTo(0, 0));
      }
      if (width === 390)
        await capturePage(
          page,
          `../docs/verification/${path === "/" ? "home" : path.slice(1)}-mobile.png`,
        );
    }
  }
  await page.goto("/leaderboard");
  await page.getByRole("button", { name: "上传我的鹈鹕" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  for (let i = 0; i < 15; i++) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() => !!document.activeElement?.closest("dialog")),
    ).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "上传我的鹈鹕" }),
  ).toBeFocused();
});
test("API rules: auth, CSRF, moderation, pagination, filters, upload validation, config and logout", async ({
  request,
}) => {
  expect((await request.get("/api/admin/config")).status()).toBe(401);
  const login = await request.post("/api/admin/login", {
    data: { password: "qa-local-password-only" },
  });
  expect(login.ok()).toBe(true);
  expect(await login.json()).not.toHaveProperty("token");
  expect(
    (
      await request.put("/api/admin/config", {
        headers: { Origin: "https://evil.test" },
        data: { sample_paragraphs: 4 },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post("/api/stats/test", {
        data: { verdict: "normal", ran_full: false, api_key: "forbidden" },
      })
    ).status(),
  ).toBe(400);
  expect((await request.get("/api/works?page=1.5")).status()).toBe(200);
  const baseline = await (await request.get("/api/admin/config")).json();
  expect(
    (
      await request.put("/api/admin/config", {
        data: { sample_paragraphs: 4, keywords_normal: ["QA", "QA"] },
      })
    ).ok(),
  ).toBe(true);
  expect(await (await request.get("/api/config")).json()).toMatchObject({
    sample_paragraphs: 4,
    keywords_normal: ["QA"],
  });
  await request.put("/api/admin/config", {
    data: {
      sample_paragraphs: Number(baseline.sample_paragraphs),
      keywords_normal: JSON.parse(baseline.keywords_normal),
    },
  });
  expect(
    (
      await request.put("/api/admin/config", { data: { sample_paragraphs: 0 } })
    ).status(),
  ).toBe(400);
  const payload = {
    verdict: "unknown",
    chat_log: "用户：画一只鹈鹕\n模型：<svg></svg>",
    title: "QA other model",
    html: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><circle cx="50" cy="50" r="30" fill="orange" onload="alert(1)"/></svg>',
    model_name: "other-mock",
    is_gpt6astra: false,
    nickname: "QA reviewer",
    anon_id: crypto.randomUUID(),
  };
  expect(
    (
      await request.post("/api/works", { data: { ...payload, model_name: "" } })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post("/api/works", {
        data: { ...payload, html: "<svg>" + "中".repeat(710000) + "</svg>" },
      })
    ).status(),
  ).toBe(400);
  const response = await request.post("/api/works", { data: payload });
  expect(response.ok()).toBe(true);
  const { id } = await response.json();
  expect((await request.get(`/api/works/${id}`)).status()).toBe(404);
  await request.post(`/api/admin/works/${id}/moderate`, {
    data: { action: "approve" },
  });
  const work = (await (await request.get(`/api/works/${id}`)).json()).work;
  expect(work.html).not.toMatch(/<script|onload=/);
  expect(work.model_name).toBe("other-mock");
  expect(work.source).toBe("custom");
  const others = await (
    await request.get("/api/works?model=others&q=reviewer&board=new")
  ).json();
  expect(others.items.map((w: any) => w.id)).toContain(id);
  expect(
    (
      await (await request.get("/api/works?model=other-mock&q=other")).json()
    ).items.map((w: any) => w.id),
  ).toContain(id);
  await request.post(`/api/admin/works/${id}/moderate`, {
    data: { action: "offline" },
  });
  expect((await request.get(`/api/works/${id}`)).status()).toBe(404);
  await request.put("/api/admin/reference", { data: { html: payload.html } });
  expect((await (await request.get("/api/reference")).json()).html).not.toMatch(
    /<script|onload=/,
  );
  await request.put("/api/admin/reference", {
    data: { html: baseline.reference_html },
  });
  await request.post("/api/admin/logout");
  expect((await request.get("/api/admin/config")).status()).toBe(401);
});
test("real pagination, hot/new ordering, nickname search and like failure recovery", async ({
  page,
  request,
}) => {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(process.env.E2E_DB_PATH!);
  const insert = db.prepare(
    `INSERT INTO works (title,html,model_name,is_gpt6astra,verdict,nickname,anon_id,status,funny_value,created_at,updated_at) VALUES (?,?,?,0,NULL,?,?,'approved',?,?,?)`,
  );
  const ids: number[] = [];
  try {
    for (let i = 0; i < 14; i++) {
      const html = `<svg viewBox="0 0 360 240" xmlns="http://www.w3.org/2000/svg"><rect width="360" height="240" fill="#e5efdf"/><circle cx="105" cy="164" r="39" fill="none" stroke="#39634b" stroke-width="6"/><circle cx="255" cy="164" r="39" fill="none" stroke="#39634b" stroke-width="6"/><path d="M105 164 158 105 200 164H105L222 105H158M222 105 255 164" stroke="#ce8958" fill="none" stroke-width="5"/><ellipse cx="179" cy="82" rx="28" ry="22" fill="#fffdf1"/><path d="m201 80 40 7-38 7" fill="#efbf67"/><circle cx="194" cy="76" r="3" fill="#39634b"/></svg>`;
      ids.push(
        Number(
          insert.run(
            `QA 分页作品 ${i + 1}`,
            html,
            "pagination-mock",
            "分页验证员",
            crypto.randomUUID(),
            14 - i,
            Date.now() + i,
            Date.now(),
          ).lastInsertRowid,
        ),
      );
    }
    for (let i = 0; i < ids.length; i++) {
      for (let vote = 0; vote < 14 - i; vote++)
        db.prepare(
          "INSERT INTO likes (work_id,anon_id,created_at) VALUES (?,?,?)",
        ).run(ids[i], crypto.randomUUID(), Date.now());
    }
    const first = await (
      await request.get("/api/works?model=pagination-mock&board=hot&page=1")
    ).json();
    const second = await (
      await request.get("/api/works?model=pagination-mock&board=hot&page=2")
    ).json();
    expect(first).toMatchObject({ pages: 2, total: 14 });
    expect(first.items).toHaveLength(12);
    expect(second.items).toHaveLength(2);
    expect(
      new Set([...first.items, ...second.items].map((w: any) => w.id)).size,
    ).toBe(14);
    expect(first.items[0].id).toBe(ids[0]);
    expect(
      (
        await (
          await request.get(
            "/api/works?model=pagination-mock&board=new&q=分页验证员",
          )
        ).json()
      ).items[0].id,
    ).toBe(ids[13]);
    await page.goto("/leaderboard");
    await page
      .getByRole("combobox", { name: "筛选模型" })
      .selectOption("pagination-mock");
    await expect(page.locator(".work-card")).toHaveCount(12);
    await page.getByRole("button", { name: "下一页" }).click();
    await expect(page.locator(".work-card")).toHaveCount(2);
    await page.getByRole("button", { name: "上一页" }).click();
    await expect(page.locator(".work-card")).toHaveCount(12);
    await page.route("**/like", (route) =>
      route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({ error: "点赞太快了" }),
      }),
    );
    const like = page.locator(".like-btn").first();
    const count = await like.innerText();
    await like.click();
    await expect(page.getByRole("alert")).toContainText("点赞未成功");
    await expect(like).toBeEnabled();
    await expect(like).toHaveText(count);
    expect(
      await page.evaluate(() => localStorage.getItem("gpttest_liked")),
    ).toBeNull();
    await page.unroute("**/like");
    await like.click();
    await expect(like).toBeDisabled();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await capturePage(page, "../docs/verification/leaderboard-desktop.png");
  } finally {
    for (const id of ids) {
      db.prepare("DELETE FROM likes WHERE work_id=?").run(id);
      db.prepare("DELETE FROM works WHERE id=?").run(id);
    }
    db.close();
  }
});

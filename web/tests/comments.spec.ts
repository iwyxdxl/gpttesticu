import { test, expect, type Page } from "@playwright/test";

// 与 acceptance.spec.ts 相同的最小鹈鹕 SVG，直接落库造一个已过审作品
const pelicanHtml = `<svg viewBox="0 0 360 240" xmlns="http://www.w3.org/2000/svg"><rect width="360" height="240" fill="#e5efdf"/><circle cx="105" cy="164" r="39" fill="none" stroke="#39634b" stroke-width="6"/><circle cx="255" cy="164" r="39" fill="none" stroke="#39634b" stroke-width="6"/><ellipse cx="179" cy="82" rx="28" ry="22" fill="#fffdf1"/></svg>`;

async function insertWork(status: "approved" | "pending", title: string) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(process.env.E2E_DB_PATH!);
  return Number(
    db
      .prepare(
        `INSERT INTO works (title,html,model_name,is_gpt6astra,verdict,nickname,anon_id,status,funny_value,created_at,updated_at) VALUES (?,?,?,0,'unknown','QA 评论员',?,?,0,?,?)`,
      )
      .run(title, pelicanHtml, "comment-mock", crypto.randomUUID(), status, Date.now(), Date.now())
      .lastInsertRowid,
  );
}

async function adminLogin(page: Page) {
  await page.goto("/admin");
  await page
    .getByLabel("管理员密码", { exact: true })
    .fill("qa-local-password-only");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("button", { name: "退出登录" })).toBeVisible();
}

test("comment API rules: validation, anon identity, self-delete and admin moderation", async ({
  request,
}) => {
  const workId = await insertWork("approved", "QA 评论 API 作品");
  const anonId = crypto.randomUUID();

  expect(
    (
      await request.post(`/api/works/${workId}/comments`, {
        data: { anon_id: "bad", content: "hi" },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post(`/api/works/${workId}/comments`, {
        data: { anon_id: anonId, content: "   " },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.post(`/api/works/${workId}/comments`, {
        data: { anon_id: anonId, content: "长".repeat(501) },
      })
    ).status(),
  ).toBe(400);

  const pendingId = await insertWork("pending", "QA 评论待审作品");
  expect(
    (
      await request.post(`/api/works/${pendingId}/comments`, {
        data: { anon_id: anonId, content: "hi" },
      })
    ).status(),
  ).toBe(404);
  expect((await request.get(`/api/works/${pendingId}/comments`)).status()).toBe(
    404,
  );

  const post = await request.post(`/api/works/${workId}/comments`, {
    data: { anon_id: anonId, nickname: "QA 鹈鹕", content: "骑得真抽象" },
  });
  expect(post.ok()).toBe(true);
  const { id: commentId } = await post.json();

  // 公开列表绝不泄露 anon_id，mine 标记随查询者变化
  const list = await (
    await request.get(`/api/works/${workId}/comments?mine=${anonId}`)
  ).json();
  expect(JSON.stringify(list)).not.toContain(anonId);
  expect(list.items[0]).toMatchObject({
    id: commentId,
    nickname: "QA 鹈鹕",
    content: "骑得真抽象",
    mine: true,
  });
  const otherList = await (
    await request.get(
      `/api/works/${workId}/comments?mine=${crypto.randomUUID()}`,
    )
  ).json();
  expect(otherList.items[0].mine).toBe(false);
  expect(
    (await (await request.get(`/api/works/${workId}`)).json()).work
      .comment_count,
  ).toBe(1);

  // 他人匿名身份删不掉我的评论
  expect(
    (
      await request.post(`/api/works/${workId}/comments/${commentId}/delete`, {
        data: { anon_id: crypto.randomUUID() },
      })
    ).status(),
  ).toBe(404);
  expect(
    (
      await request.post(`/api/works/${workId}/comments/${commentId}/delete`, {
        data: { anon_id: anonId },
      })
    ).ok(),
  ).toBe(true);
  expect(
    (await (await request.get(`/api/works/${workId}`)).json()).work
      .comment_count,
  ).toBe(0);

  // 管理端：隐藏 / 恢复 / 删除
  const second = await request.post(`/api/works/${workId}/comments`, {
    data: { anon_id: anonId, content: "第二条" },
  });
  const cid = (await second.json()).id;
  expect((await request.get("/api/admin/comments")).status()).toBe(401);
  await request.post("/api/admin/login", {
    data: { password: "qa-local-password-only" },
  });
  const adminList = await (await request.get("/api/admin/comments")).json();
  expect(
    adminList.items.find((c: any) => c.id === cid),
  ).toMatchObject({ anon_id: anonId, work_title: "QA 评论 API 作品", status: "approved" });

  await request.post(`/api/admin/comments/${cid}/moderate`, {
    data: { action: "hide" },
  });
  expect(
    (await (await request.get(`/api/works/${workId}/comments`)).json()).total,
  ).toBe(0);
  expect(
    (await (await request.get(`/api/works/${workId}`)).json()).work
      .comment_count,
  ).toBe(0);
  expect(
    (
      await (
        await request.get("/api/admin/comments?status=hidden")
      ).json()
    ).items.map((c: any) => c.id),
  ).toContain(cid);
  await request.post(`/api/admin/comments/${cid}/moderate`, {
    data: { action: "restore" },
  });
  expect(
    (await (await request.get(`/api/works/${workId}/comments`)).json()).total,
  ).toBe(1);
  await request.post(`/api/admin/comments/${cid}/moderate`, {
    data: { action: "delete" },
  });
  expect(
    (
      await (await request.get("/api/admin/comments")).json()
    ).items.find((c: any) => c.id === cid),
  ).toBeUndefined();
  expect(
    (
      await request.post(`/api/admin/comments/${cid}/moderate`, {
        data: { action: "hide" },
      })
    ).status(),
  ).toBe(404);
  await request.post("/api/admin/logout");
});

test("comment UI: post, persist, self-delete, admin hide and card count", async ({
  page,
  request,
}) => {
  const workId = await insertWork("approved", "QA 评论 UI 作品");
  const card = () =>
    page.locator(".work-card", { hasText: "QA 评论 UI 作品" });

  await page.goto("/");
  await expect(card().locator(".comment-count")).toHaveText("💬 0");

  await page.goto(`/work/${workId}`);
  await page.getByLabel("评论内容").fill("这只鹈鹕有点东西");
  await page.getByRole("button", { name: "发表评论" }).click();
  const item = page.locator(".comment-item", { hasText: "这只鹈鹕有点东西" });
  await expect(item.locator(".comment-nick")).not.toBeEmpty();
  await expect(item.getByRole("button", { name: "删除" })).toBeVisible();

  await page.reload();
  await expect(
    page.locator(".comment-item", { hasText: "这只鹈鹕有点东西" }),
  ).toBeVisible();

  await page.goto("/");
  await expect(card().locator(".comment-count")).toHaveText("💬 1");

  // 本人删除
  await page.goto(`/work/${workId}`);
  await page
    .locator(".comment-item", { hasText: "这只鹈鹕有点东西" })
    .getByRole("button", { name: "删除" })
    .click();
  await expect(page.locator(".comment-item")).toHaveCount(0);
  await expect(
    (await (await request.get(`/api/works/${workId}`)).json()).work
      .comment_count,
  ).toBe(0);

  // 管理员隐藏后前台不可见，恢复后回来
  await page.goto(`/work/${workId}`);
  await page.getByLabel("评论内容").fill("管理员来看看");
  await page.getByRole("button", { name: "发表评论" }).click();
  await expect(
    page.locator(".comment-item", { hasText: "管理员来看看" }),
  ).toBeVisible();
  await adminLogin(page);
  await page.getByRole("button", { name: "💬 评论" }).click();
  const row = page.locator(".mod-item", { hasText: "管理员来看看" });
  await row.getByRole("button", { name: "隐藏" }).click();
  await page.goto(`/work/${workId}`);
  await expect(page.locator(".comment-item")).toHaveCount(0);
  await expect(
    (await (await request.get(`/api/works/${workId}`)).json()).work
      .comment_count,
  ).toBe(0);
  await page.goto("/admin");
  await page.getByRole("button", { name: "💬 评论" }).click();
  await page.getByRole("button", { name: "已隐藏" }).click();
  await page
    .locator(".mod-item", { hasText: "管理员来看看" })
    .getByRole("button", { name: "恢复显示" })
    .click();
  await page.goto(`/work/${workId}`);
  await expect(
    page.locator(".comment-item", { hasText: "管理员来看看" }),
  ).toBeVisible();
});

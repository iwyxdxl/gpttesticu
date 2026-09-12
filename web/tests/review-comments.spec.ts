import { test, expect, type Page } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";

function seedComments(count: number, status = "approved") {
  const db = new DatabaseSync(process.env.E2E_DB_PATH!);
  try {
    const anonId = crypto.randomUUID();
    const workId = Number(db.prepare(`INSERT INTO works
      (title,html,model_name,nickname,anon_id,status,created_at,updated_at)
      VALUES ('Review comments','<p>Review</p>','gpt6astra','Review',?,'approved',?,?)`)
      .run(anonId, Date.now(), Date.now()).lastInsertRowid);
    const ids = Array.from({ length: count }, (_, i) => Number(db.prepare(`INSERT INTO comments
      (work_id,anon_id,nickname,content,status,created_at) VALUES (?,?,'Review',?,?,?)`)
      .run(workId, anonId, `Review comment ${i + 1}`, status, Date.now()).lastInsertRowid));
    return { workId, anonId, ids };
  } finally {
    db.close();
  }
}

async function login(page: Page) {
  await page.request.post("/api/admin/login", { data: { password: "qa-local-password-only" } });
  await page.goto("/admin");
  await page.getByRole("button", { name: "💬 评论" }).click();
}

test("review: deleting a loaded comment must not skip older comments", async ({ page }) => {
  const { workId, anonId } = seedComments(21);
  await page.addInitScript(id => localStorage.setItem("gpttest_anon_id", id), anonId);
  await page.goto(`/work/${workId}`);
  await expect(page.locator(".comment-item")).toHaveCount(20);
  await page.locator(".comment-item").first().getByRole("button", { name: "删除" }).click();
  await expect(page.locator(".comment-item")).toHaveCount(19);
  await page.getByRole("button", { name: "加载更多评论" }).click();
  await expect(page.locator(".comment-item")).toHaveCount(20);
  await expect(page.getByText("Review comment 1", { exact: true })).toBeVisible();
});

test("review: posting waits for the initial comment snapshot", async ({ page }) => {
  const { workId } = seedComments(0);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/works/${workId}/comments?**`, async route => {
    const response = await route.fetch();
    await held;
    await route.fulfill({ response });
  });
  await page.goto(`/work/${workId}`);
  await page.getByLabel("评论内容").fill("New comment survives loading");
  try {
    await expect(page.getByRole("button", { name: "发表评论" })).toBeDisabled();
  } finally {
    release();
  }
  await page.getByRole("button", { name: "发表评论" }).click();
  await expect(page.getByText("New comment survives loading", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("New comment survives loading", { exact: true })).toBeVisible();
});

test("review: admin deleting the last item on the last page returns to a valid page", async ({ page }) => {
  const { workId } = seedComments(21, "hidden");
  await login(page);
  await page.getByRole("button", { name: "已隐藏", exact: true }).click();
  await expect(page.locator(".mod-item")).toHaveCount(20);
  await page.getByRole("button", { name: "→", exact: true }).click();
  await expect(page.locator(".mod-item")).toHaveCount(1);
  await page.locator(".mod-item").getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.locator(".mod-item")).toHaveCount(20);
  // Keep subsequent integration tests independent of these hidden fixtures.
  const db = new DatabaseSync(process.env.E2E_DB_PATH!);
  try { db.prepare("UPDATE comments SET status='approved' WHERE work_id=?").run(workId); }
  finally { db.close(); }
});

test("review: a delayed admin filter response cannot replace the selected filter", async ({ page }) => {
  let release!: () => void;
  let captured!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { captured = resolve; });
  await page.route("**/api/admin/comments?**", async route => {
    const status = new URL(route.request().url()).searchParams.get("status") || "hidden";
    if (status === "approved") { captured(); await held; }
    await route.fulfill({ json: {
      items: [{ id: 1, work_id: 1, nickname: "Review", content: `Filter ${status}`, status, created_at: 0 }],
      page: 1, pages: 1, total: 1,
    } });
  });
  await login(page);
  await page.getByRole("button", { name: "显示中", exact: true }).click();
  await started;
  await page.getByRole("button", { name: "已隐藏", exact: true }).click();
  await expect(page.getByText("Filter hidden", { exact: true })).toBeVisible();
  const response = page.waitForResponse(r => r.url().includes("/api/admin/comments?") && r.url().includes("status=approved"));
  release();
  await (await response).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.getByText("Filter hidden", { exact: true })).toBeVisible();
});

test("review: comment cursors survive insertions, hidden rows and a deleted boundary", async ({ request }) => {
  const { workId, anonId, ids } = seedComments(45);
  const url = `/api/works/${workId}/comments`;
  const first = await (await request.get(`${url}?mine=${anonId}`)).json();
  expect(first.items.map((c: any) => c.id)).toEqual(ids.slice(25).reverse());
  expect(first.next_cursor).toBe(ids[25]);
  expect(JSON.stringify(first)).not.toContain(anonId);

  const db = new DatabaseSync(process.env.E2E_DB_PATH!);
  try {
    db.prepare("DELETE FROM comments WHERE id=?").run(first.next_cursor);
    db.prepare("UPDATE comments SET status='hidden' WHERE id=?").run(ids[44]);
    db.prepare(`INSERT INTO comments (work_id,anon_id,content,created_at)
      VALUES (?,?,'Concurrent new comment',?)`).run(workId, anonId, Date.now());
  } finally { db.close(); }
  const second = await (await request.get(`${url}?before=${first.next_cursor}`)).json();
  expect(second.items.map((c: any) => c.id)).toEqual(ids.slice(5, 25).reverse());
  const last = await (await request.get(`${url}?before=${second.next_cursor}`)).json();
  expect(last.items.map((c: any) => c.id)).toEqual(ids.slice(0, 5).reverse());
  expect(last.next_cursor).toBeNull();
  const legacy = await (await request.get(`${url}?page=2`)).json();
  expect(legacy).toMatchObject({ page: 2, pages: 3, total: 44 });
  expect(legacy.items).toHaveLength(20);
  for (const cursor of ["0", "-1", "1.5", "NaN", "Infinity", "9007199254740992"])
    expect((await request.get(`${url}?before=${cursor}`)).status()).toBe(400);
});

test("review: admin work edits persist classification and verdict atomically", async ({ page, request }) => {
  const { workId } = seedComments(0);
  const endpoint = `/api/admin/works/${workId}`;
  expect((await request.put(endpoint, { data: { verdict: "normal" } })).status()).toBe(401);
  await request.post("/api/admin/login", { data: { password: "qa-local-password-only" } });
  expect((await request.put(endpoint, { data: {
    is_gpt6astra: true, model_name: "gpt-6-astra-low", verdict: "normal",
  } })).ok()).toBe(true);
  expect((await request.put(endpoint, { data: {
    model_name: "gpt-6-astra-high", verdict: "invalid",
  } })).status()).toBe(400);
  expect((await (await request.get(`/api/works/${workId}`)).json()).work).toMatchObject({
    is_gpt6astra: 1, model_name: "gpt-6-astra-low", verdict: "normal",
  });

  await login(page);
  await page.getByRole("button", { name: "🔍 审核" }).click();
  await page.getByRole("button", { name: "已通过", exact: true }).click();
  const row = page.locator(".mod-item").filter({ has: page.getByText(`#${workId} Review comments`, { exact: true }) });
  await row.getByRole("button", { name: "编辑", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "编辑作品信息" });
  await modal.getByRole("button", { name: "其他模型", exact: true }).click();
  await modal.getByLabel("实际模型名 *").fill("review-other-model");
  await modal.getByRole("button", { name: "已降智", exact: true }).click();
  await modal.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(modal).toBeHidden();
  expect((await (await request.get(`/api/works/${workId}`)).json()).work).toMatchObject({
    is_gpt6astra: 0, model_name: "review-other-model", verdict: "dumbed", html: "<p>Review</p>",
  });
  expect((await request.put(endpoint, { data: { is_gpt6astra: true } })).ok()).toBe(true);
  expect((await (await request.get(`/api/works/${workId}`)).json()).work).toMatchObject({
    is_gpt6astra: 1, model_name: "gpt6astra", verdict: "dumbed",
  });
});

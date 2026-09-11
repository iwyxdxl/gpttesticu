import { sanitizeUserHtml } from "../sanitize.js";
import { Hono } from "hono";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { db, getConfig, setConfig } from "../db.js";
import { rateLimit, clientIp, sleep } from "../ratelimit.js";
import { VERDICTS } from "./public.js";

export const adminApi = new Hono();

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const COOKIE = "gpttest_admin_session";
const TOKEN_TTL = 24 * 3600 * 1000;

// HttpOnly session；拒绝跨站写入，避免 cookie 登录后的 CSRF。
adminApi.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  if (!["GET", "HEAD"].includes(c.req.method)) {
    if (c.req.header("sec-fetch-site") === "cross-site")
      return c.json({ error: "不允许跨站操作" }, 403);
    const origin = c.req.header("origin");
    const host = c.req.header("host");
    if (origin && new URL(origin).host !== host)
      return c.json({ error: "不允许跨站操作" }, 403);
    if (
      c.req.path.endsWith("/login") ||
      c.req.method === "PUT" ||
      c.req.path.endsWith("/moderate")
    ) {
      if (!c.req.header("content-type")?.startsWith("application/json"))
        return c.json({ error: "需要 JSON 请求" }, 415);
    }
  }
  if (c.req.path === "/api/admin/login" || c.req.path === "/login")
    return next();
  const token = getCookie(c, COOKIE) || "";
  if (!/^[a-f0-9]{64}$/.test(token)) return c.json({ error: "未授权" }, 401);
  const row = db
    .prepare("SELECT expires_at FROM sessions WHERE token = ?")
    .get(token) as any;
  if (!row || row.expires_at <= Date.now())
    return c.json({ error: "登录已过期" }, 401);
  return next();
});

adminApi.post("/login", async (c) => {
  if (!ADMIN_PASSWORD || ADMIN_PASSWORD === "change-me-please")
    return c.json({ error: "请先配置管理员密码再登录" }, 503);
  if (!rateLimit(`adminlogin:${clientIp(c)}`, 10, 10 * 60_000))
    return c.json({ error: "尝试次数过多，请稍后再试" }, 429);
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "请求体不合法" }, 400);
  }
  const password = String(body?.password ?? "");
  const actual = Buffer.from(password);
  const expected = Buffer.from(ADMIN_PASSWORD);
  const ok =
    actual.length === expected.length && timingSafeEqual(actual, expected);
  if (!ok) {
    await sleep(600);
    return c.json({ error: "密码不对" }, 401);
  }
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  db.prepare(
    "INSERT INTO sessions (token, created_at, expires_at) VALUES (?, ?, ?)",
  ).run(token, now, now + TOKEN_TTL);
  // 顺手清理过期会话
  if (Math.random() < 0.1)
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    sameSite: "Strict",
    path: "/api/admin",
    maxAge: TOKEN_TTL / 1000,
    secure:
      new URL(c.req.url).protocol === "https:" ||
      (process.env.TRUST_PROXY === "1" &&
        c.req.header("x-forwarded-proto") === "https"),
  });
  return c.json({ ok: true, expires_at: now + TOKEN_TTL });
});

adminApi.get("/session", (c) => c.json({ ok: true }));

adminApi.post("/logout", (c) => {
  const token = getCookie(c, COOKIE) || "";
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
  deleteCookie(c, COOKIE, { path: "/api/admin" });
  return c.json({ ok: true });
});

adminApi.get("/overview", (c) => {
  const total = (
    db.prepare("SELECT COUNT(*) AS n FROM stats_events").get() as any
  ).n;
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const today = (
    db
      .prepare("SELECT COUNT(*) AS n FROM stats_events WHERE created_at >= ?")
      .get(dayStart.getTime()) as any
  ).n;
  const verdicts: Record<string, number> = { dumbed: 0, normal: 0, unknown: 0 };
  for (const row of db
    .prepare("SELECT verdict, COUNT(*) AS n FROM stats_events GROUP BY verdict")
    .all() as any[]) {
    verdicts[row.verdict] = row.n;
  }
  const works: Record<string, number> = {};
  for (const row of db
    .prepare("SELECT status, COUNT(*) AS n FROM works GROUP BY status")
    .all() as any[]) {
    works[row.status] = row.n;
  }
  const likesTotal = (
    db.prepare("SELECT COUNT(*) AS n FROM likes").get() as any
  ).n;
  const commentsTotal = (
    db.prepare("SELECT COUNT(*) AS n FROM comments").get() as any
  ).n;
  const topWorks = db
    .prepare(
      `SELECT id, title, model_name, funny_value FROM works WHERE status='approved' ORDER BY funny_value DESC LIMIT 5`,
    )
    .all();
  return c.json({
    human_verdicts: db.prepare("SELECT verdict, COUNT(*) AS n FROM test_feedback GROUP BY verdict").all(),
    feedback_comparison: db.prepare("SELECT auto_verdict, verdict, COUNT(*) AS n FROM test_feedback GROUP BY auto_verdict, verdict").all(),
    total_users: (db.prepare("SELECT COUNT(*) AS n FROM visitors").get() as any).n,
    today_users: (db.prepare("SELECT COUNT(*) AS n FROM visitors WHERE last_seen_at >= ?")
      .get(Math.floor((Date.now() + 8 * 3600_000) / 86400_000) * 86400_000 - 8 * 3600_000) as any).n,
    total_tests: total,
    today_tests: today,
    verdicts,
    works,
    likes_total: likesTotal,
    comments_total: commentsTotal,
    top_works: topWorks,
  });
});

adminApi.get("/works", (c) => {
  const status = c.req.query("status") || "pending";
  const page = Math.min(
    100000,
    Math.max(1, Math.floor(Number(c.req.query("page")) || 1)),
  );
  const pageSize = 10;
  const total = (
    db
      .prepare("SELECT COUNT(*) AS n FROM works WHERE status = ?")
      .get(status) as any
  ).n;
  const items = db
    .prepare(
      `SELECT id, title, html, model_name, is_gpt6astra, verdict, nickname, anon_id, status, funny_value, created_at, source, chat_log, auto_verdict
       FROM works WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(status, pageSize, (page - 1) * pageSize);
  return c.json({
    items,
    page,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    total,
  });
});

adminApi.post("/works/:id/moderate", async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "请求体不合法" }, 400);
  }
  const action = body?.action;
  const map: Record<string, string> = {
    approve: "approved",
    reject: "rejected",
    offline: "offline",
  };
  if (!map[action]) return c.json({ error: "action 不合法" }, 400);
  const id = Number(c.req.param("id"));
  const now = Date.now();
  // 通过时把 created_at 刷新为发布时间，保证「最新上传榜」语义正确
  const res =
    action === "approve"
      ? db
          .prepare(
            `UPDATE works SET status='approved', created_at=?, updated_at=? WHERE id=?`,
          )
          .run(now, now, id)
      : db
          .prepare(`UPDATE works SET status=?, updated_at=? WHERE id=?`)
          .run(map[action], now, id);
  if (Number(res.changes) === 0) return c.json({ error: "作品不存在" }, 404);
  return c.json({ ok: true });
});

// ---------- 评论管理 ----------

adminApi.get("/comments", (c) => {
  const status = ["approved", "hidden"].includes(c.req.query("status") || "")
    ? (c.req.query("status") as string)
    : "";
  const page = Math.min(
    100000,
    Math.max(1, Math.floor(Number(c.req.query("page")) || 1)),
  );
  const pageSize = 20;
  const whereSql = status ? "WHERE c.status = ?" : "";
  const params = status ? [status] : [];
  const total = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM comments c ${whereSql}`)
      .get(...params) as any
  ).n;
  const items = db
    .prepare(
      `SELECT c.id, c.work_id, w.title AS work_title, c.nickname, c.anon_id, c.content, c.status, c.created_at
       FROM comments c LEFT JOIN works w ON w.id = c.work_id
       ${whereSql} ORDER BY c.id DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, (page - 1) * pageSize);
  return c.json({
    items,
    page,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    total,
  });
});

adminApi.post("/comments/:id/moderate", async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "请求体不合法" }, 400);
  }
  const action = body?.action;
  const id = Number(c.req.param("id"));
  let res: { changes: number | bigint };
  if (action === "delete") {
    res = db.prepare("DELETE FROM comments WHERE id = ?").run(id);
  } else {
    const map: Record<string, string> = { hide: "hidden", restore: "approved" };
    if (!map[action]) return c.json({ error: "action 不合法" }, 400);
    res = db
      .prepare("UPDATE comments SET status = ? WHERE id = ?")
      .run(map[action], id);
  }
  if (Number(res.changes) === 0) return c.json({ error: "评论不存在" }, 404);
  return c.json({ ok: true });
});

// 管理员修正作品的模型分类与人工判断结果，规则与上传校验保持一致。
adminApi.put("/works/:id", async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "请求体不合法" }, 400);
  }
  const id = Number(c.req.param("id"));
  const row = db
    .prepare("SELECT model_name, is_gpt6astra FROM works WHERE id = ?")
    .get(id) as any;
  if (!row) return c.json({ error: "作品不存在" }, 404);

  const sets: { col: string; val: string | number }[] = [];
  if (body?.is_gpt6astra !== undefined || body?.model_name !== undefined) {
    const isGpt =
      body?.is_gpt6astra !== undefined
        ? body.is_gpt6astra === true
        : row.is_gpt6astra === 1;
    if (isGpt) {
      let modelName: string;
      if (body?.model_name !== undefined) {
        modelName =
          String(body.model_name).trim().slice(0, 60) || "gpt6astra";
        if (!/^gpt[-_ ]?6[-_ ]?astra(?:$|[-_. ])/i.test(modelName))
          return c.json({ error: "模型名与 gpt6astra 标记不一致" }, 400);
      } else {
        // 现有名仍匹配 gpt6astra 才保留，否则回到默认名
        modelName = /^gpt[-_ ]?6[-_ ]?astra(?:$|[-_. ])/i.test(row.model_name)
          ? row.model_name
          : "gpt6astra";
      }
      sets.push({ col: "model_name", val: modelName });
      sets.push({ col: "is_gpt6astra", val: isGpt ? 1 : 0 });
    } else {
      const modelName =
        body?.model_name !== undefined
          ? String(body.model_name).trim().slice(0, 60)
          : row.model_name;
      if (!modelName)
        return c.json({ error: "非 gpt6astra 请填写实际模型名" }, 400);
      sets.push({ col: "model_name", val: modelName });
      sets.push({ col: "is_gpt6astra", val: 0 });
    }
  }
  if (body?.verdict !== undefined) {
    if (!VERDICTS.includes(body.verdict))
      return c.json({ error: "判断结果不合法" }, 400);
    sets.push({ col: "verdict", val: body.verdict });
  }
  if (sets.length === 0)
    return c.json({ error: "没有需要更新的字段" }, 400);
  const now = Date.now();
  db.prepare(
    `UPDATE works SET ${sets.map((s) => `${s.col}=?`).join(", ")}, updated_at=? WHERE id=?`,
  ).run(...sets.map((s) => s.val), now, id);
  return c.json({ ok: true });
});

adminApi.put("/config", async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "请求体不合法" }, 400);
  }
  const updates: Record<string, string> = {};

  for (const key of ["keywords_dumbed", "keywords_normal"] as const) {
    if (Array.isArray(body?.[key])) {
      const words = [
        ...new Set(
          body[key].map((w: any) => String(w ?? "").trim()).filter(Boolean),
        ),
      ]
        .slice(0, 200)
        .map((w: string) => w.slice(0, 50));
      updates[key] = JSON.stringify(words);
    }
  }
  if (body?.sample_paragraphs !== undefined) {
    const n = Math.floor(Number(body.sample_paragraphs));
    if (!(n >= 1 && n <= 10))
      return c.json({ error: "采样段数需在 1-10 之间" }, 400);
    updates.sample_paragraphs = String(n);
  }
  if (body?.sample_max_chars !== undefined) {
    const n = Math.floor(Number(body.sample_max_chars));
    if (!(n >= 500 && n <= 20000))
      return c.json({ error: "字符上限需在 500-20000 之间" }, 400);
    updates.sample_max_chars = String(n);
  }
  if (body?.user_prompt !== undefined) {
    const s = String(body.user_prompt).trim().slice(0, 2000);
    if (!s) return c.json({ error: "用户提示词不能为空" }, 400);
    updates.user_prompt = s;
  }
  if (body?.codex_system_prompt !== undefined) {
    const s = String(body.codex_system_prompt).slice(0, 60000);
    if (s.length < 100) return c.json({ error: "Codex 提示词太短了" }, 400);
    updates.codex_system_prompt = s;
  }
  for (const [k, v] of Object.entries(updates)) setConfig(k, v);
  return c.json({ ok: true, updated: Object.keys(updates) });
});

// 参考样本遵循同样的无脚本净化规则。
adminApi.put("/reference", async (c) => {
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "请求体不合法" }, 400);
  }
  const html = String(body?.html ?? "");
  if (!html.includes("<") || Buffer.byteLength(html, "utf8") > 2 * 1024 * 1024)
    return c.json({ error: "内容为空或超过 2MB" }, 400);
  setConfig("reference_html", sanitizeUserHtml(html));
  return c.json({ ok: true });
});

// 管理员取配置（含全部键）
adminApi.get("/config", (c) => {
  const keys = [
    "keywords_dumbed",
    "keywords_normal",
    "sample_paragraphs",
    "sample_max_chars",
    "user_prompt",
    "codex_system_prompt",
    "reference_html",
  ];
  const out: Record<string, string> = {};
  for (const k of keys) out[k] = getConfig(k) ?? "";
  return c.json(out);
});

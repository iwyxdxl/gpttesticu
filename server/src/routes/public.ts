import { Hono } from "hono";
import { db, getConfig, CONFIG_DEFAULTS } from "../db.js";
import { sanitizeUserHtml } from "../sanitize.js";
import { rateLimit, clientIp } from "../ratelimit.js";

export const publicApi = new Hono();

const VERDICTS = ["dumbed", "normal", "unknown"] as const;
type Verdict = (typeof VERDICTS)[number];

function publicConfig() {
  const g = (k: string) => getConfig(k) ?? CONFIG_DEFAULTS[k] ?? "";
  return {
    keywords_dumbed: JSON.parse(g("keywords_dumbed")) as string[],
    keywords_normal: JSON.parse(g("keywords_normal")) as string[],
    sample_paragraphs: Number(g("sample_paragraphs")) || 3,
    sample_max_chars: Number(g("sample_max_chars")) || 2000,
    user_prompt: g("user_prompt"),
    codex_system_prompt: g("codex_system_prompt"),
  };
}

publicApi.get("/config", (c) => c.json(publicConfig()));

publicApi.get("/stats", (c) => {
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
  return c.json({ total_tests: total, today_tests: today, verdicts });
});

// 浏览器匿名访问统计，与检测内容分开记录。
publicApi.post("/stats/visit", async (c) => {
  if (!rateLimit(`visits:${clientIp(c)}`, 120, 60_000))
    return c.json({ error: "太频繁了，歇会儿" }, 429);
  let body: any;
  try { body = await c.req.json(); } catch {
    return c.json({ error: "请求体不合法" }, 400);
  }
  if (!body || typeof body.anon_id !== "string" ||
      !/^[A-Za-z0-9-]{8,64}$/.test(body.anon_id) ||
      Object.keys(body).some(key => key !== "anon_id"))
    return c.json({ error: "访问统计仅允许合法的 anon_id" }, 400);
  const now = Date.now();
  db.prepare(`INSERT INTO visitors (anon_id, first_seen_at, last_seen_at)
    VALUES (?, ?, ?) ON CONFLICT(anon_id) DO UPDATE SET last_seen_at=excluded.last_seen_at`)
    .run(body.anon_id, now, now);
  return c.json({ ok: true });
});

// 匿名统计上报：只有判定结论 + 是否跑了完整测试，不含任何其他信息
publicApi.post("/stats/test", async (c) => {
  if (!rateLimit(`stats:${clientIp(c)}`, 60, 60_000))
    return c.json({ error: "太频繁了，歇会儿" }, 429);
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "请求体不合法" }, 400);
  }
  if (
    !body ||
    Object.keys(body).some((key) => !["verdict", "ran_full"].includes(key)) ||
    typeof body.ran_full !== "boolean"
  )
    return c.json({ error: "统计事件仅允许 verdict 和 ran_full" }, 400);
  const verdict = body?.verdict;
  if (!VERDICTS.includes(verdict))
    return c.json({ error: "verdict 不合法" }, 400);
  const ranFull = body?.ran_full === true;
  db.prepare(
    "INSERT INTO stats_events (verdict, ran_full, created_at) VALUES (?, ?, ?)",
  ).run(verdict, ranFull ? 1 : 0, Date.now());
  return c.json({ ok: true });
});

publicApi.post("/stats/feedback", async (c) => {
  if (!rateLimit(`feedback:${clientIp(c)}`, 60, 60_000))
    return c.json({ error: "太频繁了，歇会儿" }, 429);
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: "请求体不合法" }, 400); }
  if (!body || typeof body.test_id !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(body.test_id)
    || !VERDICTS.includes(body.verdict) || !VERDICTS.includes(body.auto_verdict)
    || typeof body.model_name !== "string" || !body.model_name.trim() || body.model_name.length > 60)
    return c.json({ error: "人工判断数据不合法" }, 400);
  const now = Date.now();
  db.prepare(`INSERT INTO test_feedback (test_id, verdict, auto_verdict, model_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(test_id) DO UPDATE SET verdict=excluded.verdict, updated_at=excluded.updated_at`)
    .run(body.test_id, body.verdict, body.auto_verdict, body.model_name, now, now);
  return c.json({ ok: true });
});

publicApi.get("/reference", (c) =>
  c.json({ html: getConfig("reference_html") ?? "" }),
);

// ---------- 排行榜 ----------

publicApi.get("/works", (c) => {
  const board = c.req.query("board") === "new" ? "new" : "hot";
  const page = Math.min(
    100000,
    Math.max(1, Math.floor(Number(c.req.query("page")) || 1)),
  );
  const pageSize = 12;
  const model = (c.req.query("model") || "all").trim();
  const q = (c.req.query("q") || "").trim().slice(0, 60);

  const where: string[] = ["status = 'approved'"];
  const params: any[] = [];
  if (model === "gpt6astra") {
    where.push("is_gpt6astra = 1");
  } else if (model === "others") {
    where.push("is_gpt6astra = 0");
  } else if (model && model !== "all") {
    where.push("model_name = ?");
    params.push(model);
  }
  if (q) {
    where.push("(title LIKE ? OR nickname LIKE ? OR model_name LIKE ?)");
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  const whereSql = where.join(" AND ");
  const total = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM works WHERE ${whereSql}`)
      .get(...params) as any
  ).n;
  const order =
    board === "new"
      ? "created_at DESC, id DESC"
      : "funny_value DESC, created_at DESC, id DESC";
  const items = db
    .prepare(
      `SELECT id, title, html, model_name, is_gpt6astra, verdict, nickname, funny_value, created_at, source
       FROM works WHERE ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, (page - 1) * pageSize);
  return c.json({
    items,
    page,
    pages: Math.max(1, Math.ceil(total / pageSize)),
    total,
  });
});

publicApi.get("/works/models", (c) => {
  const rows = db
    .prepare(
      `SELECT model_name, is_gpt6astra, COUNT(*) AS n FROM works WHERE status='approved'
       GROUP BY model_name, is_gpt6astra ORDER BY n DESC LIMIT 50`,
    )
    .all();
  return c.json({ models: rows });
});

publicApi.get("/works/:id", (c) => {
  const row = db
    .prepare(
      `SELECT id, title, html, model_name, is_gpt6astra, verdict, nickname, funny_value, created_at, source, chat_log, auto_verdict
       FROM works WHERE id = ? AND status = 'approved'`,
    )
    .get(Number(c.req.param("id")));
  if (!row) return c.json({ error: "作品不存在或未过审" }, 404);
  return c.json({ work: row });
});

publicApi.post("/works", async (c) => {
  if (!rateLimit(`upload:${clientIp(c)}`, 10, 3600_000))
    return c.json({ error: "上传太频繁，一小时后再试" }, 429);
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "请求体不合法" }, 400);
  }
  const title = String(body?.title ?? "")
    .trim()
    .slice(0, 80);
  const rawHtml = String(body?.html ?? "");
  if (!title) return c.json({ error: "标题不能为空" }, 400);
  if (!rawHtml || Buffer.byteLength(rawHtml, "utf8") > 2 * 1024 * 1024)
    return c.json({ error: "内容为空或超过 2MB 上限" }, 400);

  const isGpt6astra = body?.is_gpt6astra === true;
  let modelName: string;
  if (isGpt6astra) {
    modelName =
      String(body?.model_name ?? "")
        .trim()
        .slice(0, 60) || "gpt6astra";
    if (!/^gpt[-_ ]?6[-_ ]?astra(?:$|[-_. ])/i.test(modelName))
      return c.json({ error: "模型名与 gpt6astra 标记不一致" }, 400);
  } else {
    modelName = String(body?.model_name ?? "")
      .trim()
      .slice(0, 60);
    if (!modelName)
      return c.json({ error: "非 gpt6astra 请填写实际模型名" }, 400);
  }
  if (!VERDICTS.includes(body?.verdict)) return c.json({ error: "请手动选择是否降智" }, 400);
  const verdict = body.verdict;
  const chatLog = body?.chat_log;
  if (typeof chatLog !== "string" || !chatLog.trim() || Buffer.byteLength(chatLog, "utf8") > 8 * 1024 * 1024)
    return c.json({ error: "请提供完整聊天记录（上限 8MB）" }, 400);
  const autoVerdict = VERDICTS.includes(body?.auto_verdict) ? body.auto_verdict : null;
  const nickname =
    String(body?.nickname ?? "")
      .trim()
      .slice(0, 30) || "匿名鹈鹕";
  const anonId = String(body?.anon_id ?? "");
  if (!/^[A-Za-z0-9-]{8,64}$/.test(anonId))
    return c.json({ error: "匿名身份不合法" }, 400);

  const html = sanitizeUserHtml(rawHtml);
  if (!/<(?:svg|p|div|main|section|h[1-6]|img|canvas)\b/i.test(html))
    return c.json({ error: "内容里没找到 HTML/SVG" }, 400);

  const source = body?.source === "test" ? "test" : "custom";
  const now = Date.now();
  const res = db
    .prepare(
      `INSERT INTO works (title, html, model_name, is_gpt6astra, verdict, nickname, anon_id, status, funny_value, created_at, updated_at, source, chat_log, auto_verdict)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?, ?)`,
    )
    .run(
      title,
      html,
      modelName,
      isGpt6astra ? 1 : 0,
      verdict,
      nickname,
      anonId,
      now,
      now,
      source,
      chatLog,
      autoVerdict,
    );
  return c.json({
    ok: true,
    id: Number(res.lastInsertRowid),
    message: "已提交，过审后公开展示",
  });
});

publicApi.post("/works/:id/like", async (c) => {
  if (!rateLimit(`like:${clientIp(c)}`, 60, 60_000))
    return c.json({ error: "点赞太快了" }, 429);
  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "请求体不合法" }, 400);
  }
  const anonId = String(body?.anon_id ?? "");
  if (!/^[A-Za-z0-9-]{8,64}$/.test(anonId))
    return c.json({ error: "匿名身份不合法" }, 400);
  const id = Number(c.req.param("id"));
  const work = db
    .prepare(`SELECT id FROM works WHERE id = ? AND status='approved'`)
    .get(id);
  if (!work) return c.json({ error: "作品不存在或未过审" }, 404);
  const res = db
    .prepare(
      "INSERT OR IGNORE INTO likes (work_id, anon_id, created_at) VALUES (?, ?, ?)",
    )
    .run(id, anonId, Date.now());
  if (Number(res.changes) > 0) {
    const n = (
      db
        .prepare("SELECT COUNT(*) AS n FROM likes WHERE work_id = ?")
        .get(id) as any
    ).n;
    db.prepare(
      "UPDATE works SET funny_value = ?, updated_at = ? WHERE id = ?",
    ).run(n, Date.now(), id);
    return c.json({ ok: true, funny_value: n, already_liked: false });
  }
  const cur = db
    .prepare("SELECT funny_value FROM works WHERE id = ?")
    .get(id) as any;
  return c.json({
    ok: true,
    funny_value: cur?.funny_value ?? 0,
    already_liked: true,
  });
});

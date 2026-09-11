import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, "assets");

export const DB_PATH = process.env.DB_PATH || "./data/gpttest.db";
fs.mkdirSync(path.dirname(path.resolve(DB_PATH)), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");

db.exec(`
CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS works (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  title        TEXT NOT NULL,
  html         TEXT NOT NULL,
  model_name   TEXT NOT NULL,
  is_gpt6astra INTEGER NOT NULL DEFAULT 1,
  verdict      TEXT,
  nickname     TEXT NOT NULL DEFAULT '匿名鹈鹕',
  anon_id      TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  funny_value  INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_works_status_created ON works(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_works_funny ON works(status, funny_value DESC);
CREATE TABLE IF NOT EXISTS likes (
  work_id    INTEGER NOT NULL,
  anon_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (work_id, anon_id)
);
CREATE TABLE IF NOT EXISTS stats_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  verdict    TEXT NOT NULL,
  ran_full   INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stats_created ON stats_events(created_at);
CREATE TABLE IF NOT EXISTS visitors (
  anon_id TEXT PRIMARY KEY,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_visitors_last_seen ON visitors(last_seen_at);
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
`);

// Backward-compatible provenance label for old databases.
if (
  !(db.prepare("PRAGMA table_info(works)").all() as { name: string }[]).some(
    (column) => column.name === "source",
  )
) {
  db.exec("ALTER TABLE works ADD COLUMN source TEXT NOT NULL DEFAULT 'custom'");
}

for (const [name, type] of [["chat_log", "TEXT"], ["auto_verdict", "TEXT"]]) {
  if (!(db.prepare("PRAGMA table_info(works)").all() as { name: string }[]).some(c => c.name === name))
    db.exec(`ALTER TABLE works ADD COLUMN ${name} ${type}`);
}
db.exec(`CREATE TABLE IF NOT EXISTS test_feedback (
  test_id TEXT PRIMARY KEY,
  verdict TEXT NOT NULL,
  auto_verdict TEXT NOT NULL,
  model_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`);
// 作品评论：身份沿用匿名 anon_id 机制，status 支持管理员隐藏。
db.exec(`CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  work_id    INTEGER NOT NULL,
  anon_id    TEXT NOT NULL,
  nickname   TEXT NOT NULL DEFAULT '匿名鹈鹕',
  content    TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'approved',
  created_at INTEGER NOT NULL
)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_comments_work ON comments(work_id, status, id DESC)`);

function readAsset(name: string): string {
  return fs.readFileSync(path.join(ASSETS_DIR, name), "utf8");
}

export const CONFIG_DEFAULTS: Record<string, string> = {
  keywords_dumbed: JSON.stringify([
    "内嵌SVG",
    "内联SVG",
    "连续的骑行动画",
    "循环的骑行动画",
    "循环骑行",
    "循环运动",
  ]),
  keywords_normal: JSON.stringify(["踩踏", "踩动脚踏", "沿途风景", "背景移动"]),
  sample_paragraphs: "3",
  sample_max_chars: "2000",
  user_prompt: "创建一个 HTML，内容是 SVG 绘制一个鹈鹕骑自行车的 2D 动画",
  codex_system_prompt: readAsset("codex-system-prompt.md"),
  reference_html: readAsset("pelican-bike_gpt6astra_low.html"),
};

// 首次启动播种默认配置（已存在的键不覆盖）
{
  const seed = db.prepare(
    "INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)",
  );
  for (const [k, v] of Object.entries(CONFIG_DEFAULTS)) seed.run(k, v);
}

export function getConfig(key: string): string | undefined {
  const row = db.prepare("SELECT value FROM config WHERE key = ?").get(key) as
    { value: string } | undefined;
  return row?.value;
}

export function setConfig(key: string, value: string): void {
  db.prepare(
    "INSERT INTO config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}

// Only upgrade recognized shipped defaults; administrator-edited values stay intact.
const legacyDefaults: Record<string, string[]> = {
  codex_system_prompt: [
    "ad8a0366611094db0f7e1e3d947a2bbe0f1da350e69e300e205188c939d7de2e",
    "51d935038aeab4668f79bf4a01edbf4e5b1b94c2a6b76537c8d96c4dafe1beed",
  ],
  reference_html: [
    "a0eb7a11d69fa008a8530365eb489de433d2678f30a6973caa916e589664b1af",
    "837449b96abe5909fed1451bfa18b4f3daec28f0e8a630bbc20c38d162d3c4f8",
  ],
};
for (const [key, hashes] of Object.entries(legacyDefaults)) {
  const current = getConfig(key);
  if (
    current &&
    hashes.includes(createHash("sha256").update(current).digest("hex"))
  )
    setConfig(key, CONFIG_DEFAULTS[key]);
}

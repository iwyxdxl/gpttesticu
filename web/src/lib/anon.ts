// 浏览器级匿名身份：UUID 存 localStorage，用于点赞去重与作品署名。
// 注意：API Key / 端点 URL 永远不落 localStorage（隐私红线）。
const memory = new Map<string, string>();
function read(key: string) {
  try {
    return localStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}
function write(key: string, value: string) {
  memory.set(key, value);
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Storage may be disabled; retain this page's identity. */
  }
}

const ANON_KEY = "gpttest_anon_id";
const NICK_KEY = "gpttest_nick";
const LIKED_KEY = "gpttest_liked";

export function getAnonId(): string {
  let id = read(ANON_KEY);
  if (!id || !/^[A-Za-z0-9-]{8,64}$/.test(id)) {
    id =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
            (
              Number(c) ^
              (crypto.getRandomValues(new Uint8Array(1))[0] &
                (15 >> (Number(c) / 4)))
            ).toString(16),
          );
    write(ANON_KEY, id);
  }
  return id;
}

const ADJ = [
  "降智的",
  "抽象的",
  "像素级",
  "海风味的",
  "碳水超载的",
  "静电态的",
  "摸鱼中的",
  "睡不醒的",
  "加载失败的",
  "限速的",
  "围巾缠住的",
  "脚踏空的",
];
const NOUN = [
  "鹈鹕",
  "观察员",
  "海岸骑士",
  "路过企鹅",
  "车库章鱼",
  "备胎博士",
  "小电驴",
  "修车师傅",
];

export function randomNickname(): string {
  const a = ADJ[Math.floor(Math.random() * ADJ.length)];
  const n = NOUN[Math.floor(Math.random() * NOUN.length)];
  return `${a}${n}`;
}

export function getNickname(): string {
  let n = read(NICK_KEY);
  if (!n) {
    n = randomNickname();
    write(NICK_KEY, n);
  }
  return n;
}

export function setNickname(n: string) {
  write(NICK_KEY, n.trim().slice(0, 30) || randomNickname());
}

export function getLikedSet(): Set<string> {
  try {
    const values = JSON.parse(read(LIKED_KEY) || "[]");
    return new Set(
      Array.isArray(values) ? values.filter((v) => typeof v === "string") : [],
    );
  } catch {
    return new Set();
  }
}

export function addLiked(workId: string | number) {
  const s = getLikedSet();
  s.add(String(workId));
  write(LIKED_KEY, JSON.stringify([...s]));
}

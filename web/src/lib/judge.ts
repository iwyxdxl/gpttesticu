// 快速测试的采样与计分判定（计分制：采满样本后统一切分，不做先命中先判定）

export type Verdict = "dumbed" | "normal" | "unknown";

export interface JudgeResult {
  verdict: Verdict;
  dumbedScore: number;
  normalScore: number;
  hits: { word: string; count: number; side: "dumbed" | "normal" }[];
}

// 按空行/换行切自然段，过滤空段
export function splitParagraphs(text: string): string[] {
  return text
    .split(/\r\n|\n|\r/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// 是否达到采样口径：前 N 段收齐（第 N 段已被换行终止或第 N+1 段已出现），或字符达上限
export function shouldStopSampling(
  text: string,
  paragraphs: number,
  maxChars: number,
): boolean {
  return takeSample(text, paragraphs, maxChars).stoppedBy !== "end";
}

export function takeSample(
  text: string,
  paragraphs: number,
  maxChars: number,
): { sample: string; stoppedBy: "paragraphs" | "chars" | "end" } {
  // Locate boundaries in the original stream, before trimming/rejoining paragraphs.
  let paragraphEnd = Infinity;
  let count = 0;
  for (const line of text
    .slice(0, maxChars)
    .matchAll(/[^\r\n]*(?:\r\n|\n|\r|$)/g)) {
    if (line[0].trim() && /[\r\n]$/.test(line[0]) && ++count === paragraphs) {
      paragraphEnd = line.index! + line[0].length;
      break;
    }
  }
  const end = Math.min(paragraphEnd, maxChars, text.length);
  const stoppedBy =
    paragraphEnd <= maxChars && paragraphEnd <= text.length
      ? "paragraphs"
      : text.length >= maxChars
        ? "chars"
        : "end";
  return { sample: text.slice(0, end), stoppedBy };
}

export function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  let count = 0;
  let i = h.indexOf(n);
  while (i >= 0) {
    count++;
    i = h.indexOf(n, i + n.length);
  }
  return count;
}

export function judge(
  sample: string,
  dumbedWords: string[],
  normalWords: string[],
): JudgeResult {
  const hits: JudgeResult["hits"] = [];
  let dumbedScore = 0;
  let normalScore = 0;
  for (const w of dumbedWords) {
    const n = countOccurrences(sample, w);
    if (n > 0) {
      hits.push({ word: w, count: n, side: "dumbed" });
      dumbedScore += n;
    }
  }
  for (const w of normalWords) {
    const n = countOccurrences(sample, w);
    if (n > 0) {
      hits.push({ word: w, count: n, side: "normal" });
      normalScore += n;
    }
  }
  const verdict: Verdict =
    dumbedScore > normalScore
      ? "dumbed"
      : normalScore > dumbedScore
        ? "normal"
        : "unknown";
  return { verdict, dumbedScore, normalScore, hits };
}

export interface SampleSegment {
  text: string;
  side?: "dumbed" | "normal";
}

// 把样本文本按命中关键词切片，供前端高亮渲染
export function highlightSegments(
  sample: string,
  dumbedWords: string[],
  normalWords: string[],
): SampleSegment[] {
  const words = [
    ...dumbedWords.map((w) => ({ w, side: "dumbed" as const })),
    ...normalWords.map((w) => ({ w, side: "normal" as const })),
  ].filter((x) => x.w);
  if (!words.length) return [{ text: sample }];
  const escaped = words.map((x) => x.w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(${escaped.join("|")})`, "gi");
  const out: SampleSegment[] = [];
  let last = 0;
  for (const m of sample.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push({ text: sample.slice(last, idx) });
    const lower = m[0].toLowerCase();
    const hit = words.find((x) => x.w.toLowerCase() === lower);
    out.push({ text: m[0], side: hit?.side });
    last = idx + m[0].length;
  }
  if (last < sample.length) out.push({ text: sample.slice(last) });
  return out;
}

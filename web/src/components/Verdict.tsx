import type { JudgeResult } from "../lib/judge";

const META: Record<
  string,
  { emoji: string; label: string; sub: string; cls: string }
> = {
  dumbed: {
    emoji: "🤪",
    label: "疑似降智版",
    sub: "降智特征词命中更多。建议结合原文核验，不作为能力结论。",
    cls: "v-dumbed",
  },
  normal: {
    emoji: "😎",
    label: "疑似正常版",
    sub: "正常特征词命中更多。本结果仅供娱乐，不代表模型真实能力。",
    cls: "v-normal",
  },
  unknown: {
    emoji: "🤔",
    label: "无法判断",
    sub: "薛定谔的鹈鹕：关键词没咬中，上完整测试看真容",
    cls: "v-unknown",
  },
};

export function VerdictCard({
  result,
  onFullTest,
}: {
  result: JudgeResult;
  onFullTest?: () => void;
}) {
  const meta = META[result.verdict];
  return (
    <div className={`verdict-card ${meta.cls}`}>
      <div className="stamp">
        <span className="stamp-emoji">{meta.emoji}</span>
        <span className="stamp-label">{meta.label}</span>
      </div>
      <p className="verdict-sub">{meta.sub}</p>
      <div className="score-row">
        <div className="score dumbed">
          <span className="score-num">{result.dumbedScore}</span>
          <span className="score-name">降智分</span>
        </div>
        <span className="score-vs">VS</span>
        <div className="score normal">
          <span className="score-num">{result.normalScore}</span>
          <span className="score-name">正常分</span>
        </div>
      </div>
      {result.hits.length > 0 ? (
        <div className="hit-chips">
          {result.hits.map((h) => (
            <span
              key={`${h.side}-${h.word}`}
              className={`chip ${h.side === "dumbed" ? "chip-dumbed" : "chip-normal"}`}
            >
              {h.word} ×{h.count}
            </span>
          ))}
        </div>
      ) : (
        <div className="hit-chips">
          <span className="chip chip-none">
            一个关键词都没咬中，文本过于高冷
          </span>
        </div>
      )}
      {onFullTest && (
        <button className="btn btn-primary" onClick={onFullTest}>
          🚴 上完整测试（更费额度，但看得更清楚）
        </button>
      )}
    </div>
  );
}

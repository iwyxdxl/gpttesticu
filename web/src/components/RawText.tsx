import { highlightSegments } from "../lib/judge";

interface RawTextProps {
  sample: string;
  dumbedWords: string[];
  normalWords: string[];
}

// 采样原文 + 命中关键词高亮
export function RawText({ sample, dumbedWords, normalWords }: RawTextProps) {
  const segs = highlightSegments(sample, dumbedWords, normalWords);
  return (
    <pre className="raw-text">
      {segs.map((s, i) =>
        s.side ? (
          <mark
            key={i}
            className={s.side === "dumbed" ? "hit-dumbed" : "hit-normal"}
          >
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </pre>
  );
}

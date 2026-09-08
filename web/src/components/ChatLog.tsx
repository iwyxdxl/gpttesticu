export function ChatLog({ text, autoVerdict }: { text?: string | null; autoVerdict?: string | null }) {
  return (
    <details className="card chat-log">
      <summary>查看完整聊天记录</summary>
      {autoVerdict && <p className="muted small">快速检测结论：{({ dumbed: "疑似降智", normal: "疑似正常", unknown: "无法判断" } as Record<string, string>)[autoVerdict]}</p>}
      {text ? <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: "32rem", overflow: "auto" }}>{text}</pre> : <p className="muted">此历史作品未附带聊天记录。</p>}
    </details>
  );
}

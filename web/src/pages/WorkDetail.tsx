import { ChatLog } from "../components/ChatLog";
import { ErrorText } from "../components/ErrorText";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Preview } from "../components/Preview";
import { fetchWork, likeWork, type WorkItem } from "../lib/api";
import { addLiked, getAnonId, getLikedSet } from "../lib/anon";

const VERDICT_LABEL: Record<string, string> = {
  dumbed: "疑似降智版",
  normal: "疑似正常版",
  unknown: "无法判断",
};

export default function WorkDetail() {
  const { id } = useParams();
  const [work, setWork] = useState<WorkItem | null>(null);
  const [error, setError] = useState("");
  const [liking, setLiking] = useState(false);
  const [likeError, setLikeError] = useState("");
  const [liked, setLiked] = useState<Set<string>>(getLikedSet);

  useEffect(() => {
    setWork(null);
    setError("");
    if (id) {
      fetchWork(id)
        .then((d) => setWork(d.work))
        .catch((e) => setError(e?.message || "加载失败"));
    }
  }, [id]);

  const like = async () => {
    if (!work || liking || liked.has(String(work.id))) return;
    setLiking(true);
    setLikeError("");
    try {
      const r = await likeWork(work.id, getAnonId());
      addLiked(work.id);
      setLiked((s) => new Set(s).add(String(work.id)));
      setWork((current) =>
        current?.id === work.id
          ? { ...current, funny_value: r.funny_value }
          : current,
      );
    } catch (e: any) {
      setLikeError(`点赞未成功：${e.message}，可以重试。`);
    } finally {
      setLiking(false);
    }
  };

  if (error) {
    return (
      <div className="card error-card">
        <ErrorText message={error} />
        <Link className="btn btn-ghost" to="/">
          ← 回排行榜
        </Link>
      </div>
    );
  }
  if (!work) return <div className="loading-card">作品搬运中…</div>;

  return (
    <>
      <section className="page-head">
        <h1 className="page-title">{work.title}</h1>
        <div className="detail-meta">
          <span
            className={`model-badge ${work.is_gpt6astra ? "mb-gpt" : "mb-other"}`}
          >
            {work.is_gpt6astra
              ? work.model_name
              : `${work.model_name}（非astra）`}
          </span>
          {work.verdict && (
            <span className={`verdict-badge vb-${work.verdict}`}>
              {VERDICT_LABEL[work.verdict]}
            </span>
          )}
          <span className="source-badge">
            {work.source === "test" ? "来自完整测试" : "自定义上传"}
          </span>
          <span className="work-nick">{work.nickname}</span>
          <span className="work-date">
            {new Date(work.created_at).toLocaleString("zh-CN")}
          </span>
          <button
            className={`like-btn big ${liked.has(String(work.id)) ? "liked" : ""}`}
            onClick={like}
            disabled={liking || liked.has(String(work.id))}
          >
            🤣 搞笑值 {work.funny_value}
          </button>
        </div>
      </section>
      {likeError && (
        <div role="alert" className="form-error">
          <ErrorText message={likeError} />
        </div>
      )}
      <div className="card detail-preview-card">
        <Preview
          html={work.html}
          title={work.title}
          className="preview-detail"
        />
      </div>
      <ChatLog text={work.chat_log} autoVerdict={work.auto_verdict} />
      <div className="cta-row center">
        <Link className="btn btn-ghost" to="/">
          ← 回排行榜
        </Link>
      </div>
    </>
  );
}

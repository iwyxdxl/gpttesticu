import { ErrorText } from "../components/ErrorText";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { WorkThumb } from "../components/Preview";
import { UploadModal } from "../components/UploadModal";
import SiteHero from "../components/SiteHero";
import {
  fetchWorkModels,
  fetchWorks,
  likeWork,
  type WorkItem,
} from "../lib/api";
import { addLiked, getAnonId, getLikedSet } from "../lib/anon";

const VERDICT_LABEL: Record<string, string> = {
  dumbed: "疑似降智版",
  normal: "疑似正常版",
  unknown: "无法判断",
};

export default function Home() {
  const [board, setBoard] = useState<"hot" | "new">("hot");
  const [page, setPage] = useState(1);
  const [model, setModel] = useState("all");
  const [q, setQ] = useState("");
  const [qInput, setQInput] = useState("");
  const [data, setData] = useState<{
    items: WorkItem[];
    pages: number;
    total: number;
  } | null>(null);
  const [models, setModels] = useState<
    { model_name: string; is_gpt6astra: number; n: number }[]
  >([]);
  const [liked, setLiked] = useState<Set<string>>(getLikedSet);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const pendingLikes = useRef(new Set<number>());
  const requestVersion = useRef(0);
  const [uploadOpen, setUploadOpen] = useState(false);

  const load = useCallback(() => {
    const version = ++requestVersion.current;
    setLoading(true);
    setData(null);
    setError("");
    fetchWorks({ board, page, model, q })
      .then((d) => {
        if (version === requestVersion.current) setData(d);
      })
      .catch((e) => {
        if (version === requestVersion.current)
          setError(e?.message || "加载失败");
      })
      .finally(() => {
        if (version === requestVersion.current) setLoading(false);
      });
  }, [board, page, model, q]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    fetchWorkModels()
      .then((d) => setModels(d.models))
      .catch((e) => setError(`模型筛选列表加载失败\n${e.message}`));
  }, []);

  const like = async (w: WorkItem) => {
    if (liked.has(String(w.id)) || pendingLikes.current.has(w.id)) return;
    pendingLikes.current.add(w.id);
    try {
      const r = await likeWork(w.id, getAnonId());
      setError("");
      addLiked(w.id);
      setLiked((s) => new Set(s).add(String(w.id)));
      setData((d) =>
        d
          ? {
              ...d,
              items: d.items.map((it) =>
                it.id === w.id ? { ...it, funny_value: r.funny_value } : it,
              ),
            }
          : d,
      );
    } catch (e: any) {
      setError(`点赞未成功：${e.message}，可以重试。`);
    } finally {
      pendingLikes.current.delete(w.id);
    }
  };

  return (
    <>
      <SiteHero tab="board" />

      <div className="board-intro">
        <p className="board-intro-text">
          鹈鹕骑得越抽象，搞笑值越高。🤣 就是点赞，每个匿名身份一作品一票。
        </p>
        <button className="btn btn-primary" onClick={() => setUploadOpen(true)}>
          上传我的鹈鹕
        </button>
      </div>

      <div className="board-bar">
        <div className="seg">
          <button
            className={board === "hot" ? "on" : ""}
            onClick={() => {
              setBoard("hot");
              setPage(1);
            }}
          >
            🔥 搞笑值榜
          </button>
          <button
            className={board === "new" ? "on" : ""}
            onClick={() => {
              setBoard("new");
              setPage(1);
            }}
          >
            🆕 最新上传榜
          </button>
        </div>
        <select
          aria-label="筛选模型"
          value={model}
          onChange={(e) => {
            setModel(e.target.value);
            setPage(1);
          }}
        >
          <option value="all">全部模型</option>
          <option value="gpt6astra">gpt6astra</option>
          <option value="others">其他模型</option>
          {models
            .filter((m) => m.model_name !== "gpt6astra")
            .map((m) => (
              <option
                key={`${m.model_name}-${m.is_gpt6astra}`}
                value={m.model_name}
              >
                {m.model_name}（{m.n}）
              </option>
            ))}
        </select>
        <form
          className="search-row"
          onSubmit={(e) => {
            e.preventDefault();
            setQ(qInput.trim());
            setPage(1);
          }}
        >
          <input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            aria-label="搜索作品"
            placeholder="搜标题 / 署名 / 模型"
          />
          <button className="btn btn-ghost btn-sm" type="submit">
            搜索
          </button>
        </form>
      </div>

      {error && (
        <div className="card error-card" role="alert">
          <ErrorText message={error} />
          <button className="btn btn-ghost btn-sm" onClick={load}>
            重新加载
          </button>
        </div>
      )}
      {loading && <div className="loading-card">鹈鹕们排队进场中…</div>}
      {!loading && data && data.items.length === 0 && (
        <div className="loading-card">
          <span className="empty-icon">♧</span>
          <h2>
            {q || model !== "all" ? "没有找到这只鹈鹕" : "第一只鹈鹕，等你登场"}
          </h2>
          <p>
            {q || model !== "all"
              ? "换个关键词，或者清除筛选再看看。"
              : "上传一幅有趣的画作，让大家一起看看模型的想象力。"}
          </p>
          <button
            className="btn btn-primary"
            onClick={() => {
              if (q || model !== "all") {
                setQ("");
                setQInput("");
                setModel("all");
                setPage(1);
              } else setUploadOpen(true);
            }}
          >
            {q || model !== "all" ? "清除筛选" : "上传第一幅作品"}
          </button>
        </div>
      )}

      {!loading && data && data.total > 0 && (
        <p className="muted small">
          共 {data.total} 幅作品 · 第 {page} / {data.pages} 页
        </p>
      )}
      <div className="works-grid">
        {data?.items.map((w, i) => (
          <div
            className={`work-card ${board === "hot" && page === 1 && i < 3 ? `rank-${i + 1}` : ""}`}
            key={w.id}
          >
            {board === "hot" && page === 1 && i < 3 && (
              <span className="rank-medal">{["🥇", "🥈", "🥉"][i]}</span>
            )}
            <Link to={`/work/${w.id}`} className="thumb-link">
              <WorkThumb html={w.html} />
            </Link>
            <div className="work-info">
              <Link to={`/work/${w.id}`} className="work-title">
                {w.title}
              </Link>
              <div className="work-meta">
                <span
                  className={`model-badge ${w.is_gpt6astra ? "mb-gpt" : "mb-other"}`}
                >
                  {w.is_gpt6astra ? w.model_name : `${w.model_name}（非astra）`}
                </span>
                {w.verdict && (
                  <span className={`verdict-badge vb-${w.verdict}`}>
                    {VERDICT_LABEL[w.verdict]}
                  </span>
                )}
                <span className="work-nick">{w.nickname}</span>
                <span className="work-date">
                  {new Date(w.created_at).toLocaleDateString("zh-CN")}
                </span>
              </div>
              <div className="work-foot">
                <button
                  className={`like-btn ${liked.has(String(w.id)) ? "liked" : ""}`}
                  onClick={() => like(w)}
                  disabled={liked.has(String(w.id))}
                >
                  🤣 {w.funny_value}
                </button>
                <span className="comment-count" title="评论数">
                  💬 {w.comment_count ?? 0}
                </span>
                <Link to={`/work/${w.id}`} className="btn btn-ghost btn-sm">
                  看大图
                </Link>
              </div>
            </div>
          </div>
        ))}
      </div>

      {data && data.pages > 1 && (
        <div className="pager">
          <button
            className="btn btn-ghost"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            ← 上一页
          </button>
          <span>
            {page} / {data.pages}
          </span>
          <button
            className="btn btn-ghost"
            disabled={page >= data.pages}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页 →
          </button>
        </div>
      )}

      <UploadModal open={uploadOpen} onClose={() => setUploadOpen(false)} />
    </>
  );
}

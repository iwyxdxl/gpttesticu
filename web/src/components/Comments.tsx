import { ErrorText } from "./ErrorText";
import { useEffect, useRef, useState } from "react";
import {
  deleteMyComment,
  fetchComments,
  postComment,
  type CommentItem,
} from "../lib/api";
import { getAnonId, getNickname, setNickname } from "../lib/anon";

const MAX_CHARS = 500;

export function Comments({ workId }: { workId: number }) {
  const [items, setItems] = useState<CommentItem[] | null>(null);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [content, setContent] = useState("");
  const [nickname, setNick] = useState(getNickname);
  const [busy, setBusy] = useState(false);
  const [postError, setPostError] = useState("");
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const requestVersion = useRef(0);

  useEffect(() => {
    const version = ++requestVersion.current;
    setItems(null);
    setPage(1);
    setLoading(true);
    setError("");
    fetchComments(workId, 1, getAnonId())
      .then((d) => {
        if (version !== requestVersion.current) return;
        setItems(d.items);
        setPages(d.pages);
        setTotal(d.total);
      })
      .catch((e) => {
        if (version === requestVersion.current)
          setError(e?.message || "评论加载失败");
      })
      .finally(() => {
        if (version === requestVersion.current) setLoading(false);
      });
  }, [workId]);

  const loadMore = async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    setError("");
    try {
      const next = page + 1;
      const d = await fetchComments(workId, next, getAnonId());
      // 追加更早的评论；若期间有新评论插入会跨页重复，按 id 去重
      setItems((cur) => {
        const seen = new Set((cur ?? []).map((it) => it.id));
        return [...(cur ?? []), ...d.items.filter((it) => !seen.has(it.id))];
      });
      setPage(next);
      setPages(d.pages);
      setTotal(d.total);
    } catch (e: any) {
      setError(e?.message || "评论加载失败");
    } finally {
      setLoadingMore(false);
    }
  };

  const submit = async () => {
    if (busy) return;
    setPostError("");
    const text = content.trim();
    if (!text) return setPostError("评论内容不能为空");
    if (text.length > MAX_CHARS)
      return setPostError(`评论内容需在 1-${MAX_CHARS} 字之间`);
    setBusy(true);
    try {
      setNickname(nickname);
      const r = await postComment(workId, {
        anon_id: getAnonId(),
        nickname: nickname.trim() || "匿名鹈鹕",
        content: text,
      });
      setItems((cur) => [r.comment, ...(cur ?? [])]);
      setTotal((t) => t + 1);
      setContent("");
    } catch (e: any) {
      setPostError(e?.message || "评论失败，稍后再试");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (commentId: number) => {
    if (deletingId !== null) return;
    setDeletingId(commentId);
    setError("");
    try {
      await deleteMyComment(workId, commentId, getAnonId());
      setItems((cur) => (cur ?? []).filter((it) => it.id !== commentId));
      setTotal((t) => Math.max(0, t - 1));
    } catch (e: any) {
      setError(`删除未成功：${e.message}`);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="card comments-card" aria-label="评论区">
      <div className="card-title">
        💬 评论{total > 0 ? `（${total}）` : ""}
      </div>
      {error && (
        <div className="form-error" role="alert">
          <ErrorText message={error} />
        </div>
      )}
      <form
        className="comment-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="field">
          <span>署名（匿名，随便改）</span>
          <input
            value={nickname}
            onChange={(e) => setNick(e.target.value)}
            maxLength={30}
            aria-label="评论署名"
          />
        </label>
        <label className="field">
          <span>评论内容</span>
          <textarea
            aria-label="评论内容"
            rows={3}
            maxLength={MAX_CHARS}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="这只鹈鹕骑得怎么样？"
          />
        </label>
        <div className="comment-form-foot">
          <span className="muted small">
            {content.length} / {MAX_CHARS}
          </span>
          <button
            className="btn btn-primary btn-sm"
            type="submit"
            disabled={busy || !content.trim()}
          >
            {busy ? "发送中…" : "发表评论"}
          </button>
        </div>
        {postError && (
          <div className="form-error" role="alert">
            <ErrorText message={postError} />
          </div>
        )}
      </form>
      {loading && <p className="muted">评论加载中…</p>}
      {!loading && items && items.length === 0 && (
        <p className="muted">还没有评论，快来抢沙发 🛋️</p>
      )}
      <div className="comment-list">
        {items?.map((c) => (
          <div className="comment-item" key={c.id}>
            <div className="comment-meta">
              <span className="comment-nick">{c.nickname}</span>
              <span className="muted small">
                {new Date(c.created_at).toLocaleString("zh-CN")}
              </span>
              {c.mine && (
                <button
                  className="btn btn-ghost btn-sm comment-del"
                  disabled={deletingId !== null}
                  onClick={() => remove(c.id)}
                >
                  删除
                </button>
              )}
            </div>
            <p className="comment-text">{c.content}</p>
          </div>
        ))}
      </div>
      {items && page < pages && (
        <div className="cta-row center">
          <button
            className="btn btn-ghost btn-sm"
            disabled={loadingMore}
            onClick={loadMore}
          >
            {loadingMore ? "加载中…" : "加载更多评论"}
          </button>
        </div>
      )}
    </section>
  );
}

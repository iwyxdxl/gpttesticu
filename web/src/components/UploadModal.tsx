import { ErrorText } from "./ErrorText";
import { Modal } from "./Modal";
import { useEffect, useState } from "react";
import { Preview } from "./Preview";
import { uploadWork } from "../lib/api";
import { getAnonId, getNickname, setNickname } from "../lib/anon";

export interface UploadInitial {
  html?: string;
  model_name?: string;
  is_gpt6astra?: boolean;
  verdict?: string | null;
  chat_log?: string;
  auto_verdict?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  initial?: UploadInitial;
}

export function UploadModal({ open, onClose, initial }: Props) {
  const [title, setTitle] = useState("");
  const [html, setHtml] = useState("");
  const [isGpt, setIsGpt] = useState(true);
  const [modelName, setModelName] = useState("");
  const [verdict, setVerdict] = useState("");
  const [chatLog, setChatLog] = useState("");
  const [nickname, setNick] = useState(getNickname);
  const [showPreview, setShowPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setHtml(initial?.html ?? "");
    setIsGpt(initial?.is_gpt6astra ?? true);
    setModelName(initial?.model_name ?? "");
    setVerdict("");
    setChatLog(initial?.chat_log ?? "");
    setNick(getNickname());
    setShowPreview(false);
    setBusy(false);
    setDone(false);
    setError("");
  }, [open, initial]);

  if (!open) return null;

  const onFile = (f: File | undefined) => {
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) {
      setError("文件超过 2MB 上限");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setHtml(String(reader.result ?? ""));
      setError("");
    };
    reader.onerror = () => setError("文件读取失败，请重试");
    reader.readAsText(f);
  };

  const submit = async () => {
    setError("");
    if (!title.trim()) return setError("给作品起个标题吧");
    if (!html.trim()) return setError("内容不能为空");
    if (new Blob([html]).size > 2 * 1024 * 1024)
      return setError("内容超过 2MB 上限");
    if (!isGpt && !modelName.trim())
      return setError("非 gpt6astra 请填写实际模型名");
    if (!verdict) return setError("请手动选择是否降智");
    if (!chatLog.trim()) return setError("请提供完整聊天记录");
    if (new Blob([chatLog]).size > 8 * 1024 * 1024) return setError("聊天记录超过 8MB 上限");
    setBusy(true);
    try {
      setNickname(nickname);
      await uploadWork({
        source: initial?.html ? "test" : "custom",
        title: title.trim(),
        html,
        is_gpt6astra: isGpt,
        model_name: isGpt
          ? /^gpt[-_ ]?6[-_ ]?astra(?:$|[-_. ])/i.test(modelName)
            ? modelName
            : "gpt6astra"
          : modelName.trim(),
        verdict,
        chat_log: chatLog,
        auto_verdict: initial?.auto_verdict ?? null,
        nickname: nickname.trim() || "匿名鹈鹕",
        anon_id: getAnonId(),
      });
      setDone(true);
    } catch (e: any) {
      setError(e?.message || "上传失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      label="上传作品"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="modal-head">
        <h3>上传你的鹈鹕 🦢</h3>
        <button
          className="icon-btn"
          aria-label="关闭上传"
          disabled={busy}
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      {done ? (
        <div className="modal-done">
          <span className="big-emoji">🎉</span>
          <p>提交成功！管理员审核通过后就会出现在排行榜上。</p>
          <button className="btn btn-ghost" onClick={onClose}>
            好的
          </button>
        </div>
      ) : (
        <div className="modal-body">
          <label className="field">
            <span>标题 *</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={80}
              placeholder="例如：会骑车的鹈鹕（降智现场）"
            />
          </label>
          <div className="field">
            <span>
              HTML / SVG 内容 *（粘贴或{" "}
              <input
                aria-label="选择 HTML 或 SVG 文件"
                type="file"
                accept=".html,.svg,.htm"
                className="file-input"
                onChange={(e) => onFile(e.target.files?.[0])}
              />
              ，≤2MB）
            </span>
            <textarea
              aria-label="HTML / SVG 内容"
              value={html}
              onChange={(e) => setHtml(e.target.value)}
              rows={7}
              spellCheck={false}
              placeholder="把模型生成的完整 HTML 或 SVG 粘到这里"
            />
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setShowPreview((v) => !v)}
          >
            {showPreview ? "收起预览" : "预览效果"}
          </button>
          {showPreview && (
            <Preview
              html={html || null}
              title="上传预览"
              className="preview-md"
            />
          )}
          <div className="field-row">
            <div className="field" role="group" aria-label="上传模型分类">
              <span>模型</span>
              <div className="seg">
                <button
                  className={isGpt ? "on" : ""}
                  onClick={() => setIsGpt(true)}
                >
                  gpt6astra
                </button>
                <button
                  className={!isGpt ? "on" : ""}
                  onClick={() => setIsGpt(false)}
                >
                  其他模型
                </button>
              </div>
            </div>
            {!isGpt && (
              <label className="field grow">
                <span>实际模型名 *</span>
                <input
                  value={modelName}
                  onChange={(e) => setModelName(e.target.value)}
                  maxLength={60}
                  placeholder="如 claude-opus-4.6"
                />
              </label>
            )}
          </div>
          <div className="field" role="group" aria-label="说说你的判断">
            <span>说说你的判断 *</span>
            <div className="seg">
              {[["dumbed", "已降智"], ["normal", "正常未降智"], ["unknown", "无法判断"]].map(([value, label]) => (
                <button key={value} className={verdict === value ? "on" : ""} aria-pressed={verdict === value} onClick={() => setVerdict(value)}>{label}</button>
              ))}
            </div>
          </div>
          <label className="field">
            <span>完整聊天记录 *（≤8MB）</span>
            <textarea aria-label="完整聊天记录" rows={8} value={chatLog} readOnly={Boolean(initial?.chat_log)} onChange={e => setChatLog(e.target.value)} placeholder="粘贴完整的提示词和模型回复" />
          </label>
          <p className="muted small">提交后，作品、你的判断和完整聊天记录将交由管理员审核，审核通过后公开展示，用于对比和改进检测准确率。</p>
          <label className="field">
            <span>署名（匿名，随便改）</span>
            <input
              value={nickname}
              onChange={(e) => setNick(e.target.value)}
              maxLength={30}
            />
          </label>
          {error && (
            <div className="form-error" role="alert">
              <ErrorText message={error} />
            </div>
          )}
          <div className="modal-actions">
            <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
              取消
            </button>
            <button
              className="btn btn-primary"
              onClick={submit}
              disabled={busy}
            >
              {busy ? "上传中…" : "提交审核"}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}

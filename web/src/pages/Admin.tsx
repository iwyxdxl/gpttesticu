import { RequestError } from "../lib/errors";
import { ChatLog } from "../components/ChatLog";
import { ErrorText } from "../components/ErrorText";
import { Modal } from "../components/Modal";
import { useCallback, useEffect, useState } from "react";
import { Preview } from "../components/Preview";
import { adminFetch, adminLogin, type WorkItem } from "../lib/api";

type Tab = "overview" | "moderate" | "keywords" | "params" | "reference";

interface AdminConfig {
  keywords_dumbed: string;
  keywords_normal: string;
  sample_paragraphs: string;
  sample_max_chars: string;
  user_prompt: string;
  codex_system_prompt: string;
  reference_html: string;
}

function TagEditor({
  words,
  onChange,
  color,
}: {
  words: string[];
  onChange: (w: string[]) => void;
  color: "dumbed" | "normal";
}) {
  const [input, setInput] = useState("");
  const add = () => {
    const w = input.trim();
    if (w && !words.includes(w)) onChange([...words, w]);
    setInput("");
  };
  return (
    <div className={`tag-editor tag-${color}`}>
      <div className="tag-list">
        {words.map((w) => (
          <span key={w} className="chip">
            {w}
            <button
              className="tag-x"
              onClick={() => onChange(words.filter((x) => x !== w))}
            >
              ✕
            </button>
          </span>
        ))}
        {words.length === 0 && (
          <span className="muted small">
            词表空了，判定会全部变成「无法判断」
          </span>
        )}
      </div>
      <div className="model-row">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="输入关键词后回车"
        />
        <button className="btn btn-ghost btn-sm" onClick={add}>
          添加
        </button>
      </div>
    </div>
  );
}

export default function Admin() {
  const [token, setToken] = useState(false);
  const [checking, setChecking] = useState(true);
  const [loginBusy, setLoginBusy] = useState(false);
  const [adminError, setAdminError] = useState("");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [tab, setTab] = useState<Tab>("overview");

  useEffect(() => {
    // Remove credentials left by the previous bearer-token implementation.
    sessionStorage.removeItem("gpttest_admin_token");
    const expired = (event: Event) => {
      setToken(false);
      setAdminError("");
      setLoginError((event as CustomEvent<string>).detail || "登录已过期");
    };
    window.addEventListener("admin-session-expired", expired);
    adminFetch("/api/admin/session")
      .then(() => setToken(true))
      .catch((e) => {
        if (!(e instanceof RequestError && e.status === 401))
          setLoginError(e.message);
      })
      .finally(() => setChecking(false));
    return () => window.removeEventListener("admin-session-expired", expired);
  }, []);

  // 概览
  const [overview, setOverview] = useState<any>(null);
  // 审核
  const [modStatus, setModStatus] = useState("pending");
  const [modPage, setModPage] = useState(1);
  const [modData, setModData] = useState<{
    items: WorkItem[];
    pages: number;
  } | null>(null);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [editing, setEditing] = useState<WorkItem | null>(null);
  // 配置
  const [cfg, setCfg] = useState<AdminConfig | null>(null);
  const [dumbedWords, setDumbedWords] = useState<string[]>([]);
  const [normalWords, setNormalWords] = useState<string[]>([]);
  const [saveMsg, setSaveMsg] = useState("");

  const loadOverview = useCallback(() => {
    adminFetch("/api/admin/overview")
      .then(setOverview)
      .catch((e) => setAdminError(e.message));
  }, []);

  const loadModerate = useCallback(() => {
    adminFetch<{ items: WorkItem[]; pages: number }>(
      `/api/admin/works?status=${modStatus}&page=${modPage}`,
    )
      .then(setModData)
      .catch((e) => setAdminError(e.message));
  }, [modStatus, modPage]);

  const loadConfig = useCallback(() => {
    adminFetch<AdminConfig>("/api/admin/config")
      .then((c) => {
        setCfg(c);
        setDumbedWords(JSON.parse(c.keywords_dumbed));
        setNormalWords(JSON.parse(c.keywords_normal));
      })
      .catch((e) => setAdminError(e.message));
  }, []);

  useEffect(() => {
    if (!token) return;
    loadOverview();
    loadConfig();
  }, [token, loadOverview, loadConfig]);

  useEffect(() => {
    if (!token) return;
    loadModerate();
  }, [token, loadModerate]);

  const login = async () => {
    if (loginBusy) return;
    setLoginBusy(true);
    setLoginError("");
    setAdminError("");
    try {
      await adminLogin(password);
      setPassword("");
      setToken(true);
    } catch (e: any) {
      setLoginError(e?.message || "登录失败");
    } finally {
      setLoginBusy(false);
    }
  };

  if (checking) return <div className="loading-card">正在检查登录状态…</div>;

  if (!token) {
    return (
      <section className="card admin-login">
        <div className="card-title">🛠 管理员登录</div>
        <label className="field">
          <span>管理员密码</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && login()}
          />
        </label>
        {loginError && (
          <div className="form-error" role="alert">
            <ErrorText message={loginError} />
          </div>
        )}
        <button
          className="btn btn-primary"
          onClick={login}
          disabled={loginBusy || !password}
        >
          {loginBusy ? "登录中…" : "登录"}
        </button>
      </section>
    );
  }

  const moderate = async (id: number, action: string) => {
    await adminFetch(`/api/admin/works/${id}/moderate`, {
      method: "POST",
      body: JSON.stringify({ action }),
    }).catch((e) => setAdminError(e.message));
    loadModerate();
    loadOverview();
  };

  const saveConfig = async (patch: Record<string, unknown>) => {
    setAdminError("");
    setSaveMsg("保存中…");
    try {
      await adminFetch("/api/admin/config", {
        method: "PUT",
        body: JSON.stringify(patch),
      });
      setSaveMsg("已保存 ✓");
      loadConfig();
    } catch (e: any) {
      setSaveMsg("");
      setAdminError(e?.message || "保存失败");
    }
    setTimeout(() => setSaveMsg(""), 2500);
  };

  const saveReference = async (html: string) => {
    setAdminError("");
    setSaveMsg("保存中…");
    try {
      await adminFetch("/api/admin/reference", {
        method: "PUT",
        body: JSON.stringify({ html }),
      });
      setSaveMsg("参考样本已更新 ✓");
    } catch (e: any) {
      setSaveMsg("");
      setAdminError(e?.message || "保存失败");
    }
    setTimeout(() => setSaveMsg(""), 2500);
  };

  const logout = async () => {
    try {
      await adminFetch("/api/admin/logout", { method: "POST" });
      setToken(false);
    } catch (e: any) {
      setAdminError(e.message);
    }
  };

  return (
    <>
      <section className="page-head">
        <h1 className="page-title">管理后台 🛠</h1>
        <div className="cta-row">
          {saveMsg && <span className="save-msg">{saveMsg}</span>}
          <button className="btn btn-ghost btn-sm" onClick={logout}>
            退出登录
          </button>
        </div>
      </section>

      {adminError && (
        <div className="card error-card" role="alert">
          <ErrorText message={adminError} />
        </div>
      )}
      <div className="board-bar admin-tabs">
        <div className="seg">
          {(
            [
              ["overview", "📊 概览"],
              ["moderate", "🔍 审核"],
              ["keywords", "🔤 关键词"],
              ["params", "⌨️ 参数与提示词"],
              ["reference", "🖼 参考样本"],
            ] as [Tab, string][]
          ).map(([t, label]) => (
            <button
              key={t}
              className={tab === t ? "on" : ""}
              onClick={() => setTab(t)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "overview" && overview && (
        <div className="stat-grid">
          <div className="card stat-card">
            <span className="stat-num">{overview.total_users ?? 0}</span>
            <span className="stat-name">累计访问用户</span>
          </div>
          <div className="card stat-card">
            <span className="stat-num">{overview.today_users ?? 0}</span>
            <span className="stat-name">今日访问用户</span>
          </div>
          <p className="muted small wide">按浏览器匿名标识去重，访问前台即计入；仅访问后台不计入。今日按北京时间计算。统计从功能上线起开始，不含历史访问；更换浏览器或清除本地数据会视为新用户。</p>
          <div className="card stat-card">
            <span className="stat-num">{overview.total_tests}</span>
            <span className="stat-name">总检测次数</span>
          </div>
          <div className="card stat-card">
            <span className="stat-num">{overview.today_tests}</span>
            <span className="stat-name">今日检测</span>
          </div>
          <div className="card stat-card v-dumbed">
            <span className="stat-num">{overview.verdicts?.dumbed ?? 0}</span>
            <span className="stat-name">疑似降智</span>
          </div>
          <div className="card stat-card v-normal">
            <span className="stat-num">{overview.verdicts?.normal ?? 0}</span>
            <span className="stat-name">疑似正常</span>
          </div>
          <div className="card stat-card v-unknown">
            <span className="stat-num">{overview.verdicts?.unknown ?? 0}</span>
            <span className="stat-name">无法判断</span>
          </div>
          <div className="card stat-card">
            <span className="stat-num">{overview.works?.pending ?? 0}</span>
            <span className="stat-name">待审作品</span>
          </div>
          <div className="card stat-card">
            <span className="stat-num">{overview.works?.approved ?? 0}</span>
            <span className="stat-name">已过审</span>
          </div>
          <div className="card stat-card">
            <span className="stat-num">{overview.likes_total ?? 0}</span>
            <span className="stat-name">总点赞数</span>
          </div>
          <div className="card stat-card wide">
            <span className="stat-name">完整测试 · 用户判断</span>
            <p>{[ ["dumbed", "已降智"], ["normal", "正常未降智"], ["unknown", "无法判断"] ].map(([value, label]) => `${label}：${overview.human_verdicts?.find((r: any) => r.verdict === value)?.n ?? 0}`).join(" · ")}</p>
            <details><summary>与快速检测结论对比</summary>
              {overview.feedback_comparison?.map((r: any) => <p key={`${r.auto_verdict}-${r.verdict}`}>自动：{r.auto_verdict} → 人工：{r.verdict}（{r.n} 次）</p>)}
            </details>
          </div>
          {overview.top_works?.length > 0 && (
            <div className="card stat-card wide">
              <span className="stat-name">搞笑值 Top5</span>
              <ol className="top-list">
                {overview.top_works.map((w: any) => (
                  <li key={w.id}>
                    🤣{w.funny_value} · {w.title}（{w.model_name}）
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      )}

      {tab === "moderate" && (
        <div className="card">
          <div className="board-bar">
            <div className="seg">
              {[
                ["pending", "待审"],
                ["approved", "已通过"],
                ["rejected", "已拒绝"],
                ["offline", "已下架"],
              ].map(([s, label]) => (
                <button
                  key={s}
                  className={modStatus === s ? "on" : ""}
                  onClick={() => {
                    setModStatus(s);
                    setModPage(1);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {modData?.items.length === 0 && (
            <p className="muted">这个状态下没有作品。</p>
          )}
          <div className="mod-list">
            {modData?.items.map((w) => (
              <div className="mod-item" key={w.id}>
                <div className="mod-info">
                  <strong>
                    #{w.id} {w.title}
                  </strong>
                  <span
                    className={`model-badge ${w.is_gpt6astra ? "mb-gpt" : "mb-other"}`}
                  >
                    {w.is_gpt6astra ? "gpt6astra" : w.model_name}
                  </span>
                  {w.verdict && (
                    <span className={`verdict-badge vb-${w.verdict}`}>
                      {w.verdict}
                    </span>
                  )}
                  <span className="muted small">
                    by {w.nickname} ·{" "}
                    {new Date(w.created_at).toLocaleString("zh-CN")}
                  </span>
                  <ChatLog text={w.chat_log} autoVerdict={w.auto_verdict} />
                  <div className="cta-row">
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() =>
                        setPreviewHtml(previewHtml === w.html ? null : w.html)
                      }
                    >
                      {previewHtml === w.html ? "收起预览" : "预览"}
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => setEditing(w)}
                    >
                      编辑
                    </button>
                    {modStatus === "pending" && (
                      <>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => moderate(w.id, "approve")}
                        >
                          通过
                        </button>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={() => moderate(w.id, "reject")}
                        >
                          拒绝（静默）
                        </button>
                      </>
                    )}
                    {modStatus === "approved" && (
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => moderate(w.id, "offline")}
                      >
                        下架
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {modData && modData.pages > 1 && (
            <div className="pager">
              <button
                className="btn btn-ghost"
                disabled={modPage <= 1}
                onClick={() => setModPage((p) => p - 1)}
              >
                ←
              </button>
              <span>
                {modPage} / {modData.pages}
              </span>
              <button
                className="btn btn-ghost"
                disabled={modPage >= modData.pages}
                onClick={() => setModPage((p) => p + 1)}
              >
                →
              </button>
            </div>
          )}
          {previewHtml && (
            <Preview
              html={previewHtml}
              title="审核预览"
              className="preview-md"
            />
          )}
          {editing && (
            <EditWorkModal
              work={editing}
              onClose={() => setEditing(null)}
              onSaved={() => {
                setEditing(null);
                loadModerate();
              }}
            />
          )}
        </div>
      )}

      {tab === "keywords" && cfg && (
        <div className="card">
          <div className="card-title">降智特征词（命中越多越像降智）</div>
          <TagEditor
            words={dumbedWords}
            onChange={setDumbedWords}
            color="dumbed"
          />
          <div className="card-title">正常特征词</div>
          <TagEditor
            words={normalWords}
            onChange={setNormalWords}
            color="normal"
          />
          <button
            className="btn btn-primary"
            onClick={() =>
              saveConfig({
                keywords_dumbed: dumbedWords,
                keywords_normal: normalWords,
              })
            }
          >
            保存词表
          </button>
        </div>
      )}

      {tab === "params" && cfg && (
        <div className="card">
          <div className="field-row">
            <label className="field">
              <span>采样段数 N（前 N 个自然段）</span>
              <input
                type="number"
                min={1}
                max={10}
                value={cfg.sample_paragraphs}
                onChange={(e) =>
                  setCfg({ ...cfg, sample_paragraphs: e.target.value })
                }
              />
            </label>
            <label className="field">
              <span>字符截断上限</span>
              <input
                type="number"
                min={500}
                max={20000}
                step={100}
                value={cfg.sample_max_chars}
                onChange={(e) =>
                  setCfg({ ...cfg, sample_max_chars: e.target.value })
                }
              />
            </label>
          </div>
          <label className="field">
            <span>鹈鹕用户提示词</span>
            <textarea
              rows={2}
              value={cfg.user_prompt}
              onChange={(e) => setCfg({ ...cfg, user_prompt: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Codex 提示词固定快照（修改会影响检测口径）</span>
            <textarea
              className="mono"
              rows={14}
              value={cfg.codex_system_prompt}
              onChange={(e) =>
                setCfg({ ...cfg, codex_system_prompt: e.target.value })
              }
            />
          </label>
          <button
            className="btn btn-primary"
            onClick={() =>
              saveConfig({
                sample_paragraphs: Number(cfg.sample_paragraphs),
                sample_max_chars: Number(cfg.sample_max_chars),
                user_prompt: cfg.user_prompt,
                codex_system_prompt: cfg.codex_system_prompt,
              })
            }
          >
            保存参数与提示词
          </button>
        </div>
      )}

      {tab === "reference" && cfg && (
        <ReferenceTab cfg={cfg} onSave={saveReference} />
      )}
    </>
  );
}

function ReferenceTab({
  cfg,
  onSave,
}: {
  cfg: AdminConfig;
  onSave: (html: string) => void;
}) {
  const [html, setHtml] = useState(cfg.reference_html);
  const [showPreview, setShowPreview] = useState(false);
  return (
    <div className="card">
      <p className="muted small">
        完整测试右侧并排展示的「正常版参考样本」。只支持 CSS / SMIL
        动画，脚本与外链会被移除，≤2MB。
      </p>
      <textarea
        className="mono"
        rows={14}
        value={html}
        onChange={(e) => setHtml(e.target.value)}
        spellCheck={false}
      />
      <div className="cta-row">
        <button
          className="btn btn-ghost"
          onClick={() => setShowPreview((v) => !v)}
        >
          {showPreview ? "收起预览" : "预览"}
        </button>
        <button className="btn btn-primary" onClick={() => onSave(html)}>
          保存参考样本
        </button>
      </div>
      {showPreview && (
        <Preview html={html} title="参考样本预览" className="preview-md" />
      )}
    </div>
  );
}

function EditWorkModal({
  work,
  onClose,
  onSaved,
}: {
  work: WorkItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [isGpt, setIsGpt] = useState(work.is_gpt6astra === 1);
  const [modelName, setModelName] = useState(work.model_name);
  const [verdict, setVerdict] = useState(work.verdict ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    if (!isGpt && !modelName.trim())
      return setError("非 gpt6astra 请填写实际模型名");
    if (!verdict) return setError("请选择判断结果");
    setBusy(true);
    try {
      await adminFetch(`/api/admin/works/${work.id}`, {
        method: "PUT",
        body: JSON.stringify({
          is_gpt6astra: isGpt,
          // gpt6astra 时沿用服务端保留/重置逻辑，避免旧模型名卡住正则校验
          ...(isGpt ? {} : { model_name: modelName.trim() }),
          verdict,
        }),
      });
      onSaved();
    } catch (e: any) {
      setError(e?.message || "保存失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      label="编辑作品信息"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="modal-head">
        <h3>
          编辑 #{work.id} {work.title}
        </h3>
        <button
          className="icon-btn"
          aria-label="关闭编辑"
          disabled={busy}
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <div className="modal-body">
        <div className="field-row">
          <div className="field" role="group" aria-label="模型分类">
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
                onClick={() => {
                  setIsGpt(false);
                  if (
                    /^gpt[-_ ]?6[-_ ]?astra(?:$|[-_. ])/i.test(modelName.trim())
                  )
                    setModelName("");
                }}
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
        <div className="field" role="group" aria-label="判断结果">
          <span>判断结果</span>
          <div className="seg">
            {[["dumbed", "已降智"], ["normal", "正常未降智"], ["unknown", "无法判断"]].map(([value, label]) => (
              <button key={value} className={verdict === value ? "on" : ""} aria-pressed={verdict === value} onClick={() => setVerdict(value)}>{label}</button>
            ))}
          </div>
        </div>
        {error && (
          <div className="form-error" role="alert">
            <ErrorText message={error} />
          </div>
        )}
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>
            取消
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? "保存中…" : "保存修改"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

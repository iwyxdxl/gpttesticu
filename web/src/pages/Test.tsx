import { ErrorText } from "../components/ErrorText";
import bundledReference from "../../../server/src/assets/pelican-bike_gpt6astra_low.html?raw";
import { Modal } from "../components/Modal";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Preview } from "../components/Preview";
import { RawText } from "../components/RawText";
import { VerdictCard } from "../components/Verdict";
import { UploadModal } from "../components/UploadModal";
import SiteHero, { STATS_REFRESH_EVENT } from "../components/SiteHero";
import {
  fetchConfig,
  fetchReference,
  reportTest,
  reportFeedback,
  type SiteConfig,
} from "../lib/api";
import {
  judge,
  shouldStopSampling,
  splitParagraphs,
  takeSample,
  type JudgeResult,
} from "../lib/judge";
import { extractHtml } from "../lib/render";
import { createCodexSession, type CodexSession } from "../lib/codex";
import {
  ConnectError,
  fetchModels,
  normalizeBaseUrl,
  streamResponses,
} from "../lib/stream";

const FALLBACK_CONFIG: SiteConfig = {
  keywords_dumbed: [
    "内嵌SVG",
    "内联SVG",
    "连续的骑行动画",
    "循环的骑行动画",
    "循环骑行",
    "循环运动",
  ],
  keywords_normal: ["踩踏", "踩动脚踏", "沿途风景", "背景移动"],
  sample_paragraphs: 3,
  sample_max_chars: 2000,
  user_prompt: "创建一个 HTML，内容是 SVG 绘制一个鹈鹕骑自行车的 2D 动画",
  codex_system_prompt:
    "You are Codex, a coding agent running in the user's terminal. Write complete, runnable code in a single pass with no placeholders. For web artifacts, produce one self-contained file: inline CSS and inline SVG, no external dependencies.",
};

type Phase = "idle" | "quick" | "quick-done" | "full" | "full-done";

interface QuickOutcome {
  sample: string;
  stoppedBy: "paragraphs" | "chars" | "end";
  result: JudgeResult;
}

export default function Test() {
  const [configReady, setConfigReady] = useState(false);
  const [flowClosed, setFlowClosed] = useState(false);
  const [config, setConfig] = useState<SiteConfig>(FALLBACK_CONFIG);
  const [referenceHtml, setReferenceHtml] = useState<string | null>(
    bundledReference,
  );

  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [baseFixed, setBaseFixed] = useState(false);

  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [manualModel, setManualModel] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsHint, setModelsHint] = useState("");

  const [phase, setPhase] = useState<Phase>("idle");
  const [liveText, setLiveText] = useState("");
  const [quick, setQuick] = useState<QuickOutcome | null>(null);
  const [fullHtml, setFullHtml] = useState<string | null>(null);
  const [error, setError] = useState<{ kind: string; message: string } | null>(
    null,
  );
  const [confirmKind, setConfirmKind] = useState<null | "quick" | "full">(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [humanVerdict, setHumanVerdict] = useState("");
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [feedbackError, setFeedbackError] = useState("");
  const feedbackIdRef = useRef("");
  const chatRef = useRef<{ stage: string; model: string; instructions: string; prompt: string; response: string; status: string }[]>([]);

  const saveFeedback = async (verdict: string) => {
    if (feedbackBusy || !quick) return;
    setFeedbackBusy(true);
    setFeedbackError("");
    try {
      await reportFeedback({ test_id: feedbackIdRef.current, verdict, auto_verdict: quick.result.verdict, model_name: model });
      setHumanVerdict(verdict);
    } catch (e: any) { setFeedbackError(e.message || "保存失败，请重试"); }
    finally { setFeedbackBusy(false); }
  };

  const abortRef = useRef<AbortController | null>(null);
  const codexSessionRef = useRef<CodexSession | null>(null);
  const fullTextRef = useRef("");
  const sampledRef = useRef(false);
  const timedOutRef = useRef(false);
  const reportedRef = useRef(false);
  const pendingReportRef = useRef<{ verdict: string; ranFull: boolean } | null>(
    null,
  );
  const modelsAbortRef = useRef<AbortController | null>(null);
  const lastExtractRef = useRef(0);

  const running = phase === "quick" || phase === "full";

  useEffect(() => {
    fetchConfig()
      .then((c) => {
        setConfig(c);
        setConfigReady(true);
      })
      .catch((e) =>
        setError({
          kind: "config",
          message: `检测配置加载失败，请刷新页面后重试。\n${e.message}`,
        }),
      );
    fetchReference()
      .then((r) => setReferenceHtml(r.html))
      .catch((e) =>
        setError({
          kind: "reference",
          message: `参考样本加载失败\n${e.message}`,
        }),
      );
  }, []);

  useEffect(() => {
    const finishPending = () => {
      const event = pendingReportRef.current;
      if (event && !reportedRef.current) {
        reportedRef.current = true;
        // The page is already leaving; if this is a route switch, the next
        // page's SiteHero may still be mounted to receive the refresh event.
        void reportTest(event.verdict, event.ranFull)
          .then(() => window.dispatchEvent(new Event(STATS_REFRESH_EVENT)))
          .catch(() => {});
      }
    };
    window.addEventListener("pagehide", finishPending);
    return () => {
      window.removeEventListener("pagehide", finishPending);
      abortRef.current?.abort();
      modelsAbortRef.current?.abort();
      finishPending();
    };
  }, []);

  const reportOnce = useCallback((verdict: string, ranFull: boolean) => {
    if (reportedRef.current) return;
    reportedRef.current = true;
    reportTest(verdict, ranFull)
      .then(() => window.dispatchEvent(new Event(STATS_REFRESH_EVENT)))
      .catch((e) =>
        setError({ kind: "stats", message: `统计上报失败\n${e.message}` }),
      );
  }, []);

  // ---------- 模型列表 ----------

  const loadModels = async () => {
    if (!baseUrl.trim() || !apiKey.trim()) {
      setModelsHint("先把端点地址和 API Key 填上");
      return;
    }
    setModelsLoading(true);
    setModelsHint("");
    const ac = new AbortController();
    modelsAbortRef.current = ac;
    const t = setTimeout(() => ac.abort(), 15000);
    try {
      const { base, fixed } = normalizeBaseUrl(baseUrl);
      setBaseFixed(fixed);
      setBaseUrl(base);
      const ids = await fetchModels(base, apiKey, ac.signal);

      if (ids.length === 0) {
        setModelsHint("端点返回了空模型列表，建议手动输入模型名");
        setManualModel(true);
      } else {
        setModels(ids);
        setManualModel(false);
        const guess = ids.find((m) => /astra/i.test(m)) ?? ids[0];
        setModel(guess);
        setModelsHint("");
      }
    } catch (e: any) {
      if (e instanceof ConnectError && e.kind === "cors") {
        setModelsHint(
          `${e.message}\n\n请使用支持 CORS 的中转站；也可以手动输入模型名。`,
        );
      } else {
        setModelsHint(`${e?.message || "拉取失败"}；也可以手动输入模型名`);
      }
      setManualModel(true);
    } finally {
      clearTimeout(t);
      modelsAbortRef.current = null;
      setModelsLoading(false);
    }
  };

  // ---------- 快速测试 ----------

  const finishQuick = useCallback(() => {
    const text = fullTextRef.current;
    const { sample, stoppedBy } = takeSample(
      text,
      config.sample_paragraphs,
      config.sample_max_chars,
    );
    const result = judge(
      sample,
      config.keywords_dumbed,
      config.keywords_normal,
    );
    pendingReportRef.current = { verdict: result.verdict, ranFull: false };
    setQuick({ sample, stoppedBy, result });
    setPhase("quick-done");
    // Every verdict can continue to a full test; report only when the flow ends.
  }, [config]);

  const runQuick = async () => {
    if (running) return;
    setFlowClosed(false);
    setHumanVerdict("");
    setFeedbackError("");
    feedbackIdRef.current = createCodexSession().sessionId;
    chatRef.current = [];
    setConfirmKind(null);
    setError(null);
    setQuick(null);
    setFullHtml(null);
    setLiveText("");
    fullTextRef.current = "";
    sampledRef.current = false;
    timedOutRef.current = false;
    reportedRef.current = false;
    pendingReportRef.current = null;
    setPhase("quick");
    const ac = new AbortController();
    abortRef.current = ac;
    const timer = setTimeout(() => {
      timedOutRef.current = true;
      ac.abort();
    }, 180_000);
    try {
      const { base } = normalizeBaseUrl(baseUrl);
      codexSessionRef.current = createCodexSession();
      const record = { stage: "快速测试", model, instructions: config.codex_system_prompt, prompt: config.user_prompt, response: "", status: "未完成或已中断" };
      chatRef.current.push(record);
      await streamResponses({
        base,
        session: codexSessionRef.current,
        apiKey,
        model,
        instructions: config.codex_system_prompt,
        input: config.user_prompt,
        signal: ac.signal,
        onDelta: (_d, full) => {
          record.response = full;
          fullTextRef.current = full;
          setLiveText(full);
          if (
            !sampledRef.current &&
            shouldStopSampling(
              full,
              config.sample_paragraphs,
              config.sample_max_chars,
            )
          ) {
            sampledRef.current = true;
            ac.abort(); // 采满即断流，省额度
          }
        },
      });
      record.status = "已完成";
      finishQuick();
    } catch (e: any) {
      if (e instanceof ConnectError && e.kind === "aborted") {
        if (sampledRef.current) finishQuick();
        else {
          setError({
            kind: "aborted",
            message: timedOutRef.current
              ? "快速测试超时，未采满样本，请重试。"
              : "已停止快速测试，本次未形成判定。",
          });
          setPhase("idle");
        } // 用户手动停止且采样未满 → 回到就绪
      } else {
        setError({
          kind: e instanceof ConnectError ? e.kind : "unknown",
          message: e?.message || String(e),
        });
        setPhase("idle");
      }
    } finally {
      clearTimeout(timer);
      abortRef.current = null;
    }
  };

  // ---------- 完整测试 ----------

  const finishFull = useCallback(() => {
    const html = extractHtml(fullTextRef.current);
    if (!html) {
      setError({
        kind: "output",
        message: "生成已结束，但未找到 HTML / SVG。请核对原文后重试。",
      });
      setPhase("quick-done");
      return;
    }
    setFullHtml(html);
    setPhase("full-done");
    if (quick) reportOnce(quick.result.verdict, true);
  }, [quick, reportOnce]);

  const runFull = async () => {
    if (running || !quick || flowClosed) return;
    pendingReportRef.current = { verdict: quick.result.verdict, ranFull: true };
    setConfirmKind(null);
    setError(null);
    setFullHtml(null);
    setLiveText("");
    fullTextRef.current = "";
    timedOutRef.current = false;
    lastExtractRef.current = 0;
    setPhase("full");
    if (referenceHtml === null) {
      fetchReference()
        .then((r) => setReferenceHtml(r.html))
        .catch((e) =>
          setError({
            kind: "reference",
            message: `参考样本加载失败\n${e.message}`,
          }),
        );
    }
    const ac = new AbortController();
    abortRef.current = ac;
    const timer = setTimeout(() => {
      timedOutRef.current = true;
      ac.abort();
    }, 300_000);
    try {
      const { base } = normalizeBaseUrl(baseUrl);
      codexSessionRef.current ??= createCodexSession();
      const record = { stage: "完整测试", model, instructions: config.codex_system_prompt, prompt: config.user_prompt, response: "", status: "未完成或已中断" };
      chatRef.current.push(record);
      await streamResponses({
        base,
        session: codexSessionRef.current,
        apiKey,
        model,
        instructions: config.codex_system_prompt,
        input: config.user_prompt,
        signal: ac.signal,
        onDelta: (_d, full) => {
          record.response = full;
          fullTextRef.current = full;
          setLiveText(full);
          const now = performance.now();
          if (now - lastExtractRef.current > 400) {
            lastExtractRef.current = now;
            const html = extractHtml(full);
            if (html) setFullHtml(html);
          }
        },
      });
      record.status = "已完成";
      finishFull();
    } catch (e: any) {
      if (e instanceof ConnectError && e.kind === "aborted") {
        setError({
          kind: "aborted",
          message: timedOutRef.current
            ? "完整测试超时，内容未生成完毕。"
            : "已停止完整测试，内容未生成完毕。",
        });
        setPhase("quick-done");
      } else {
        setError({
          kind: e instanceof ConnectError ? e.kind : "unknown",
          message: e?.message || String(e),
        });
        setPhase("quick-done");
      }
    } finally {
      clearTimeout(timer);
      abortRef.current = null;
      if (quick) reportOnce(quick.result.verdict, true);
    }
  };

  const stop = () => abortRef.current?.abort();

  const reset = () => {
    codexSessionRef.current = null;
    if (pendingReportRef.current)
      reportOnce(
        pendingReportRef.current.verdict,
        pendingReportRef.current.ranFull,
      );
    setFlowClosed(false);
    setPhase("idle");
    setQuick(null);
    setFullHtml(null);
    setLiveText("");
    setError(null);
    fullTextRef.current = "";
  };

  const startQuick = async () => {
    if (!baseUrl.trim() || !apiKey.trim() || !model.trim()) {
      setError({ kind: "form", message: "端点、Key、模型都填好再开测" });
      return;
    }
    try {
      const { base, fixed } = normalizeBaseUrl(baseUrl);
      setBaseUrl(base);
      setBaseFixed(fixed);
    } catch (e: any) {
      setError({ kind: "form", message: e.message });
      return;
    }
    try {
      const latest = await fetchConfig();
      setConfig(latest);
      setConfirmKind("quick");
    } catch (e: any) {
      setError({
        kind: "config",
        message: `无法获取最新检测配置，请稍后重试。\n${e.message}`,
      });
    }
  };

  const onFullTest = () => setConfirmKind("full");

  const liveParas = Math.min(
    splitParagraphs(liveText).length,
    config.sample_paragraphs,
  );
  const ready =
    configReady && Boolean(baseUrl.trim() && apiKey.trim() && model.trim());
  const uploadInitial = useMemo(
    () => ({
      html: fullHtml ?? undefined,
      model_name: model,
      is_gpt6astra: /^gpt[-_ ]?6[-_ ]?astra(?:$|[-_. ])/i.test(model),
      auto_verdict: quick?.result.verdict ?? null,
      chat_log: JSON.stringify(chatRef.current, null, 2),
    }),
    [fullHtml, model, quick, phase],
  );

  return (
    <>
      <SiteHero tab="test" />

      <div className="section-heading">
        <div>
          <span className="eyebrow">01 / START AN EXPERIMENT</span>
          <h2>一只鹈鹕，测一测模型的状态。</h2>
        </div>
        <span className="local-indicator">浏览器本地检测</span>
      </div>
      <section className="grid-2">
        <div className="card setup-card">
          <div className="card-title">
            <span className="step-dot">1</span> 接上你的中转站
          </div>
          <p className="muted small">
            请使用支持 CORS 的中转站，仅支持 Responses API。
          </p>
          <p className="privacy-note" role="note">
            🔒 <strong>端点 URL 与 API Key 只保留在本页内存中，刷新或关闭页面即消失。</strong>
            所有测试请求均由你的浏览器在本地直接发起，不经过本站服务器，绝不上传。
          </p>
          <label className="field">
            <span>服务端点（OpenAI Responses 格式，/v1 结尾）</span>
            <input
              value={baseUrl}
              onChange={(e) => {
                setBaseUrl(e.target.value);
                setBaseFixed(false);
              }}
              placeholder="https://your-relay.example.com/v1"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              disabled={phase !== "idle" || modelsLoading}
            />
            {baseFixed && (
              <em className="field-hint">已自动规范化为 /v1 结尾</em>
            )}
          </label>
          <label className="field">
            <span>API Key（推荐创建临时测试用api key）</span>
            <div className="key-row">
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                spellCheck={false}
                autoComplete="off"
                disabled={phase !== "idle" || modelsLoading}
              />
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setShowKey((v) => !v)}
              >
                {showKey ? "隐藏" : "显示"}
              </button>
            </div>
          </label>
          <div className="card-title">
            <span className="step-dot">2</span> 选模型
          </div>
          <div className="model-row">
            {!manualModel && models.length > 0 ? (
              <select
                aria-label="测试模型"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={phase !== "idle" || modelsLoading}
              >
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="手动输入模型名，如 gpt-6astra"
                aria-label="测试模型"
                spellCheck={false}
                disabled={phase !== "idle" || modelsLoading}
              />
            )}
            <button
              className="btn btn-ghost"
              onClick={loadModels}
              disabled={modelsLoading || phase !== "idle"}
            >
              {modelsLoading ? "拉取中…" : "拉取模型"}
            </button>
            {models.length > 0 && !manualModel && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setManualModel(true)}
                disabled={phase !== "idle" || modelsLoading}
              >
                手动输入
              </button>
            )}
          </div>
          {modelsHint && (
            <div className="field-hint-warn">
              <ErrorText message={modelsHint} />
            </div>
          )}
          <div className="card-title">
            <span className="step-dot">3</span> 开测
          </div>
          <p className="quota-note">
            测试会真实调用你的端点并消耗 token（Codex
            提示词较长，属正常现象）。快速测试只采前 {config.sample_paragraphs}{" "}
            段文本，采满自动断流省钱。
          </p>
          <div className="cta-row">
            <button
              className="btn btn-primary btn-big"
              onClick={startQuick}
              disabled={phase !== "idle" || !ready || modelsLoading}
            >
              🚴 开始快速测试
            </button>
            {(phase === "quick-done" || phase === "full-done") && (
              <button className="btn btn-ghost" onClick={reset}>
                再测一次
              </button>
            )}
          </div>
        </div>

        <div className="card hero-preview-card">
          <div className="reference-heading">
            <span className="eyebrow">REFERENCE / 001</span>
            <span className="reference-tag">gpt6astra · low</span>
          </div>
          <div className="card-title">海风正好，慢慢骑。</div>
          <Preview
            html={referenceHtml}
            title="正常版参考样本"
            className="preview-hero"
          />
          <p className="muted small">
            观察踩踏动作、车轮与背景的配合。参考画作仅用于视觉对比，不代表能力标准。
          </p>
        </div>
      </section>

      <section className="how-it-works">
        <div>
          <span>01</span>
          <h3>连接自己的端点</h3>
          <p>地址与 Key 只留在本页，刷新即消失。</p>
        </div>
        <div>
          <span>02</span>
          <h3>先采样，再看画</h3>
          <p>无论快速判定结果如何，都可继续完整生成。</p>
        </div>
        <div>
          <span>03</span>
          <h3>分享一点抽象</h3>
          <p>自愿上传作品，审核通过后参与搞笑榜。</p>
        </div>
      </section>

      {running && (
        <section className="card status-card" aria-live="polite">
          <div className="status-head">
            <span className={`status-spinner ${phase}`} />
            <span>
              {phase === "quick"
                ? `快速测试采样中… 已接收 ${liveText.length} 字符 · 段落 ${liveParas}/${config.sample_paragraphs}`
                : `完整测试生成中… 已接收 ${liveText.length} 字符`}
            </span>
            <button className="btn btn-ghost btn-sm" onClick={stop}>
              停止测试
            </button>
          </div>
          <pre className="live-stream">{liveText || "（等待第一个字节…）"}</pre>
        </section>
      )}

      {phase === "quick-done" && quick && (
        <section className="result-section">
          <VerdictCard
            result={quick.result}
            onFullTest={flowClosed ? undefined : onFullTest}
          />
          <div className="card">
            <div className="card-title">
              采样原文（
              {quick.stoppedBy === "paragraphs"
                ? `采满 ${config.sample_paragraphs} 段自动断流`
                : quick.stoppedBy === "chars"
                  ? `达到 ${config.sample_max_chars} 字符上限`
                  : "流已结束"}
              ）
            </div>
            <RawText
              sample={quick.sample}
              dumbedWords={config.keywords_dumbed}
              normalWords={config.keywords_normal}
            />
            <div className="decline-row">
              <button
                className="btn btn-ghost btn-sm"
                disabled={flowClosed}
                onClick={() => {
                  reportOnce(quick.result.verdict, false);
                  setFlowClosed(true);
                }}
              >
                {flowClosed ? "本次检测已结束" : "结束本次检测"}
              </button>
            </div>
          </div>
        </section>
      )}

      {(phase === "full" || phase === "full-done") && (
        <section className="card full-section">
          <div className="card-title">
            {phase === "full" ? "完整测试 · 生成中" : "完整测试 · 对比结果"}
            （左：你的模型 / 右：正常版参考）
          </div>
          <div className="compare-grid">
            <div className="compare-pane">
              <div className="pane-label you">
                {phase === "full" ? "你的模型 · 实时渲染" : "你的模型"}
                {phase === "full" && <span className="blink">●</span>}
              </div>
              <Preview html={fullHtml} title="你的模型输出" />
            </div>
            <div className="compare-pane">
              <div className="pane-label ref">正常版参考</div>
              <Preview html={referenceHtml} title="正常版参考样本" />
            </div>
          </div>
          {phase === "full-done" && (
            <div className="card" role="group" aria-label="说说你的判断">
              <div className="card-title">说说你的判断：</div>
              <div className="cta-row center">
                {[["dumbed", "已降智"], ["normal", "正常未降智"], ["unknown", "无法判断"]].map(([value, label]) => (
                  <button key={value} className={`btn ${humanVerdict === value ? "btn-primary" : "btn-ghost"}`} aria-pressed={humanVerdict === value} disabled={feedbackBusy} onClick={() => void saveFeedback(value)}>{label}</button>
                ))}
              </div>
              <p role="status">{feedbackBusy ? "正在保存…" : humanVerdict ? "你的判断已记录，可重新选择。" : "选择后记录你的判断，帮助改进检测准确率。"}</p>
              {feedbackError && <p role="alert"><ErrorText message={feedbackError} /></p>}
            </div>
          )}
          {phase === "full-done" && (
            <div className="cta-row center">
              <button
                className="btn btn-primary"
                onClick={() => setUploadOpen(true)}
              >
                🏆 把这次结果上传到搞笑排行榜
              </button>
            </div>
          )}
        </section>
      )}

      {error && (
        <section
          role="alert"
          className={`card error-card ${error.kind === "cors" ? "error-cors" : ""}`}
        >
          <div className="error-title">
            {error.kind === "cors" ? "🌉 浏览器连不上这个端点" : "⚠️ 出错了"}
          </div>
          <ErrorText message={error.message} />
          {error.kind === "cors" && (
            <ul className="error-tips">
              <li>
                中转站需要开放 CORS 才能被浏览器直连（OpenAI
                官方端点默认禁止浏览器跨域调用）
              </li>
              <li>检查地址是否正确、是否能访问；部分中转站仅支持服务端调用</li>
              <li>
                本站出于隐私红线不做服务器代理：Key
                一旦经过服务器就不叫「不上传」了
              </li>
            </ul>
          )}
          <button className="btn btn-ghost" onClick={() => setError(null)}>
            知道了
          </button>
        </section>
      )}

      {confirmKind && (
        <Modal label="测试额度确认" small onClose={() => setConfirmKind(null)}>
          <div className="modal-head">
            <h3>
              {confirmKind === "quick" ? "⚡ 消耗额度提醒" : "💰 大额消耗提醒"}
            </h3>
          </div>
          <div className="modal-body">
            {confirmKind === "quick" ? (
              <p>
                快速测试会向你的端点发起一次真实请求并消耗 token（Codex
                提示词较长，消耗会比一句话问答多一些）。 采满前{" "}
                {config.sample_paragraphs} 段文本后会自动断流，帮你省钱。
              </p>
            ) : (
              <p>
                完整测试会重新生成完整 HTML/SVG，token
                消耗显著高于快速测试。生成结束后可与参考画作并排对比，结果仅供娱乐参考。
              </p>
            )}
            <div className="modal-actions">
              <button
                className="btn btn-ghost"
                onClick={() => setConfirmKind(null)}
              >
                再想想
              </button>
              <button
                className="btn btn-primary"
                onClick={confirmKind === "quick" ? runQuick : runFull}
              >
                确认消耗，开始测试
              </button>
            </div>
          </div>
        </Modal>
      )}

      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        initial={uploadInitial}
      />
    </>
  );
}

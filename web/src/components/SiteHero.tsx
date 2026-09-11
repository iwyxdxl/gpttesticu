import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { Counter } from "./Counter";
import { fetchStats } from "../lib/api";

// 测试完成后由检测页派发，让统计行立即刷新
export const STATS_REFRESH_EVENT = "pelican:stats-refresh";

export default function SiteHero({ tab }: { tab: "board" | "test" }) {
  const [stats, setStats] = useState<{
    total_tests: number;
    today_tests: number;
  }>({ total_tests: 0, today_tests: 0 });

  useEffect(() => {
    const refresh = () => {
      fetchStats()
        .then(setStats)
        .catch(() => {
          /* 统计加载失败时显示 0，不影响页面使用 */
        });
    };
    refresh();
    window.addEventListener(STATS_REFRESH_EVENT, refresh);
    return () => window.removeEventListener(STATS_REFRESH_EVENT, refresh);
  }, []);

  return (
    <section className="hero">
      <div className="eyebrow">THE PELICAN LAB · 鹈鹕观察实验室</div>
      <div className="hero-badges">
        <span className="badge">凭据仅留本页</span>
        <span className="badge">直连你的端点</span>
        <span className="badge">Codex 提示词 · LOW</span>
      </div>
      <h1 className="hero-title">
        你的 GPT <span className="grad-text">降智</span> 了吗？
      </h1>
      <p className="hero-sub">
        让模型画一只「骑自行车的鹈鹕」——从几段文字，到一幅会动的画，看看你的模型交出了什么作业。
        <br />
        浏览器直连 · 凭据不保存 · 关键词判定仅供娱乐
      </p>
      <div className="counter-card">
        <span className="counter-label">大家已经完成</span>
        <Counter value={stats.total_tests} />
        <span className="counter-label">
          次检测 · 今日 {stats.today_tests.toLocaleString("en-US")} 次
        </span>
      </div>
      <nav className="hero-tabs" aria-label="内容切换">
        <NavLink end to="/" className={() => (tab === "board" ? "on" : "")}>
          🏆 搞笑排行榜
        </NavLink>
        <NavLink to="/test" className={() => (tab === "test" ? "on" : "")}>
          🧪 降智检测
        </NavLink>
      </nav>
    </section>
  );
}

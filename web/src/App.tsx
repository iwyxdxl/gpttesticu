import { useEffect } from "react";
import { reportVisit } from "./lib/api";
import { getAnonId } from "./lib/anon";
import { BrowserRouter, Link, Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import Home from "./pages/Home";
import Test from "./pages/Test";
import WorkDetail from "./pages/WorkDetail";
import Admin from "./pages/Admin";

function VisitTracker() {
  const { pathname } = useLocation();
  useEffect(() => {
    if (pathname === "/admin" || pathname.startsWith("/admin/")) return;
    void reportVisit(getAnonId()).catch(() => { /* 统计失败不影响使用 */ });
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <VisitTracker />
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <header className="nav">
        <Link to="/" className="logo">
          <span className="logo-icon" aria-hidden="true">
            <svg
              viewBox="0 0 32 32"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
            >
              <circle cx="8" cy="23" r="6" />
              <circle cx="25" cy="23" r="6" />
              <path d="m8 23 6-13 5 13H8l13-10 4 10M11 10h6m3-4h3l2 7" />
            </svg>
          </span>
          <span className="logo-text">
            gpttest<em>.icu</em>
          </span>
        </Link>
        <nav className="nav-links" aria-label="主导航">
          <NavLink end to="/">
            搞笑排行榜
          </NavLink>
          <NavLink to="/test">降智检测</NavLink>
        </nav>
        <a
          className="source-link"
          href="https://github.com/iwyxdxl/gpttesticu"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="GitHub 开源仓库（新标签页打开）"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 .75a11.25 11.25 0 0 0-3.56 21.92c.56.1.77-.24.77-.54v-2.1c-3.13.68-3.79-1.33-3.79-1.33-.51-1.3-1.25-1.65-1.25-1.65-1.02-.7.08-.69.08-.69 1.13.08 1.73 1.16 1.73 1.16 1 1.72 2.64 1.22 3.28.94.1-.73.39-1.22.71-1.5-2.5-.28-5.13-1.25-5.13-5.56 0-1.23.44-2.23 1.16-3.02-.12-.29-.5-1.43.11-2.98 0 0 .95-.3 3.1 1.15a10.8 10.8 0 0 1 5.63 0c2.15-1.46 3.09-1.15 3.09-1.15.62 1.55.23 2.69.12 2.98.72.79 1.15 1.79 1.15 3.02 0 4.32-2.63 5.27-5.14 5.55.4.35.76 1.04.76 2.1v3.08c0 .3.2.65.77.54A11.25 11.25 0 0 0 12 .75Z" />
          </svg>
          <span>GitHub 开源</span>
          <span className="source-license">MIT</span>
          <span className="source-arrow" aria-hidden="true">↗</span>
        </a>
      </header>

      <main id="main-content" className="wrap">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/test" element={<Test />} />
          <Route path="/leaderboard" element={<Navigate to="/" replace />} />
          <Route path="/work/:id" element={<WorkDetail />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="*" element={<Home />} />
        </Routes>
      </main>

      <footer className="footer">
        <div className="footer-brand">
          gpttest.icu <span>一场关于鹈鹕的非严肃实验。</span>
        </div>
        <p>
          🔒 检测请求由你的浏览器直连你填写的中转站，API Key
          与端点地址不经过、也不存储于本站服务器，刷新页面即消失。
        </p>
        <p>
          ⚠️ 判定基于关键词启发式，仅供娱乐参考，不代表模型真实能力。本站与
          OpenAI 无任何关系。
        </p>
        <p className="muted small">gpttest.icu · 鹈鹕没问题，有问题的是模型</p>
      </footer>
    </BrowserRouter>
  );
}

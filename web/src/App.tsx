import { useEffect } from "react";
import { reportVisit } from "./lib/api";
import { getAnonId } from "./lib/anon";
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import Home from "./pages/Home";
import Leaderboard from "./pages/Leaderboard";
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
            模型检测
          </NavLink>
          <NavLink to="/leaderboard">
            搞笑排行榜 <span aria-hidden="true">↗</span>
          </NavLink>
        </nav>
      </header>

      <main id="main-content" className="wrap">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/leaderboard" element={<Leaderboard />} />
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

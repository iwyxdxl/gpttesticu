import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// 自托管的思源宋体：按 unicode-range 分片，浏览器只下载页面用到的字形分片
import "@fontsource/noto-serif-sc/700.css";
import "@fontsource/noto-serif-sc/900.css";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

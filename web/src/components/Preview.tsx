import { useMemo } from "react";
import { buildPreviewDoc } from "../lib/render";

interface PreviewProps {
  html: string | null;
  title?: string;
  className?: string;
}

// 所有作品均为不允许脚本、同源权限或导航的隔离沙箱。
export function Preview({
  html,
  title = "预览",
  className = "",
}: PreviewProps) {
  const doc = useMemo(() => (html ? buildPreviewDoc(html) : ""), [html]);
  if (!html) {
    return (
      <div className={`preview preview-empty ${className}`}>
        <span className="preview-empty-emoji">🪺</span>
        <span>这里还什么都没有…</span>
      </div>
    );
  }
  return (
    <div className={`preview ${className}`}>
      <iframe
        title={title}
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={doc}
      />
    </div>
  );
}

// 卡片缩略图：iframe 直接自适应容器尺寸（SVG 缩放、整页重排都正常）
export function WorkThumb({ html }: { html: string }) {
  const doc = useMemo(() => buildPreviewDoc(html), [html]);
  return (
    <div className="thumb-box">
      <iframe
        title="作品缩略图"
        loading="lazy"
        tabIndex={-1}
        referrerPolicy="no-referrer"
        sandbox=""
        srcDoc={doc}
      />
    </div>
  );
}

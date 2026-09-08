import { sanitizePreview } from "./sanitize";
// 从模型输出中提取 HTML/SVG，并包装成可安全预览的 iframe 文档。
// 安全模型：sandbox iframe（opaque origin）+ 严格 CSP（禁一切网络请求），
// 所有预览都禁脚本，只保留 CSS / SMIL 动画。

const CSP_META =
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; img-src 'none'; base-uri 'none'; form-action 'none'\">";

export function extractHtml(text: string): string | null {
  if (!text) return null;
  // 优先：```html 围栏代码块（流式未闭合也接受，方便实时渲染）
  const fences = [
    ...text.matchAll(
      /```(?:html|htm|xml|svg)?[^\S\n]*\r?\n([\s\S]*?)(?:```|$)/gi,
    ),
  ].map((m) => m[1]);
  const good = fences.filter((f) => /<svg|<html|<!doctype/i.test(f));
  const pool = good.length ? good : fences.filter((f) => f.includes("<"));
  if (pool.length) return pool[pool.length - 1].trim();

  // 其次：裸的 <!DOCTYPE html> / <html>
  const lower = text.toLowerCase();
  const start = lower.indexOf("<!doctype html");
  const h = lower.indexOf("<html");
  const s = h >= 0 && (start < 0 || h < start) ? h : start;
  if (s >= 0) {
    const end = lower.lastIndexOf("</html>");
    return (end >= 0 ? text.slice(s, end + 7) : text.slice(s)).trim();
  }

  // 最后：整段就是 SVG
  const trimmed = text.trim();
  if (trimmed.startsWith("<") && /<svg[\s>]/i.test(trimmed)) {
    const end = trimmed.toLowerCase().lastIndexOf("</svg>");
    return (end >= 0 ? trimmed.slice(0, end + 6) : trimmed).trim();
  }
  return null;
}

export function buildPreviewDoc(
  html: string,
  opts?: { dark?: boolean },
): string {
  const standalone = !/<html[\s>]/i.test(html);
  html = sanitizePreview(html);
  if (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc
      .querySelectorAll("animate, animateTransform, animateMotion, set")
      .forEach((node) => node.remove());
    html = doc.documentElement.outerHTML;
  }
  const bg = opts?.dark === true ? "#0f1424" : "#f5f2e9";
  // 独立 SVG 需要强制撑满容器并保持比例（用户上传的 SVG 常带固定 width/height）
  const wrapperStyle = `<style>html,body{margin:0;padding:0;background:${bg}}body{min-height:100vh;display:grid;place-items:center}svg{width:100%;height:auto;max-height:100vh;object-fit:contain}</style>`;
  if (/<html[\s>]/i.test(html)) {
    let out = html;
    if (/<head[^>]*>/i.test(out)) {
      out = out.replace(
        /<head[^>]*>/i,
        (m) => m + CSP_META + (standalone ? wrapperStyle : ""),
      );
    } else if (/<html[^>]*>/i.test(out)) {
      out = out.replace(/<html[^>]*>/i, (m) => m + `<head>${CSP_META}</head>`);
    }
    return out;
  }
  return `<!DOCTYPE html><html><head>${CSP_META}${wrapperStyle}</head><body>${html}</body></html>`;
}

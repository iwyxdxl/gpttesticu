// Shared allowlist: browser previews and server uploads use the same policy.
export const SANITIZE_CONFIG = {
  WHOLE_DOCUMENT: true,
  USE_PROFILES: { html: true, svg: true, svgFilters: true },
  ADD_TAGS: ["use", "animate", "animateTransform", "animateMotion", "mpath"],
  FORBID_TAGS: [
    "script",
    "iframe",
    "object",
    "embed",
    "foreignObject",
    "form",
    "input",
    "button",
    "textarea",
    "select",
    "link",
    "meta",
    "base",
    "audio",
    "video",
    "source",
  ],
  FORBID_ATTR: [
    "srcset",
    "ping",
    "target",
    "action",
    "formaction",
    "srcdoc",
    "is",
  ],
};

export function safeAttribute(name: string, value: string): boolean {
  const lower = name.toLowerCase();
  if (lower.startsWith("on")) return false;
  if (lower.startsWith("xmlns"))
    return (
      value === "http://www.w3.org/2000/svg" ||
      value === "http://www.w3.org/1999/xlink" ||
      value === "http://www.w3.org/1999/xhtml"
    );
  if (lower.includes(":") && lower !== "xlink:href" && lower !== "xml:space")
    return false;
  if (["href", "xlink:href", "src", "poster", "background"].includes(lower))
    return /^#[\w:.-]+$/.test(value);
  // SMIL must not mutate resource / event / namespace attributes later.
  if (lower === "attributename")
    return /^(transform|d|opacity|fill|stroke|stroke-width|stroke-dashoffset|cx|cy|r|x|y|x1|x2|y1|y2|width|height)$/.test(
      value,
    );
  return true;
}

// Parse CSS first so comments / escapes cannot hide external URLs.
// A small structural interface keeps this shared file independent of node packages.
export function cleanCss(css: string, tree: any, inline = false): string {
  try {
    const decoded = css.replace(
      /\\([0-9a-f]{1,6})\s?|\\([^\r\n])/gi,
      (_: string, hex: string, char: string) =>
        hex
          ? String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff))
          : char,
    );
    const ast = tree.parse(decoded, {
      context: inline ? "declarationList" : "stylesheet",
      parseCustomProperty: true,
    });
    let unsafe = false;
    tree.walk(ast, (node: any) => {
      if (node.type === "Url" && !/^#[\w:.-]+$/.test(node.value)) unsafe = true;
      if (node.type === "Raw") unsafe = true;
      if (
        node.type === "Atrule" &&
        !["keyframes", "-webkit-keyframes", "media", "supports"].includes(
          node.name.toLowerCase(),
        )
      )
        unsafe = true;
      if (
        node.type === "Function" &&
        /^(expression|image-set|-webkit-image-set|src)$/i.test(node.name)
      )
        unsafe = true;
    });
    return unsafe ? "" : tree.generate(ast);
  } catch {
    return "";
  }
}

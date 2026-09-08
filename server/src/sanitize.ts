import DOMPurify from "isomorphic-dompurify";
import * as cssTree from "css-tree";
import { SANITIZE_CONFIG, safeAttribute, cleanCss } from "./sanitize-policy.js";

DOMPurify.addHook("uponSanitizeAttribute", (_node, data) => {
  if (!safeAttribute(data.attrName, data.attrValue)) data.keepAttr = false;
  if (data.attrName === "style")
    data.attrValue = cleanCss(data.attrValue, cssTree, true);
});
DOMPurify.addHook("uponSanitizeElement", (node, data) => {
  if (data.tagName === "style")
    node.textContent = cleanCss(node.textContent ?? "", cssTree);
});

export function sanitizeUserHtml(input: string): string {
  return DOMPurify.sanitize(input, SANITIZE_CONFIG).trim();
}

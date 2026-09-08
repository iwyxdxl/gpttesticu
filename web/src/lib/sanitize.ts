import DOMPurify from "dompurify";
import * as cssTree from "css-tree";
import {
  SANITIZE_CONFIG,
  safeAttribute,
  cleanCss,
} from "../../../server/src/sanitize-policy";

DOMPurify.addHook("uponSanitizeAttribute", (_node, data) => {
  if (!safeAttribute(data.attrName, data.attrValue)) data.keepAttr = false;
  if (data.attrName === "style")
    data.attrValue = cleanCss(data.attrValue, cssTree, true);
});
DOMPurify.addHook("uponSanitizeElement", (node, data) => {
  if (data.tagName === "style")
    node.textContent = cleanCss(node.textContent ?? "", cssTree);
});

export const sanitizePreview = (html: string) =>
  DOMPurify.sanitize(html, SANITIZE_CONFIG);

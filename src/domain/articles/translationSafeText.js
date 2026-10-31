import { createElement } from "react";

const LITERAL_TEXT_CONTAINERS = new Set([
  "code",
  "pre",
  "script",
  "style",
  "textarea",
  "option",
  "title",
  "svg",
  "math",
]);

// Translate may replace a Text node with <font> elements. Keep a stable element
// as React's insertion/removal anchor, while allowing its contents to translate.
const translationSafeText = (reactNode, domNode, index) => {
  if (
    domNode.type !== "text" ||
    typeof reactNode !== "string" ||
    !reactNode.trim()
  ) {
    return reactNode;
  }
  for (let { parent } = domNode; parent; parent = parent.parent) {
    if (LITERAL_TEXT_CONTAINERS.has(parent.name)) {
      return reactNode;
    }
  }
  return createElement("span", { key: index }, reactNode);
};

export default translationSafeText;

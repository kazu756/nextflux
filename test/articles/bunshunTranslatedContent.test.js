import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
const require = createRequire(import.meta.url);
const dir = fileURLToPath(new URL("../../", import.meta.url));
const file = new URL(
  "../../src/components/ArticleView/components/ArticleContent.jsx",
  import.meta.url,
);
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://127.0.0.1:5174/",
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = require("react-dom/client");
async function component() {
  const mocks = {
    "@nanostores/react":
      "export const useStore=()=>({useThirdPartyMediaPlayer:false});",
    "@/stores/settingsStore.js": "export const settingsState={};",
    "@/stores/articlesStore.js": "export const imageGalleryActive={set(){}};",
    "@/lib/utils.js":
      'export const cn=(...x)=>x.join(" ");export const getFontSizeClass=()=>"";',
    "react-photo-view": "export const PhotoProvider=({children})=>children;",
    "./ArticleImage.jsx":
      'import {createElement} from "react";export default ({imgNode})=>createElement("img",imgNode.attribs);',
    "./Attachments.jsx": "export default ()=>null;",
    "./Iframe.jsx": "export default ()=>null;",
    "./MediaPlayer.jsx": "export default ()=>null;",
    "@/components/GlobalAudio/AudioLaunchButton.jsx":
      "export default ()=>null;",
    "./MediaLinkPill.jsx": "export default ()=>null;",
    "./CodeBlock.jsx": "export default ()=>null;",
  };
  const result = await build({
    stdin: {
      contents: await readFile(file, "utf8"),
      loader: "jsx",
      resolveDir: fileURLToPath(new URL(".", file)),
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    jsx: "automatic",
    plugins: [
      {
        name: "content-test-boundaries",
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, (args) => {
            if (mocks[args.path]) return { path: args.path, namespace: "stub" };
            if (args.path.startsWith("@/"))
              return { path: dir + "src/" + args.path.slice(2) };
            if (!args.path.startsWith("."))
              return { path: require.resolve(args.path), external: true };
          });
          builder.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
            contents: mocks[args.path],
            loader: "jsx",
          }));
        },
      },
    ],
  });
  const module = { exports: {} };
  new Function("require", "module", result.outputFiles[0].text)(
    require,
    module,
  );
  return module.exports.default;
}
function translate(host) {
  const walker = document.createTreeWalker(host, window.NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const font = document.createElement("font");
    font.textContent = "Translated " + node.data;
    node.replaceWith(font);
  }
}
test("real ArticleContent replaces translated HTML on G switch but preserves body/media on read/star changes", async () => {
  const Component = await component();
  const host = document.createElement("div");
  document.body.append(host);
  const errors = [];
  const root = createRoot(host, {
    onUncaughtError: (error) => errors.push(error),
  });
  const summary =
    '<p>Summary <a href="https://example.com">link</a> tail</p><img src="https://example.com/image.jpg">';
  const combined =
    '<section><h2>1 / 2</h2><p><a href="https://example.com">Combined first page</a></p><img src="https://example.com/image.jpg"></section><section><h2>2 / 2</h2><p>Combined final paragraph</p></section>';
  const render = (content, extra = {}) =>
    act(async () =>
      root.render(
        createElement(Component, {
          article: { id: 1, content, enclosures: [], ...extra },
          fontSize: 18,
          lineHeight: 1.6,
        }),
      ),
    );
  try {
    await render(summary);
    const before = host.querySelector(".article-content");
    translate(before);
    await render(combined);
    const joined = host.querySelector(".article-content");
    assert.notEqual(joined, before);
    assert(joined.textContent.includes("Combined final paragraph"));
    translate(joined);
    const image = joined.querySelector("img");
    await render(combined, { status: "read", starred: 1 });
    assert.equal(host.querySelector(".article-content"), joined);
    assert.equal(joined.querySelector("img"), image);
    assert(joined.textContent.includes("Translated"));
    await render(summary);
    assert.notEqual(host.querySelector(".article-content"), joined);
    assert.deepEqual(errors, []);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

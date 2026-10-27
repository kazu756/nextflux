import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { act, createElement } from "react";
import { Buffer } from "node:buffer";
import { getArticleImageSource } from "../../src/domain/articles/articleImageSource.js";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../../", import.meta.url));
const componentPath = new URL(
  "../../src/components/ArticleList/components/ArticleCardCover.jsx",
  import.meta.url,
);
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://127.0.0.1:5173/",
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = require("react-dom/client");
const first = "https://bunshun.ismcdn.jp/mwimgs/a/first.jpg";
const second = "https://bunshun.ismcdn.jp/mwimgs/b/second.jpg";
const worker = "https://images.example.workers.dev";

async function loadCover(base, size = "large") {
  const mocks = {
    "@nanostores/react":
      "export const useStore = () => ({cardImageSize:" +
      JSON.stringify(size) +
      "});",
    "@/stores/settingsStore": "export const settingsState = {};",
    "@/stores/authStore.js":
      'export const sessionAccount = {serverUrl:"https://miniflux.example"};',
    "@/lib/utils.js":
      'export const cn = (...values) => values.filter(Boolean).join(" ");',
    "@/lib/utils":
      'export const cn = (...values) => values.filter(Boolean).join(" ");',
  };
  const result = await build({
    stdin: {
      contents: await readFile(componentPath, "utf8"),
      loader: "jsx",
      resolveDir: fileURLToPath(new URL(".", componentPath)),
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    jsx: "automatic",
    define: {
      "import.meta.env.VITE_BUNSHUN_IMAGE_WORKER_URL": JSON.stringify(base),
    },
    plugins: [
      {
        name: "cover-test-boundaries",
        setup(builder) {
          builder.onResolve({ filter: /.*/ }, (args) => {
            if (mocks[args.path]) return { path: args.path, namespace: "stub" };
            if (args.path.startsWith("@/"))
              return { path: root + "src/" + args.path.slice(2) };
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

async function mount(Component) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  return {
    host,
    render: (imageUrl) =>
      act(async () => root.render(createElement(Component, { imageUrl }))),
    event: (node, name) =>
      act(async () => node.dispatchEvent(new window.Event(name))),
    close: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

test("cover error/load state belongs to the resolved URL and old events cannot poison the next image", async () => {
  for (const size of ["large", "small"]) {
    const view = await mount(await loadCover(worker, size));
    try {
      await view.render(first);
      const old = view.host.querySelector("img");
      assert.equal(
        old.getAttribute("src"),
        getArticleImageSource(first, worker),
      );
      await view.event(old, "error");
      assert.equal(view.host.querySelector("img"), null);
      await view.render(first);
      assert.equal(
        view.host.querySelector("img"),
        null,
        "unchanged failed URL must not retry",
      );
      await view.render(second);
      const current = view.host.querySelector("img");
      assert(current);
      assert.equal(
        current.getAttribute("src"),
        getArticleImageSource(second, worker),
      );
      assert(
        view.host
          .querySelector(".card-image")
          .classList.contains("animate-pulse!"),
      );
      await view.event(old, "error");
      assert.equal(view.host.querySelector("img"), current);
      await view.event(current, "load");
      assert.equal(
        view.host
          .querySelector(".card-image")
          .classList.contains("animate-pulse!"),
        false,
      );
      assert.equal(current.classList.contains("opacity-0"), false);
      await view.render(second);
      assert.equal(
        view.host.querySelector("img"),
        current,
        "same source retains loaded image",
      );
      await view.render(first);
      assert(
        view.host.querySelector("img"),
        "returning to another URL starts a fresh attempt",
      );
    } finally {
      await view.close();
    }
  }
});

test("cover keeps other sites and unset Worker unchanged, and supports empty-to-image updates", async () => {
  for (const base of ["", worker]) {
    const view = await mount(await loadCover(base));
    try {
      await view.render(null);
      assert.equal(view.host.querySelector("img"), null);
      const source = base ? "https://other.example/photo.jpg" : first;
      await view.render(source);
      assert.equal(view.host.querySelector("img").getAttribute("src"), source);
      await view.render(null);
      assert.equal(view.host.querySelector(".card-image"), null);
    } finally {
      await view.close();
    }
  }
});

test("cover uses the same resolver for official Miniflux proxy URLs", async () => {
  const encode = (value) =>
    Buffer.from(value)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  const proxy =
    "https://miniflux.example/proxy/" +
    encode(new Uint8Array(32)) +
    "/" +
    encode(first);
  const view = await mount(await loadCover(worker));
  try {
    await view.render(proxy);
    assert.equal(
      view.host.querySelector("img").getAttribute("src"),
      getArticleImageSource(first, worker),
    );
  } finally {
    await view.close();
  }
});

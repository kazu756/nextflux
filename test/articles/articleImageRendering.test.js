import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getArticleImageSource } from "../../src/domain/articles/articleImageSource.js";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../../", import.meta.url));
const componentPath = new URL(
  "../../src/components/ArticleView/components/ArticleImage.jsx",
  import.meta.url,
);
const target = "https://bunshun.ismcdn.jp/mwimgs/a/b/image.jpg";
const worker = "https://images.example.workers.dev";

async function loadComponent(workerBase) {
  const mocks = {
    "react-i18next":
      "export const useTranslation = () => ({t: value => value});",
    "react-photo-view":
      'import {createElement} from "react"; export const PhotoView = ({src, children}) => createElement("div", {"data-photo-src":src}, children);',
    "@/stores/authStore.js":
      'export const sessionAccount = {serverUrl:"https://miniflux.example"};',
    "@/lib/utils.js":
      'export const cn = (...values) => values.filter(Boolean).join(" ");',
    "@/lib/utils":
      'export const cn = (...values) => values.filter(Boolean).join(" ");',
  };
  const bundled = await build({
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
      "import.meta.env.VITE_BUNSHUN_IMAGE_WORKER_URL":
        JSON.stringify(workerBase),
    },
    plugins: [
      {
        name: "image-test-boundaries",
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
  new Function("require", "module", bundled.outputFiles[0].text)(
    require,
    module,
  );
  return module.exports.default;
}

test("real ArticleImage and Image use one resolved source for inline and gallery without changing alt", async () => {
  const Component = await loadComponent(worker);
  const source = getArticleImageSource(target, worker);
  const html = renderToStaticMarkup(
    createElement(Component, {
      imgNode: { attribs: { src: target, alt: "Caption" } },
    }),
  );
  assert(html.includes('data-photo-src="' + source + '"'));
  assert.match(
    html,
    new RegExp(
      '<img[^>]+src="' + source.replace(/[.*+?^$()|[\]\\]/g, "\\$&") + '"',
    ),
  );
  assert(html.includes('alt="Caption"'));
});

test("rendered images retain their original source without Worker or for other sites", async () => {
  for (const base of ["", worker]) {
    const Component = await loadComponent(base);
    for (const source of base
      ? ["https://other.example/photo.jpg"]
      : [target, "https://other.example/photo.jpg"]) {
      const html = renderToStaticMarkup(
        createElement(Component, { imgNode: { attribs: { src: source } } }),
      );
      assert(html.includes('data-photo-src="' + source + '"'));
      assert(html.includes('src="' + source + '"'));
    }
  }
});

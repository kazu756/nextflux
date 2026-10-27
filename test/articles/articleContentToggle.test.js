import test from "node:test";
import assert from "node:assert/strict";
import { atom } from "nanostores";
import { createArticleContentToggle } from "../../src/services/articleContentToggle.js";

function state(loadContent) {
  const activeArticle = atom({
    id: 1,
    content: "summary",
    originalContent: "summary",
    status: "unread",
    starred: 0,
  });
  const loading = atom(false);
  const errors = [];
  return {
    activeArticle,
    loading,
    errors,
    toggle: createArticleContentToggle({
      activeArticle,
      loading,
      loadContent,
      onError: (error) => errors.push(error),
    }),
  };
}
test("successful G fetch merges current read/star state and G back restores original", async () => {
  let finish;
  const value = state(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const request = value.toggle(value.activeArticle.get());
  value.activeArticle.set({
    ...value.activeArticle.get(),
    status: "read",
    starred: 1,
  });
  finish("combined body");
  await request;
  assert.equal(value.activeArticle.get().content, "combined body");
  assert.equal(value.activeArticle.get().status, "read");
  assert.equal(value.activeArticle.get().starred, 1);
  await value.toggle(value.activeArticle.get());
  assert.equal(value.activeArticle.get().content, "summary");
  assert.equal(value.loading.get(), false);
});
test("navigation away and back invalidates pending results and errors", async () => {
  let finish;
  const value = state(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const request = value.toggle(value.activeArticle.get());
  value.activeArticle.set({ id: 2, content: "other" });
  value.activeArticle.set({ id: 1, content: "fresh visit" });
  finish("stale result");
  await request;
  assert.equal(value.activeArticle.get().content, "fresh visit");
  assert.equal(value.loading.get(), false);
});
test("partial or failed fetch keeps existing body and reports visible failure through callback", async () => {
  const error = new Error("Page 2 failed");
  const value = state(async () => {
    throw error;
  });
  await value.toggle(value.activeArticle.get());
  assert.equal(value.activeArticle.get().content, "summary");
  assert.equal(value.activeArticle.get().shownOriginal, undefined);
  assert.deepEqual(value.errors, [error]);
  assert.equal(value.loading.get(), false);
});

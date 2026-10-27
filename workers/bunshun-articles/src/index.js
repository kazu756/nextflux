import { handleArticleRequest } from "./handler.js";
export default {
  fetch(request, env, ctx) {
    return handleArticleRequest(request, env, {
      cache: caches.default,
      waitUntil: (task) => ctx.waitUntil(task),
    });
  },
};

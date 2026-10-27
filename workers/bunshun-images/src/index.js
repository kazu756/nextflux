import { handleImageRequest } from "./handler.js";

export default {
  fetch(request, env, ctx) {
    return handleImageRequest(request, {
      cache: caches.default,
      waitUntil: (task) => ctx.waitUntil(task),
    });
  },
};

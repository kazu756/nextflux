import test from "node:test";
import assert from "node:assert/strict";
import {
  handleImageRequest,
  MAX_IMAGE_BYTES,
} from "../../workers/bunshun-images/src/handler.js";

const target =
  "https://bunshun.ismcdn.jp/mwimgs/d/c/1500wm/img_dcc92558a0f2d254312acb331d2a067f82737.jpg";
const url = "https://worker.example/image?url=" + encodeURIComponent(target);
const jpeg = new Uint8Array([255, 216, 255, 224, 0, 0, 255, 217]);
const imageResponse = () =>
  new Response(jpeg, {
    headers: { "Content-Type": "image/jpeg", "Set-Cookie": "not-forwarded=1" },
  });
const request = (method = "GET") =>
  new Request(url, {
    method,
    headers: {
      Cookie: "private=fixture",
      Authorization: "Bearer fixture",
      "X-Auth-Token": "fixture",
      Referer: "https://untrusted.example/",
      Range: "bytes=0-2",
    },
  });

test("Worker forwards only fixed headers, validates image and supports HEAD", async () => {
  for (const method of ["GET", "HEAD"]) {
    const response = await handleImageRequest(request(method), {
      fetchImage: async (destination, options) => {
        assert.equal(destination, target);
        assert.equal(options.redirect, "manual");
        assert.equal(options.method, "GET");
        const headers = new Headers(options.headers);
        assert.equal(headers.get("Referer"), "https://bunshun.jp/");
        assert.deepEqual([...headers.keys()], ["accept", "referer"]);
        return imageResponse();
      },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "image/jpeg");
    assert.equal(response.headers.get("Set-Cookie"), null);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    assert.equal(
      (await response.arrayBuffer()).byteLength,
      method === "HEAD" ? 0 : jpeg.length,
    );
  }
});

test("Worker rejects invalid destinations and unsupported methods before fetch", async () => {
  let calls = 0;
  const fetchImage = async () => {
    calls++;
    return imageResponse();
  };
  for (const candidate of [
    target.replace(".jp/", ".jp.evil.example/"),
    target.replace("https:", "http:"),
    target.replace("https://", "https://u:p@"),
    target.replace(".jp/", ".jp:443/"),
    target.replace(".jp/", ".jp:8443/"),
    target.replace(".jpg", ".svg"),
    "invalid",
  ]) {
    assert.equal(
      (
        await handleImageRequest(
          new Request(
            "https://worker.example/image?url=" + encodeURIComponent(candidate),
          ),
          { fetchImage },
        )
      ).status,
      400,
    );
  }
  for (const badUrl of [
    url + "&url=" + encodeURIComponent(target),
    url + "&extra=x",
    "https://worker.example/image",
    "https://worker.example/elsewhere",
  ]) {
    assert.notEqual(
      (await handleImageRequest(new Request(badUrl), { fetchImage })).status,
      200,
    );
  }
  assert.equal(
    (await handleImageRequest(request("POST"), { fetchImage })).status,
    405,
  );
  assert.equal(calls, 0);
});

test("all redirects are rejected without following Location", async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    let calls = 0;
    const response = await handleImageRequest(request(), {
      fetchImage: async (_, options) => {
        calls++;
        assert.equal(options.redirect, "manual");
        return new Response(null, {
          status,
          headers: { Location: "https://private.example/" },
        });
      },
    });
    assert.equal(response.status, 502);
    assert.equal(calls, 1);
    assert.equal(response.headers.get("Location"), null);
  }
});

test("upstream 403, 404 and 429 stay failures and bodies are not exposed", async () => {
  for (const status of [403, 404, 429]) {
    const response = await handleImageRequest(request(), {
      fetchImage: async () =>
        new Response("private upstream details", { status }),
    });
    assert.equal(response.status, status);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(
      (await response.text()).includes("private upstream details"),
      false,
    );
  }
});

test("HTML, SVG, missing MIME and spoofed raster MIME are rejected", async () => {
  for (const type of [
    "text/html",
    "image/svg+xml",
    "application/octet-stream",
    "image/jpeg",
    "",
  ]) {
    const response = await handleImageRequest(request(), {
      fetchImage: async () =>
        new Response("<svg onload='alert(1)'></svg>", {
          headers: { "Content-Type": type },
        }),
    });
    assert.equal(response.status, 502);
  }
});

test("valid raster signatures are served and no other MIME is accepted", async () => {
  for (const [type, bytes] of [
    ["image/png", new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
    ["image/gif", new TextEncoder().encode("GIF89a")],
    ["image/webp", new TextEncoder().encode("RIFF0000WEBP")],
  ]) {
    assert.equal(
      (
        await handleImageRequest(request(), {
          fetchImage: async () =>
            new Response(bytes, { headers: { "Content-Type": type } }),
        })
      ).status,
      200,
    );
  }
});

test("size is bounded by declared and streamed length", async () => {
  assert.equal(
    (
      await handleImageRequest(request(), {
        fetchImage: async () =>
          new Response(jpeg, {
            headers: {
              "Content-Type": "image/jpeg",
              "Content-Length": String(MAX_IMAGE_BYTES + 1),
            },
          }),
      })
    ).status,
    413,
  );
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      controller.enqueue(new Uint8Array(MAX_IMAGE_BYTES + 1));
    },
    cancel() {
      cancelled = true;
    },
  });
  assert.equal(
    (
      await handleImageRequest(request(), {
        fetchImage: async () =>
          new Response(stream, { headers: { "Content-Type": "image/jpeg" } }),
      })
    ).status,
    413,
  );
  assert.equal(cancelled, true);
});

test("timeout covers both request and stalled response body", async () => {
  const response = await handleImageRequest(request(), {
    timeoutMs: 10,
    fetchImage: (_, options) =>
      new Promise((resolve, reject) =>
        options.signal.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          { once: true },
        ),
      ),
  });
  assert.equal(response.status, 504);
  const stalled = new ReadableStream({
    start(controller) {
      controller.enqueue(jpeg);
    },
  });
  assert.equal(
    (
      await handleImageRequest(request(), {
        timeoutMs: 10,
        fetchImage: async () =>
          new Response(stalled, { headers: { "Content-Type": "image/jpeg" } }),
      })
    ).status,
    504,
  );
});

test("validated successes are cached, HEAD has no body, errors are not cached", async () => {
  const entries = new Map();
  const tasks = [];
  let calls = 0;
  const options = {
    cache: {
      match: async (key) => entries.get(key.url)?.clone(),
      put: async (key, value) => {
        entries.set(key.url, value);
      },
    },
    waitUntil: (task) => tasks.push(task),
    fetchImage: async () => {
      calls++;
      return imageResponse();
    },
  };
  assert.equal((await handleImageRequest(request(), options)).status, 200);
  await Promise.all(tasks);
  const cached = await handleImageRequest(request("HEAD"), options);
  assert.equal(await cached.text(), "");
  assert.equal(calls, 1);
  assert.equal(entries.size, 1);
  const failures = [];
  const failed = await handleImageRequest(request(), {
    cache: { match: async () => null, put: async () => failures.push(1) },
    waitUntil: (task) => tasks.push(task),
    fetchImage: async () => new Response(null, { status: 403 }),
  });
  assert.equal(failed.status, 403);
  assert.equal(failures.length, 0);
});

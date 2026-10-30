const WEBHOOK_PATH = "/telegram/webhook";
const MAX_BODY_BYTES = 1024 * 1024;

function safeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ service: "ronin-cloudflare-gateway", status: "ok" });
    }

    if (url.pathname !== WEBHOOK_PATH) {
      return json({ error: "not_found" }, 404);
    }
    if (request.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405);
    }

    const expectedSecret = env.TELEGRAM_WEBHOOK_SECRET;
    const suppliedSecret = request.headers.get("X-Telegram-Bot-Api-Secret-Token") || "";
    if (!expectedSecret || !safeEqual(suppliedSecret, expectedSecret)) {
      return json({ error: "unauthorized" }, 401);
    }

    if (!env.BACKEND_URL) {
      return json({ error: "backend_not_configured" }, 503);
    }

    let backend;
    try {
      backend = new URL(env.BACKEND_URL);
    } catch {
      return json({ error: "invalid_backend_url" }, 500);
    }
    if (backend.protocol !== "https:" || backend.username || backend.password) {
      return json({ error: "backend_must_be_https" }, 500);
    }

    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > MAX_BODY_BYTES) {
      return json({ error: "payload_too_large" }, 413);
    }

    let body;
    try {
      body = await request.arrayBuffer();
    } catch {
      return json({ error: "invalid_payload" }, 400);
    }
    if (body.byteLength > MAX_BODY_BYTES) {
      return json({ error: "payload_too_large" }, 413);
    }

    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("content-length");
    headers.set("X-Ronin-Edge", "cloudflare");

    try {
      const upstream = await fetch(new URL(WEBHOOK_PATH, backend.origin), {
        method: "POST",
        headers,
        body,
        redirect: "manual",
      });

      return new Response(upstream.body, {
        status: upstream.status,
        headers: {
          "content-type": upstream.headers.get("content-type") || "application/json",
          "cache-control": "no-store",
        },
      });
    } catch {
      // A non-2xx response lets Telegram retry delivery instead of losing updates.
      return json({ error: "backend_unavailable" }, 502);
    }
  },
};

/**
 * Deno Deploy News Relay — xhttp/ws compatible (FIXED)
 */

const TARGET_BASE = "https://aischool.eu.cc:448".replace(/\/$/, "");

const STATIC_INDEX = `<!DOCTYPE html><html><body><h1>News Hub</h1></body></html>`;
// ↑ اگه HTML کامل می‌خوای، همون رو از قبل بذار

const STRIP_HEADERS = new Set([
  "host", "connection", "keep-alive", "proxy-authenticate",
  "proxy-authorization", "te", "trailer", "transfer-encoding",
  "upgrade", "forwarded",
  "x-forwarded-host", "x-forwarded-proto", "x-forwarded-port",
  "content-length", // ← مهم: برای streaming باید حذف بشه
]);

async function newsDispatcher(request: Request): Promise<Response> {
  const incomingUrl = new URL(request.url);
  const upgradeHeader = request.headers.get("upgrade") || "";

  // فقط مسیر دقیقاً "/" بدون query → صفحه استاتیک
  if (
    incomingUrl.pathname === "/" &&
    !incomingUrl.search &&
    request.method === "GET" &&
    upgradeHeader.toLowerCase() !== "websocket"
  ) {
    return new Response(STATIC_INDEX, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=300",
      },
    });
  }

  if (upgradeHeader.toLowerCase() === "websocket") {
    return relayWebSocket(request, incomingUrl);
  }

  return relayHttp(request, incomingUrl);
}

async function relayHttp(request: Request, incomingUrl: URL): Promise<Response> {
  try {
    const upstreamUrl = TARGET_BASE + incomingUrl.pathname + incomingUrl.search;
    const dispatchHeaders = new Headers();

    for (const [key, value] of request.headers) {
      const headerKey = key.toLowerCase();
      if (STRIP_HEADERS.has(headerKey)) continue;
      dispatchHeaders.set(headerKey, value);
    }

    // host رو دستی روی مقصد ست کن
    const targetHost = new URL(TARGET_BASE).host;
    dispatchHeaders.set("host", targetHost);

    const requestMethod = request.method;
    const containsPayload = requestMethod !== "GET" && requestMethod !== "HEAD";

    const dispatchConfig: RequestInit & { duplex?: string } = {
      method: requestMethod,
      headers: dispatchHeaders,
      redirect: "manual",
    };

    if (containsPayload) {
      dispatchConfig.body = request.body;
      // ★★★ این خط کلید حل مشکل xhttp ـه ★★★
      dispatchConfig.duplex = "half";
    }

    const upstreamResponse = await fetch(upstreamUrl, dispatchConfig);

    const editorialHeaders = new Headers();
    for (const [key, value] of upstreamResponse.headers) {
      const k = key.toLowerCase();
      if (k === "transfer-encoding" || k === "content-length") continue;
      editorialHeaders.set(key, value);
    }

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: editorialHeaders,
    });
  } catch (error) {
    console.error("Relay error:", error);
    return new Response("Bad Gateway: " + (error as Error).message, { status: 502 });
  }
}

function relayWebSocket(request: Request, incomingUrl: URL): Response {
  try {
    const { socket: clientSock, response } = Deno.upgradeWebSocket(request);

    const wsTargetBase = TARGET_BASE
      .replace(/^https:/, "wss:")
      .replace(/^http:/, "ws:");
    const upstreamWsUrl = wsTargetBase + incomingUrl.pathname + incomingUrl.search;

    const upstreamSock = new WebSocket(upstreamWsUrl);
    upstreamSock.binaryType = "arraybuffer";
    clientSock.binaryType = "arraybuffer";

    let upstreamReady = false;
    const queue: any[] = [];

    upstreamSock.onopen = () => {
      upstreamReady = true;
      while (queue.length > 0) upstreamSock.send(queue.shift());
    };

    clientSock.onmessage = (ev) => {
      if (upstreamReady) upstreamSock.send(ev.data);
      else queue.push(ev.data);
    };

    upstreamSock.onmessage = (ev) => {
      try { clientSock.send(ev.data); } catch (_) {}
    };

    const closeBoth = () => {
      try { upstreamSock.close(); } catch (_) {}
      try { clientSock.close(); } catch (_) {}
    };

    clientSock.onclose = closeBoth;
    clientSock.onerror = closeBoth;
    upstreamSock.onclose = closeBoth;
    upstreamSock.onerror = closeBoth;

    return response;
  } catch (_error) {
    return new Response("WebSocket relay failed", { status: 502 });
  }
}

Deno.serve(newsDispatcher);

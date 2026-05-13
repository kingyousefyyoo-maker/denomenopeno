/**
 * Deno Deploy News Relay
 * Serves static news page on "/" and relays everything else to target.
 */

const TARGET_BASE = "https://aischool.eu.cc:443/".replace(/\/$/, "");

const STATIC_INDEX = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Aischool News Hub</title>
    <style>
        :root {
            --bg: #fdfaf6;
            --ink: #1a1a1a;
            --accent: #b22222;
            --paper: #fff;
        }
        body {
            background-color: var(--bg);
            color: var(--ink);
            font-family: 'Georgia', 'Times New Roman', serif;
            margin: 0;
            padding: 20px;
        }
        header {
            border-bottom: 6px solid var(--ink);
            padding-bottom: 20px;
            margin-bottom: 40px;
            text-align: center;
        }
        h1 {
            font-size: 3.5rem;
            text-transform: uppercase;
            letter-spacing: -2px;
            margin: 0;
            color: var(--ink);
        }
        nav {
            margin-top: 20px;
            border-top: 2px solid var(--ink);
            border-bottom: 2px solid var(--ink);
            padding: 10px 0;
        }
        nav a {
            color: var(--ink);
            text-decoration: none;
            font-weight: bold;
            text-transform: uppercase;
            margin: 0 15px;
            font-size: 0.9rem;
        }
        nav a:hover { color: var(--accent); }
        .wrapper {
            display: grid;
            grid-template-columns: 2fr 1fr;
            gap: 40px;
            max-width: 1000px;
            margin: 0 auto;
        }
        .news-card {
            background: var(--paper);
            border: 3px solid var(--ink);
            padding: 25px;
            margin-bottom: 30px;
            box-shadow: 10px 10px 0px var(--ink);
        }
        .news-card h2 {
            margin-top: 0;
            font-size: 1.8rem;
            line-height: 1.2;
            text-transform: uppercase;
        }
        .news-card .meta {
            font-style: italic;
            color: var(--accent);
            border-bottom: 1px solid var(--ink);
            margin-bottom: 15px;
            padding-bottom: 5px;
        }
        aside {
            border-left: 6px solid var(--ink);
            padding-left: 20px;
        }
        aside h3 {
            text-transform: uppercase;
            border-bottom: 3px solid var(--ink);
            padding-bottom: 10px;
        }
        ul { list-style: none; padding: 0; }
        ul li {
            margin-bottom: 15px;
            font-weight: bold;
            padding: 10px;
            background: #eee;
            border-bottom: 3px solid var(--ink);
        }
        footer {
            margin-top: 60px;
            border-top: 4px solid var(--ink);
            padding-top: 20px;
            text-align: center;
            font-weight: bold;
        }
        @media (max-width: 768px) {
            .wrapper { grid-template-columns: 1fr; }
            h1 { font-size: 2rem; }
            aside { border-left: none; border-top: 6px solid var(--ink); padding-top: 20px; }
        }
    </style>
</head>
<body>
    <header>
        <h1>Aischool News Hub 🐍</h1>
        <nav>
            <a href="#">Home</a>
            <a href="#">Releases</a>
            <a href="#">Tutorials</a>
            <a href="#">Community</a>
        </nav>
    </header>

    <div class="wrapper">
        <main>
            <article class="news-card">
      <h2>Visualizing Matrix Transformations: A Programmer's Guide to Linear Algebra</h2>
      <div class="meta">Mathematics · June 24, 2026</div>
      
    </article>
        </main>
        
        <aside>
            <h3>Trending</h3>
            <ul>
                <li>📌 Mathematics</li>
            </ul>
        </aside>
    </div>

    <footer>
        © 2026 — Aischool News Hub
    </footer>
</body>
</html>`;

const STRIP_HEADERS = new Set([
  "host", "connection", "keep-alive", "proxy-authenticate",
  "proxy-authorization", "te", "trailer", "transfer-encoding",
  "upgrade", "forwarded",
  "x-forwarded-host", "x-forwarded-proto", "x-forwarded-port",
]);

/**
 * Main HTTP handler — fired for every incoming request.
 */
async function newsDispatcher(request: Request): Promise<Response> {
  if (!TARGET_BASE) {
    return new Response("Misconfigured: TARGET_BASE is not set", { status: 500 });
  }

  const incomingUrl = new URL(request.url);
  const upgradeHeader = request.headers.get("upgrade") || "";

  // مسیر "/" → اگر WebSocket نبود، صفحه خبری استاتیک رو نشون بده
  if (incomingUrl.pathname === "/" && upgradeHeader.toLowerCase() !== "websocket") {
    return new Response(STATIC_INDEX, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=300",
      },
    });
  }

  // -------- WebSocket relay (برای ws inbound) ----------
  if (upgradeHeader.toLowerCase() === "websocket") {
    return relayWebSocket(request, incomingUrl);
  }

  // -------- HTTP relay (برای xhttp / streaming) ----------
  return relayHttp(request, incomingUrl);
}


/**
 * Relay normal HTTP / xhttp / streaming requests.
 */
async function relayHttp(request: Request, incomingUrl: URL): Promise<Response> {
  try {
    const upstreamUrl = TARGET_BASE + incomingUrl.pathname + incomingUrl.search;
    const dispatchHeaders = new Headers();
    let readerIp: string | null = null;

    for (const [key, value] of request.headers) {
      const headerKey = key.toLowerCase();
      if (STRIP_HEADERS.has(headerKey)) continue;
      if (headerKey === "x-real-ip") { readerIp = value; continue; }
      if (headerKey === "x-forwarded-for") {
        if (!readerIp) readerIp = value;
        continue;
      }
      dispatchHeaders.set(headerKey, value);
    }

    if (readerIp) dispatchHeaders.set("x-forwarded-for", readerIp);

    const requestMethod = request.method;
    const containsPayload = requestMethod !== "GET" && requestMethod !== "HEAD";

    const dispatchConfig: RequestInit = {
      method: requestMethod,
      headers: dispatchHeaders,
      redirect: "manual",
    };

    if (containsPayload) {
      dispatchConfig.body = request.body;
    }

    const upstreamResponse = await fetch(upstreamUrl, dispatchConfig);

    const editorialHeaders = new Headers();
    for (const [key, value] of upstreamResponse.headers) {
      if (key.toLowerCase() === "transfer-encoding") continue;
      editorialHeaders.set(key, value);
    }

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: editorialHeaders,
    });
  } catch (_error) {
    return new Response("Bad Gateway: News Dispatch Failed", { status: 502 });
  }
}


/**
 * Bidirectional WebSocket relay to TARGET_BASE.
 */
function relayWebSocket(request: Request, incomingUrl: URL): Response {
  try {
    const { socket: clientSock, response } = Deno.upgradeWebSocket(request);

    // ساخت URL مقصد ws:// یا wss://
    const wsTargetBase = TARGET_BASE
      .replace(/^https:/, "wss:")
      .replace(/^http:/, "ws:");
    const upstreamWsUrl = wsTargetBase + incomingUrl.pathname + incomingUrl.search;

    const upstreamSock = new WebSocket(upstreamWsUrl);

    let upstreamReady = false;
    const queue: (string | ArrayBufferLike | Blob | ArrayBufferView)[] = [];

    upstreamSock.binaryType = "arraybuffer";
    clientSock.binaryType = "arraybuffer";

    upstreamSock.onopen = () => {
      upstreamReady = true;
      while (queue.length > 0) {
        const item = queue.shift();
        if (item !== undefined) upstreamSock.send(item as any);
      }
    };

    clientSock.onmessage = (ev) => {
      if (upstreamReady) {
        upstreamSock.send(ev.data);
      } else {
        queue.push(ev.data);
      }
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


// Deno Deploy entry point
Deno.serve(newsDispatcher);

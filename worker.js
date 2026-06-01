/**
 * BGM.TV Reverse Proxy — Cloudflare Worker
 *
 * 路由规则：
 *   /api/*  → https://api.bgm.tv/*
 *   /img/*  → https://lain.bgm.tv/*
 *   /*      → https://bgm.tv/*
 *
 * 转发所有请求头（含 Authorization / Cookie / 自定义 Token）
 */

const UPSTREAMS = {
  bgm: "https://bgm.tv",
  api: "https://api.bgm.tv",
  img: "https://lain.bgm.tv",
};

// 需要逐跳转发的头（RFC 2616 §13.5.1），不应转发给上游
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
]);

function resolveUpstream(pathname) {
  if (pathname.startsWith("/api/")) {
    return { base: UPSTREAMS.api, path: pathname.slice(4) }; // /api/xxx → xxx
  }
  if (pathname.startsWith("/img/")) {
    return { base: UPSTREAMS.img, path: pathname.slice(4) }; // /img/xxx → /xxx
  }
  return { base: UPSTREAMS.bgm, path: pathname };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { base: upstream, path } = resolveUpstream(url.pathname);

    // 拼接上游地址，保留原始路径和查询参数
    const upstreamUrl = new URL(path + url.search, upstream);

    // 复制请求头，逐跳头除外
    const headers = new Headers();
    for (const [key, value] of request.headers) {
      if (!HOP_BY_HOP.has(key.toLowerCase())) {
        headers.set(key, value);
      }
    }

    // 确保 Host 指向上游
    headers.set("Host", new URL(upstream).host);

    // 如果原始请求带 Origin，也改写为上游
    if (headers.has("Origin")) {
      headers.set("Origin", upstream);
    }

    // Referer 改写（如果有）
    const referer = headers.get("Referer");
    if (referer) {
      headers.set(
        "Referer",
        referer
          .replace(url.origin + "/api", UPSTREAMS.api)
          .replace(url.origin + "/img", UPSTREAMS.img)
          .replace(url.origin, upstream)
      );
    }

    // 构造上游请求
    const upstreamRequest = new Request(upstreamUrl.toString(), {
      method: request.method,
      headers,
      body: request.body,
      redirect: "manual",
    });

    try {
      const response = await fetch(upstreamRequest);

      // 复制响应头，逐跳头除外
      const responseHeaders = new Headers();
      for (const [key, value] of response.headers) {
        if (!HOP_BY_HOP.has(key.toLowerCase())) {
          responseHeaders.set(key, value);
        }
      }

      // 重写 Location 头中的重定向（上游 → Worker 域名）
      const location = responseHeaders.get("Location");
      if (location) {
        try {
          const loc = new URL(location, upstream);
          if (loc.hostname === "api.bgm.tv") {
            responseHeaders.set("Location", "/api" + loc.pathname + loc.search);
          } else if (loc.hostname === "lain.bgm.tv") {
            responseHeaders.set("Location", "/img" + loc.pathname + loc.search);
          } else if (loc.hostname === "bgm.tv") {
            responseHeaders.set("Location", loc.pathname + loc.search);
          }
        } catch {
          // 相对路径不做处理
        }
      }

      // 重写 Set-Cookie 中的 Domain（如果有）
      const setCookies = response.headers.getAll?.("Set-Cookie");
      if (setCookies && setCookies.length > 0) {
        responseHeaders.delete("Set-Cookie");
        for (const cookie of setCookies) {
          const rewritten = cookie.replace(/;\s*domain=[^;]*/gi, "");
          responseHeaders.append("Set-Cookie", rewritten);
        }
      }

      // 图片资源加长缓存
      if (upstream === UPSTREAMS.img) {
        responseHeaders.set("Cache-Control", "public, max-age=2592000, immutable");
      }

      // CORS 头
      responseHeaders.set("Access-Control-Allow-Origin", "*");
      responseHeaders.set(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, PATCH, DELETE, OPTIONS"
      );
      responseHeaders.set(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-*, *"
      );
      responseHeaders.set("Access-Control-Expose-Headers", "*");

      // OPTIONS 预检请求
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: responseHeaders });
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
      });
    } catch (err) {
      return new Response(`Upstream fetch failed: ${err.message}`, {
        status: 502,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  },
};

/** Optional Clerk proxy: explicit trusted public origin, fixed upstream, no header-derived identity. */
import type { RequestHandler } from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
const CLERK_FAPI = "https://frontend-api.clerk.dev";
export const CLERK_PROXY_PATH = "/api/__clerk";

export function clerkProxyMiddleware(
  origin: string,
  loopbackUpstream?: string,
): RequestHandler {
  const canonical = new URL(origin);
  if (canonical.protocol !== "https:" || canonical.origin !== origin)
    throw new Error("Clerk proxy needs a canonical trusted HTTPS origin");
  if (loopbackUpstream) {
    const target = new URL(loopbackUpstream);
    if (
      target.protocol !== "http:" ||
      !["127.0.0.1", "[::1]"].includes(target.hostname)
    )
      throw new Error("Test upstream must be loopback HTTP");
  }
  // Only run proxy in production — Clerk proxying doesn't work for dev instances
  if (process.env.NODE_ENV !== "production") {
    return (_req, _res, next) => next();
  }

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    return (_req, _res, next) => next();
  }

  return createProxyMiddleware({
    target: loopbackUpstream ?? CLERK_FAPI,
    changeOrigin: true,
    proxyTimeout: 5_000,
    timeout: 10_000,
    // Take over the response so it can be re-sent with a Content-Length (see
    // proxyRes); the deployment edge rejects chunked proxied responses.
    selfHandleResponse: true,
    pathRewrite: (path: string) =>
      path.replace(new RegExp(`^${CLERK_PROXY_PATH}`), ""),
    on: {
      error: (_error, _req, res) => {
        if ("writeHead" in res) {
          if (!res.headersSent) res.writeHead(502, { "content-length": "0" });
          res.end();
        } else res.destroy();
      },
      proxyReq: (proxyReq, req) => {
        proxyReq.removeHeader("x-forwarded-host");
        proxyReq.removeHeader("x-forwarded-proto");
        const proxyUrl = `${origin}${CLERK_PROXY_PATH}`;

        proxyReq.setHeader("Clerk-Proxy-Url", proxyUrl);
        proxyReq.setHeader("Clerk-Secret-Key", secretKey);

        const clientIp = req.socket?.remoteAddress || "";
        if (clientIp) {
          proxyReq.setHeader("X-Forwarded-For", clientIp);
        }
      },
      // Clerk's dynamic Frontend API responses (/v1/environment, /v1/client,
      // JWKS, ...) arrive without a Content-Length, so relaying them would use
      // Transfer-Encoding: chunked — which the deployment edge (Cloud Run)
      // rejects, turning the app's 200 into a 500. Buffer only those so they can
      // be re-sent with a Content-Length; the body is forwarded untouched so
      // Content-Encoding is preserved. Length-known responses (e.g. /npm/*
      // assets) and body-less responses stream through without buffering.
      proxyRes: (proxyRes, req, res) => {
        const headers = { ...proxyRes.headers };
        // Transfer-Encoding/Connection are hop-by-hop (RFC 7230 §6.1).
        delete headers["transfer-encoding"];
        delete headers["connection"];
        delete headers["keep-alive"];

        const status = proxyRes.statusCode ?? 502;
        // Content-Length is forbidden on 1xx/204; HEAD/304 may keep theirs.
        if (status < 200 || status === 204) {
          delete headers["content-length"];
        }

        const bodyless =
          req.method === "HEAD" ||
          status < 200 ||
          status === 204 ||
          status === 304;
        if (headers["content-length"] !== undefined || bodyless) {
          res.writeHead(status, headers);
          // Headers are already sent, so abort the response if the upstream
          // stream errors mid-pipe (e.g. ECONNRESET) rather than leaving an
          // unhandled 'error' or a hung client.
          proxyRes.on("error", () => res.destroy());
          proxyRes.pipe(res);
          return;
        }

        const chunks: Buffer[] = [];
        let size = 0;
        proxyRes.on("data", (chunk: Buffer) => {
          if (res.writableEnded) return;
          size += chunk.byteLength;
          if (size > 2_000_000) {
            res.writeHead(502, { "content-length": "0" });
            res.end();
            proxyRes.destroy();
            return;
          }
          chunks.push(chunk);
        });
        proxyRes.on("end", () => {
          if (res.writableEnded) return;
          const body = Buffer.concat(chunks);
          headers["content-length"] = String(body.length);
          res.writeHead(status, headers);
          res.end(body);
        });
        proxyRes.on("error", () => {
          if (!res.headersSent) {
            // Set a length so the empty 502 isn't sent chunked (which the
            // deployment edge would reject just like the original response).
            res.writeHead(502, { "content-length": "0" });
          }
          res.end();
        });
      },
    },
  }) as RequestHandler;
}

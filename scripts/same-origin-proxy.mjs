import http from "node:http";

const listenPort = Number(process.env.PORT ?? 8080);
const api = new URL(process.env.REVIEWFLOW_API_ORIGIN ?? "http://127.0.0.1:5000");
const web = new URL(process.env.REVIEWFLOW_WEB_ORIGIN ?? "http://127.0.0.1:5173");

function targetFor(path = "/") {
  return path === "/api" || path.startsWith("/api/") ? api : web;
}

const server = http.createServer((request, response) => {
  const target = targetFor(request.url);
  const upstream = http.request({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port,
    method: request.method,
    path: request.url,
    headers: { ...request.headers, host: target.host },
  }, (upstreamResponse) => {
    response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
    upstreamResponse.pipe(response);
  });
  upstream.on("error", (error) => {
    if (!response.headersSent) response.writeHead(502, { "content-type": "text/plain" });
    response.end(`Upstream unavailable: ${error.message}`);
  });
  request.pipe(upstream);
});

server.on("upgrade", (request, socket, head) => {
  const target = targetFor(request.url);
  const upstream = http.request({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port,
    method: request.method,
    path: request.url,
    headers: { ...request.headers, host: target.host },
  });
  upstream.on("upgrade", (response, upstreamSocket, upstreamHead) => {
    socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers)
      .map(([key, value]) => `${key}: ${value}`).join("\r\n")}\r\n\r\n`);
    if (head.length) upstreamSocket.write(head);
    if (upstreamHead.length) socket.write(upstreamHead);
    upstreamSocket.pipe(socket).pipe(upstreamSocket);
  });
  upstream.on("error", () => socket.destroy());
  upstream.end();
});

server.listen(listenPort, "0.0.0.0", () => {
  console.log(`ReviewFlow same-origin proxy listening on http://localhost:${listenPort}`);
});
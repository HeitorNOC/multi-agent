const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { randomBytes, createHash, timingSafeEqual } = require("node:crypto");
const { spawn } = require("node:child_process");

const source = JSON.parse(fs.readFileSync(path.join(__dirname, "../live-panel-01/active.json"), "utf8"));
const upstream = new URL(source.url);
if (upstream.protocol !== "http:" || upstream.hostname !== "127.0.0.1") throw Error("Origem inválida");
const username = "aurora";
const password = randomBytes(18).toString("base64url");
const digest = (value) => createHash("sha256").update(value).digest();
const expected = digest("Basic " + Buffer.from(`${username}:${password}`).toString("base64"));
const session = randomBytes(32).toString("base64url");
const routes = new Set(["/", "/app.js", "/app.css", "/api/state"]);
const approval = "/api/jobs/df894225-5854-40a4-9883-fbded6834b3e/approve";
let publicOrigin;

function login(res, failed = false) {
  res.writeHead(failed ? 401 : 200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
  }).end(`<!doctype html><html lang="pt-BR"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Acesso ao Aurora</title>
<style>body{font:17px system-ui;background:#101923;color:#eee;padding:24px}main{max-width:360px;margin:12vh auto}input,button{display:block;box-sizing:border-box;width:100%;padding:12px;margin:8px 0 18px;font:inherit}</style>
<main><h1>Acesso ao Aurora</h1><p>${failed ? "Senha inválida. Tente novamente." : "Digite a senha do acesso temporário."}</p>
<form method="post" action="/_login"><label>Senha<input name="password" type="password" autocomplete="current-password" required></label><button>Entrar</button></form></main></html>`);
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method === "POST" && req.url === "/_login") {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (body.length > 1024) return res.writeHead(413).end();
    }
    const submitted = new URLSearchParams(body).get("password") || "";
    if (!timingSafeEqual(digest(submitted), digest(password))) return login(res, true);
    return res.writeHead(303, {
      Location: "/",
      "Set-Cookie": `aurora_share=${session}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=7200`,
    }).end();
  }
  const cookie = (req.headers.cookie || "").split(";").find((value) => value.trim().startsWith("aurora_share="));
  const authorized = timingSafeEqual(digest(req.headers.authorization || ""), expected)
    || timingSafeEqual(digest(cookie?.trim() || ""), digest(`aurora_share=${session}`));
  if (!authorized) {
    if (req.method === "GET" && req.url === "/") return login(res);
    res.writeHead(401).end("Acesso protegido");
    return;
  }
  if (req.method === "POST" && req.url === approval && publicOrigin && req.headers.origin === publicOrigin &&
      cookie?.trim() === `aurora_share=${session}`) {
    let raw = "";
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > 1024) return res.writeHead(413).end();
    }
    let hash;
    try { hash = JSON.parse(raw)?.hash; } catch {}
    if (hash !== "fbfe051f9255e812d106a932f3300a9c37b451cf073fe9ecb28772720adade00")
      return res.writeHead(409, {"Content-Type": "application/json"}).end(JSON.stringify({error: "A versão da entrega diverge da revisão pendente."}));
    const body = JSON.stringify({hash});
    const local = http.request(new URL(approval, upstream), {
      method: "POST", timeout: 15_000,
      headers: {origin: upstream.origin, "content-type": "application/json", "content-length": Buffer.byteLength(body)},
    }, (response) => {
      res.writeHead(response.statusCode, {"Content-Type": "application/json"});
      response.pipe(res);
    });
    local.on("timeout", () => local.destroy());
    local.on("error", () => res.writeHead(502, {"Content-Type": "application/json"}).end(JSON.stringify({error: "Painel local indisponível."})));
    local.end(body);
    return;
  }
  if (req.method !== "GET" || !(routes.has(req.url) || /^\/api\/jobs\/[a-f0-9-]{36}\/trace$/.test(req.url))) {
    res.writeHead(403, { "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify({error: "O acesso remoto permite consulta e a aprovação da entrega pendente do que."}));
    return;
  }
  const local = http.get(new URL(req.url, upstream), { timeout: 15_000 }, (response) => {
    res.statusCode = response.statusCode;
    if (response.headers["content-type"]) res.setHeader("Content-Type", response.headers["content-type"]);
    response.pipe(res);
  });
  local.on("timeout", () => local.destroy());
  local.on("error", () => res.writeHead(502).end("Painel local indisponível"));
});

server.listen(0, "127.0.0.1", () => {
  const port = server.address().port;
  const tunnel = spawn(path.join(__dirname, "cloudflared.exe"), [
    "tunnel", "--no-autoupdate", "--protocol", "http2", "--url", `http://127.0.0.1:${port}`,
  ], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  const expiry = setTimeout(() => tunnel.kill(), 2 * 60 * 60 * 1000);
  tunnel.stderr.on("data", (buffer) => {
    const text = buffer.toString("utf8");
    process.stderr.write(text);
    const url = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
    if (url && !fs.existsSync(path.join(__dirname, "access.json"))) {
      publicOrigin = url;
      fs.writeFileSync(path.join(__dirname, "access.json"), JSON.stringify({ url, username, password, expires: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() }));
    }
  });
  tunnel.on("error", (error) => { console.error(error.message); server.close(); clearTimeout(expiry); });
  tunnel.on("exit", () => { server.close(); clearTimeout(expiry); });
});

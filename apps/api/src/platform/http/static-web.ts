/**
 * Serve a interface já construída (`apps/web/dist`). Arquivos de `assets/` têm nome com hash e
 * podem ficar em cache; qualquer outra rota que não seja da API devolve `index.html` (a SPA
 * decide a tela). Caminhos que saiam da pasta são recusados.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, resolve, sep } from "node:path";
import { AppError } from "../../shared/errors.ts";
import type { HttpModule } from "./app.ts";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

const API_PREFIXES = ["/api/", "/internal/"];

export function staticWeb(dir: string): HttpModule {
  const root = resolve(dir);
  const index = join(root, "index.html");
  return (app) => {
    if (!existsSync(index)) return;
    app.get("/*", async (req, reply) => {
      const path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      if (API_PREFIXES.some((p) => path.startsWith(p)) || path === "/api" || path === "/internal")
        throw new AppError("not_found", "route_not_found", "Rota não encontrada");
      const file = resolve(root, `.${path}`);
      const inside = file === root || file.startsWith(root + sep);
      const asset = inside && existsSync(file) && statSync(file).isFile();
      const target = asset ? file : index;
      const type = TYPES[extname(target)] ?? "application/octet-stream";
      if (asset && path.startsWith("/assets/")) reply.header("cache-control", "public, max-age=31536000, immutable");
      return reply.type(type).send(readFileSync(target));
    });
  };
}

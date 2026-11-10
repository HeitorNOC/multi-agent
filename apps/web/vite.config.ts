import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** Em desenvolvimento, `/api` vai para a API local (AURORA_API_URL, padrão porta 4100). */
const api = process.env.AURORA_API_URL ?? "http://127.0.0.1:4100";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: { "/api": { target: api, changeOrigin: true } },
  },
  build: { outDir: "dist", sourcemap: true },
});

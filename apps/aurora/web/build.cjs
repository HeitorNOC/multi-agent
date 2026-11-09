const { join, resolve } = require("node:path");

const root = resolve(__dirname, "../../..");
const output = join(root, "demo-enterprise/dist");
const esbuild = require("esbuild");

const options = {
  bundle: true,
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "eof",
};

for (const [entry, asset] of [
  ["main.tsx", "app.js"],
  ["recovery-main.tsx", "recovery.js"],
]) {
  esbuild.buildSync({
    ...options,
    entryPoints: [join(__dirname, entry)],
    outfile: join(output, asset),
  });
}

import { createRequire } from "node:module";
const require = createRequire(
  new URL("../artifacts/reviewflow/package.json", import.meta.url),
);
const { createServer } = await import(require.resolve("vite"));
const server = await createServer({
  configFile: "artifacts/reviewflow/vite.config.ts",
});
await server.listen();
process.send?.({ type: "listening", host: "127.0.0.1", port: 5283 });
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"])
  process.once(signal, async () => {
    await server.close();
    process.exit(0);
  });

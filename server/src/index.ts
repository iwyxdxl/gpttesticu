import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { publicApi } from "./routes/public.js";
import { adminApi } from "./routes/admin.js";

const app = new Hono();
app.use(
  "/api/*",
  bodyLimit({
    maxSize: 13 * 1024 * 1024,
    onError: (c) => c.json({ error: "请求体过大" }, 413),
  }),
);
app.use("/api/*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  await next();
});

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "服务器开小差了，稍后再试" }, 500);
});

app.get("/api/health", (c) => c.json({ ok: true }));
app.route("/api", publicApi);
app.route("/api/admin", adminApi);

// 静态资源（生产环境：前端产物在 ./public）
app.use("*", serveStatic({ root: "./public" }));
// SPA 回退：非 /api 的未知路径回 index.html；/api 未知路径返回 404 JSON
app.get("*", async (c) => {
  if (c.req.path.startsWith("/api/"))
    return c.json({ error: "Not Found" }, 404);
  const res = await serveStatic({ root: "./public", path: "index.html" })(
    c,
    async () => {},
  );
  return res ?? c.notFound();
});

const port = Number(process.env.PORT || 8787);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`gpttest.icu server listening on http://localhost:${info.port}`);
});

import { defineConfig } from "@playwright/test";
import { tmpdir } from "node:os";
import { join } from "node:path";
process.env.E2E_DB_PATH ??= join(tmpdir(), `gpttest-e2e-${process.pid}.db`);
export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:15173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "npm run build && node dist/index.js",
      cwd: "../server",
      url: "http://127.0.0.1:18787/api/health",
      env: {
        PORT: "18787",
        DB_PATH: process.env.E2E_DB_PATH,
        ADMIN_PASSWORD: "qa-local-password-only",
        TRUST_PROXY: "0",
      },
      reuseExistingServer: false,
    },
    {
      command: "npm run dev -- --host 127.0.0.1 --port 15173 --strictPort",
      url: "http://127.0.0.1:15173",
      env: { API_TARGET: "http://127.0.0.1:18787" },
      reuseExistingServer: false,
    },
    {
      command: "node ../scripts/mock-relay.mjs",
      url: "http://127.0.0.1:19797/v1/models",
      env: { MOCK_PORT: "19797" },
      reuseExistingServer: false,
    },
  ],
});

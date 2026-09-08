import { test, expect } from "@playwright/test";

// Run quota-exhaustion checks after the other browser/API scenarios.
test("rate limits reject repeated events and cannot be bypassed with spoofed forwarded IP", async ({
  request,
}) => {
  let limited = false;
  for (let i = 0; i < 65; i++) {
    const r = await request.post("/api/stats/test", {
      headers: { "X-Forwarded-For": `192.0.2.${i}` },
      data: { verdict: "unknown", ran_full: false },
    });
    if (r.status() === 429) limited = true;
  }
  expect(limited).toBe(true);
  const started = Date.now();
  const fail = await request.post("/api/admin/login", {
    data: { password: "wrong" },
  });
  expect(fail.status()).toBe(401);
  expect(Date.now() - started).toBeGreaterThanOrEqual(550);
  let loginLimited = false;
  for (let i = 0; i < 11; i++) {
    const r = await request.post("/api/admin/login", {
      data: { password: "qa-local-password-only" },
    });
    if (r.status() === 429) loginLimited = true;
  }
  expect(loginLimited).toBe(true);
});

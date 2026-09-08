import type { Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";

const buckets = new Map<string, { count: number; reset: number }>();

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset <= now) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    if (buckets.size > 10000) {
      for (const [k, v] of buckets) if (v.reset <= now) buckets.delete(k);
    }
    return true;
  }
  b.count += 1;
  return b.count <= limit;
}

const TRUST_PROXY = process.env.TRUST_PROXY === "1";

export function clientIp(c: Context): string {
  if (TRUST_PROXY) {
    const fwd = c.req.header("x-forwarded-for");
    if (fwd) return fwd.split(",").at(-1)!.trim();
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  judge,
  takeSample,
  shouldStopSampling,
  highlightSegments,
} from "../web/src/lib/judge.ts";
import { normalizeBaseUrl, streamResponses } from "../web/src/lib/stream.ts";
import { sanitizeUserHtml } from "../server/src/sanitize.ts";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

test("sampling preserves raw text and waits for the third complete paragraph", () => {
  assert.equal(shouldStopSampling("一\n\n二\n三", 3, 2000), false);
  assert.equal(shouldStopSampling("一\n\n二\n三\n多余正常词", 3, 2000), true);
  assert.deepEqual(takeSample("一\n\n二\n三\n尾部", 3, 2000), {
    sample: "一\n\n二\n三\n",
    stoppedBy: "paragraphs",
  });
  assert.equal(takeSample("一\n二\n三", 3, 2000).stoppedBy, "end");
});
test("character limit counts original whitespace and wins if reached first", () => {
  assert.deepEqual(takeSample("   ab\nnormal", 3, 5), {
    sample: "   ab",
    stoppedBy: "chars",
  });
  assert.equal(takeSample("x".repeat(2000), 3, 2000).stoppedBy, "chars");
  assert.equal(
    takeSample("一\r\n二\r\n三\r\n尾", 3, 2000).sample,
    "一\r\n二\r\n三\r\n",
  );
});
test("case-insensitive repeated scoring, ties, empty lists and literal highlights", () => {
  assert.equal(judge("svg SVG normal", ["SVG"], ["normal"]).verdict, "dumbed");
  assert.equal(judge("svg normal", ["SVG"], ["normal"]).verdict, "unknown");
  assert.equal(judge("something", [], []).verdict, "unknown");
  assert.equal(judge("踩踏 踩踏", [], ["踩踏"]).normalScore, 2);
  assert.deepEqual(
    highlightSegments("a+b (hi)", ["a+b"], [])
      .map((s) => s.text)
      .join(""),
    "a+b (hi)",
  );
});
test("endpoint normalization and rejection of malformed/privacy-sensitive URLs", () => {
  assert.equal(
    normalizeBaseUrl(" example.com/v1/// ").base,
    "https://example.com/v1",
  );
  assert.equal(
    normalizeBaseUrl("http://localhost:9797").base,
    "http://localhost:9797/v1",
  );
  assert.equal(
    normalizeBaseUrl("https://example.com/v1/responses").base,
    "https://example.com/v1",
  );
  for (const url of [
    "",
    "https://a b",
    "javascript:alert(1)",
    "https://user:pass@site.com/v1",
    "https://site.com?key=secret",
    "https://site.com/#secret",
  ])
    assert.throws(() => normalizeBaseUrl(url));
});
const malicious = `<script>alert(1)</script><img src="//evil.test/x" onerror="alert(1)"><a href="&#106;avascript:alert(1)">x</a><svg xmlns="http://www.w3.org/2000/svg"><foreignObject><iframe src="https://evil.test"></iframe></foreignObject><use href="/relative.svg#x"/><animate attributeName="href" values="https://evil.test"/><circle onload="alert(1)" r="4"/><use href="#safe"/></svg><style>@import 'https://evil.test';.x{background:url(https://evil.test)}</style>`;
test("upload sanitization removes scripts, handlers, all external/relative links, foreign namespaces and mutable href", () => {
  const result = sanitizeUserHtml(malicious);
  assert.doesNotMatch(
    result,
    /<script|onerror=|onload=|<iframe|<foreignObject|href="(?:javascript|\/)|attributeName="href"/i,
  );
  assert.doesNotMatch(result, /@import|url\(https/i);
  assert.match(result, /href="#safe"/);
});
test("CSS escapes cannot hide network access; safe CSS variables and SMIL are retained", () => {
  assert.doesNotMatch(
    sanitizeUserHtml("<style>.x{background:u\\72l(https://evil.test)}</style>"),
    /background/,
  );
  const safe = sanitizeUserHtml(
    '<style>:root{--paint:red}.x{fill:var(--paint);animation:spin 2s infinite}@keyframes spin{to{opacity:.5}}</style><svg><circle r="10"><animate attributeName="r" values="10;20;10" dur="2s" repeatCount="indefinite"/></circle></svg>',
  );
  assert.match(safe, /--paint:red/);
  assert.match(safe, /<animate/);
});
test("reference is an animated script-free derivative of the supplied sample", () => {
  const html = readFileSync(
    new URL(
      "../server/src/assets/pelican-bike_gpt6astra_low.html",
      import.meta.url,
    ),
    "utf8",
  );
  assert.doesNotMatch(html, /<script/);
  assert.match(html, /animateTransform/);
  assert.match(sanitizeUserHtml(html), /id="nearLeg"[^>]*d="M/);
});
test("prompt snapshot checksum matches the recorded source", () => {
  const base = new URL("../server/src/assets/", import.meta.url);
  const source = JSON.parse(
    readFileSync(new URL("codex-prompt-source.json", base), "utf8"),
  );
  assert.equal(
    createHash("sha256")
      .update(readFileSync(new URL("codex-system-prompt.md", base)))
      .digest("hex"),
    source.sha256,
  );
});
async function fakeStream(
  chunks: string[],
  callback: (full: string, ac: AbortController) => void = () => {},
) {
  const original = globalThis.fetch;
  const ac = new AbortController();
  let count = 0;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body.reasoning, { effort: "low" });
    assert.equal(init?.credentials, "omit");
    return new Response(
      new ReadableStream({
        start(c) {
          for (const s of chunks) c.enqueue(new TextEncoder().encode(s));
          c.close();
        },
      }),
    );
  };
  try {
    return await streamResponses({
      base: "https://relay.test/v1",
      apiKey: "test",
      model: "test",
      instructions: "test",
      input: "test",
      signal: ac.signal,
      onDelta: (_d, full) => {
        count++;
        callback(full, ac);
      },
    });
  } finally {
    globalThis.fetch = original;
  }
}
test("SSE supports multiline data, split CRLF frames and UTF-8 text", async () => {
  const r = await fakeStream([
    'data: {"type":"response.output_text.delta",\r\ndata: "delta":"踩踏"}\r',
    "\n\r\n",
    'data: {"type":"response.completed"}\r\n\r\n',
  ]);
  assert.equal(r.text, "踩踏");
  assert.equal(r.completed, true);
});
test("sampling abort stops other events already buffered in the same network chunk", async () => {
  const seen: string[] = [];
  await assert.rejects(
    fakeStream(
      [
        'data: {"type":"response.output_text.delta","delta":"first"}\n\ndata: {"type":"response.output_text.delta","delta":"unwanted"}\n\n',
      ],
      (s, ac) => {
        seen.push(s);
        ac.abort();
      },
    ),
    /已断开/,
  );
  assert.deepEqual(seen, ["first"]);
});
test("empty, truncated, failed and incomplete responses never masquerade as successful generations", async () => {
  for (const event of [
    'data: {"type":"response.completed"}\n\n',
    'data: {"type":"response.output_text.delta","delta":"partial"}\n\n',
    'data: {"type":"response.incomplete"}\n\n',
    'data: {"type":"response.failed"}\n\n',
  ])
    await assert.rejects(fakeStream([event]));
});

test("HTTP errors retain status, request ID and complete JSON/HTML/plain/empty bodies", async () => {
  const { readJsonResponse, RequestError } =
    await import("../web/src/lib/errors.ts");
  for (const raw of [
    '{"error":{"message":"denied","code":"blocked","details":{"trace":"trace-end"}},"extra":"retained"}',
    "<html>Bad Gateway\n<script>example()</script></html>",
    "start\n" + "x".repeat(6000) + "\nend",
    "",
  ]) {
    await assert.rejects(
      readJsonResponse(
        new Response(raw, {
          status: 502,
          statusText: "Bad Gateway",
          headers: { "x-request-id": "request-123" },
        }),
      ),
      (error: unknown) => {
        assert.ok(error instanceof RequestError);
        assert.equal(error.status, 502);
        assert.match(error.message, /HTTP 502 Bad Gateway/);
        assert.match(error.message, /x-request-id: request-123/);
        assert.ok(error.message.endsWith(raw || "（响应体为空）"));
        return true;
      },
    );
  }
});
test("invalid JSON success responses preserve the raw body and parsing error", async () => {
  const { readJsonResponse } = await import("../web/src/lib/errors.ts");
  await assert.rejects(
    readJsonResponse(new Response("<html>maintenance</html>", { status: 200 })),
    (error: any) => {
      assert.match(error.message, /HTTP 200/);
      assert.match(error.message, /SyntaxError/);
      assert.match(error.message, /<html>maintenance<\/html>/);
      return true;
    },
  );
});
test("SSE failures, incomplete details, event-name errors and malformed JSON retain full payloads", async () => {
  for (const data of [
    '{"type":"response.failed","response":{"error":{"message":"failed","code":"quota","param":"model"}},"request_id":"sse-123"}',
    '{"type":"response.incomplete","response":{"incomplete_details":{"reason":"limit","extra":"retained"}}}',
    '{"message":"flat message","code":"vendor_busy","extra":"keep-me"}',
    '{"broken":invalid}',
  ])
    await assert.rejects(
      fakeStream([`event: error\ndata: ${data}\n\n`]),
      (error: any) => {
        assert.ok(error.message.includes(data));
        return true;
      },
    );
});
test("models HTTP failures, invalid shapes and network exceptions keep their original diagnostics", async () => {
  const { fetchModels } = await import("../web/src/lib/stream.ts");
  const original = globalThis.fetch;
  try {
    for (const status of [200, 403]) {
      const raw =
        '{"error":"forbidden","code":"upstream_policy","request_id":"models-123"}';
      globalThis.fetch = async () => new Response(raw, { status });
      await assert.rejects(
        fetchModels("https://relay.test/v1", "key"),
        (e: any) => {
          assert.ok(e.message.includes(raw));
          assert.ok(e.message.includes(`HTTP ${status}`));
          return true;
        },
      );
    }
    globalThis.fetch = async () => {
      throw new TypeError("network diagnostic original", {
        cause: new Error("root cause original"),
      });
    };
    await assert.rejects(
      fetchModels("https://relay.test/v1", "key"),
      (e: any) => {
        assert.match(e.message, /TypeError: network diagnostic original/);
        assert.match(e.message, /root cause original/);
        return true;
      },
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("unexpected non-SSE response preserves the full upstream error body", async () => {
  const original = globalThis.fetch;
  try {
    const raw =
      '{"error":{"message":"not a stream","code":"provider_error"},"details":"full"}';
    globalThis.fetch = async () =>
      new Response(raw, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    await assert.rejects(
      streamResponses({
        base: "https://relay.test/v1",
        apiKey: "test",
        model: "test",
        instructions: "test",
        input: "test",
        signal: new AbortController().signal,
        onDelta: () => {},
      }),
      (e: any) => {
        assert.ok(e.message.endsWith(raw));
        assert.match(e.message, /HTTP 200/);
        return true;
      },
    );
  } finally {
    globalThis.fetch = original;
  }
});

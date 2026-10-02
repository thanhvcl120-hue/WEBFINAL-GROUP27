import { test } from "node:test";
import assert from "node:assert/strict";
import { callApi } from "./staff-api.js";

test("API contract, errors and expired session behavior", async () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  let expired = 0;
  globalThis.window = { dispatchEvent: event => { if (event.type === "staff-session-expired") expired++; } };
  try {
    globalThis.fetch = async (url, options) => {
      assert.equal(url, "/api/sessions/42/pay");
      assert.equal(options.method, "POST");
      assert.equal(options.headers["Content-Type"], "application/json");
      assert.deepEqual(JSON.parse(options.body), { method: "cash" });
      return new Response(JSON.stringify({ id: 42, status: "closed" }));
    };
    assert.equal((await callApi("/sessions/42/pay", { method: "POST", body: JSON.stringify({ method: "cash" }) })).status, "closed");
    globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
    await assert.rejects(callApi("/menu"), /Không thể kết nối đến máy chủ/);
    globalThis.fetch = async () => new Response("Bad Gateway", { status: 502 });
    await assert.rejects(callApi("/menu"), /Không thể kết nối/);
    globalThis.fetch = async () => new Response("<html>proxy error</html>");
    await assert.rejects(callApi("/menu"), /dữ liệu không hợp lệ/);
    globalThis.fetch = async () => new Response(JSON.stringify({ error: "Chưa đăng nhập." }), { status: 401 });
    await assert.rejects(callApi("/tables"), { status: 401 });
    assert.equal(expired, 1);
    await assert.rejects(callApi("/auth/login"), { status: 401 });
    assert.equal(expired, 1);
    const abort = new DOMException("Aborted", "AbortError");
    globalThis.fetch = async () => { throw abort; };
    await assert.rejects(callApi("/menu"), problem => problem === abort);
  } finally { globalThis.fetch = originalFetch; globalThis.window = originalWindow; }
});

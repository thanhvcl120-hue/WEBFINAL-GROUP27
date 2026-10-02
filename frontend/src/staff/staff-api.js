// Shared helpers for the staff screens (login, cashier, menu management).
// Kept apart from main.jsx so the customer-facing UI stays untouched.
import { useCallback, useEffect, useRef, useState } from "react";

export const API = "/api";
export const ROLE_LABELS = { kitchen: "Bếp", cashier: "Thu ngân", manager: "Quản lý" };
export const PAYMENT_METHODS = [
  { id: "cash", label: "Tiền mặt" },
  { id: "transfer", label: "Chuyển khoản" },
  { id: "card", label: "Thẻ" },
];

export const money = value => `${Math.round(value || 0).toLocaleString("vi-VN")}đ`;
export const clock = value => value ? new Date(value).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }) : "";

export function minutesSince(value) {
  if (!value) return 0;
  return Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
}

// The staff session is a signed cookie, so plain fetch already carries it.
export async function callApi(path, options = {}) {
  let response;
  try { response = await fetch(`${API}${path}`, {
    ...options,
    headers: options.body ? { "Content-Type": "application/json", ...options.headers } : options.headers,
  }); } catch (problem) {
    if (problem.name === "AbortError") throw problem;
    throw new Error("Không thể kết nối đến máy chủ. Vui lòng thử lại.");
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.error || "Không thể kết nối. Vui lòng thử lại.");
    error.status = response.status;
    if (response.status === 401 && path !== "/auth/login" && path !== "/auth/me") window.dispatchEvent(new Event("staff-session-expired"));
    throw error;
  }
  if (data === null) throw new Error("Máy chủ trả về dữ liệu không hợp lệ. Vui lòng thử lại.");
  return data;
}

/** Who is signed in: undefined while checking, null when signed out. */
export function useStaff() {
  const [staff, setStaff] = useState(undefined);
  const [error, setError] = useState("");
  const request = useRef(null);
  const updateStaff = useCallback(value => { request.current?.abort(); setStaff(value); setError(""); }, []);
  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    try {
      const value = await callApi("/auth/me", { signal: controller.signal });
      if (!controller.signal.aborted) { setStaff(value); setError(""); }
    } catch (problem) {
      if (controller.signal.aborted) return;
      if (problem.status === 401) { setStaff(null); setError(""); }
      else setError(problem.message);
    }
  }, []);
  useEffect(() => {
    refresh();
    const expire = () => updateStaff(null);
    window.addEventListener("staff-session-expired", expire);
    window.addEventListener("focus", refresh);
    return () => { request.current?.abort(); window.removeEventListener("staff-session-expired", expire); window.removeEventListener("focus", refresh); };
  }, [refresh, updateStaff]);
  return { staff, setStaff: updateStaff, refresh, error };
}

/** Re-run `onEvent` whenever the server pushes one of `events`. */
export function useLiveUpdates(events, onEvent) {
  const [connection, setConnection] = useState("connecting");
  const handler = useRef(onEvent);
  handler.current = onEvent;
  useEffect(() => {
    setConnection("connecting");
    const source = new EventSource(`${API}/events`);
    source.addEventListener("connected", () => setConnection("live"));
    source.onerror = () => setConnection("connecting");
    const listener = () => handler.current();
    // "connected" also fires after a dropped connection, so data resyncs itself.
    ["connected", ...events].forEach(name => source.addEventListener(name, listener));
    return () => source.close();
  }, [events.join("|")]);
  return connection;
}

/** Abort outdated reads so a slow response cannot replace a newer SSE refresh. */
export function useResource(path, initialValue) {
  const [data, setData] = useState(initialValue);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const request = useRef(null);
  const load = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController(); request.current = controller;
    try {
      const next = await callApi(path, { signal: controller.signal });
      if (!controller.signal.aborted) { setData(next); setError(""); }
      return next;
    } catch (problem) {
      if (!controller.signal.aborted) setError(problem.message);
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }, [path]);
  useEffect(() => { load(); return () => request.current?.abort(); }, [load]);
  return { data, setData, loading, error, load };
}

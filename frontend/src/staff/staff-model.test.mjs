import { test } from "node:test";
import assert from "node:assert/strict";
import { billFingerprint, billLines, plain } from "./staff-model.js";

const item = (price, quantity = 1, name = "Phở bò") => ({ menu_item_id: 1, name, price, quantity });
test("search handles upper/lowercase Vietnamese Đ and accents", () => {
  assert.equal(plain("ĐỒ UỐNG"), "do uong");
  assert.equal(plain("Phở bò"), "pho bo");
});
test("bill keeps historical prices in separate rows, excludes cancellations", () => {
  const lines = billLines({ orders: [
    { status: "completed", items: [item(45000, 2)] },
    { status: "pending", items: [item(49000, 1), item(45000, 1)] },
    { status: "cancelled", items: [item(49000, 100)] },
  ] });
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map(line => [line.price, line.quantity, line.subtotal]), [[45000, 3, 135000], [49000, 1, 49000]]);
});
test("bill preserves names if a dish was renamed between orders", () => {
  assert.equal(billLines({ orders: [{ status: "pending", items: [item(45000), item(45000, 1, "Phở đặc biệt")] }] }).length, 2);
});
test("empty or cancelled-only bill has no billable rows", () => {
  assert.deepEqual(billLines({ orders: [] }), []);
  assert.deepEqual(billLines({ orders: [{ status: "cancelled", items: [item(45000)] }] }), []);
});
test("confirmation fingerprint detects same-total item changes and closed session", () => {
  const original = { status: "open", total: 45000, pendingCount: 1, orders: [{ status: "pending", items: [item(45000)] }] };
  assert.notEqual(billFingerprint(original), billFingerprint({ ...original, status: "closed" }));
  assert.notEqual(billFingerprint(original), billFingerprint({ ...original, orders: [{ status: "pending", items: [item(45000, 1, "Bún bò")] }] }));
  assert.notEqual(billFingerprint(original), billFingerprint({ ...original, pendingCount: 0 }));
});

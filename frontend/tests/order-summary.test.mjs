import test from "node:test";
import assert from "node:assert/strict";
import { summarizeOrders } from "../src/order-summary.js";

const dish = (id, quantity, price = 65000) => ({
  menu_item_id:id, name:id === 1 ? "Phở Bò Tái" : "Nem Rán",
  image:"https://example.com/food.jpg", quantity, price,
});
const order = (id, status, items, tableNumber = 5) => ({id, status, items, tableNumber});

test("combines repeated calls, keeps served food, excludes cancelled/other tables", () => {
  const orders = [
    order(1, "pending", [dish(1, 1)]),
    order(2, "completed", [dish(1, 2), dish(4, 2, 42000)]),
    order(3, "cancelled", [dish(1, 10)]),
    order(4, "ready", [dish(1, 8)], 6),
  ];
  const result = summarizeOrders(orders, 5);
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0].quantity, 3);
  assert.equal(result.items[0].subtotal, 195000);
  assert.equal(result.items[0].image, "https://example.com/food.jpg");
  assert.equal(result.total, 279000);
});
test("uses the historical line prices even when prices changed", () => {
  const result = summarizeOrders([
    order(1, "pending", [dish(1, 1, 65000)]),
    order(2, "ready", [dish(1, 2, 70000)]),
  ], 5);
  assert.equal(result.items[0].quantity, 3);
  assert.deepEqual(result.items[0].prices, [65000, 70000]);
  assert.equal(result.total, 205000);
});
test("does not count duplicate responses or unselected tables", () => {
  const a = order(1, "preparing", [dish(1, 1)]);
  assert.equal(summarizeOrders([a, a], 5).total, 65000);
  assert.deepEqual(summarizeOrders([a], null), {items:[], total:0});
  assert.equal(summarizeOrders([{...a, status:"cancelled"}], 5).total, 0);
});

test("drops orders from a seating the cashier already settled", () => {
  const previous = {...order(1, "completed", [dish(1, 2)]), sessionId: 1, sessionStatus: "closed"};
  const current = {...order(2, "pending", [dish(4, 1, 42000)]), sessionId: 2, sessionStatus: "open"};
  const result = summarizeOrders([previous, current], 5);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, 4);
  assert.equal(result.total, 42000);
  // Nothing left of the previous seating once its only order is settled.
  assert.deepEqual(summarizeOrders([previous], 5), {items: [], total: 0});
});

// Only combine this device's fetched orders for the selected table.
// Use immutable order prices, never today's menu price, for the subtotal.
export function summarizeOrders(orders, tableNumber) {
  const grouped = new Map();
  const seenOrders = new Set();
  for (const order of orders) {
    // Orders from a seating the cashier already settled must never reappear
    // on the next guests' bill, even though this device still knows their ids.
    if (seenOrders.has(order.id) || order.status === "cancelled" ||
        order.sessionStatus === "closed" || order.tableNumber !== tableNumber) continue;
    seenOrders.add(order.id);
    for (const item of order.items) {
      const id = item.menu_item_id;
      if (!grouped.has(id)) grouped.set(id, {
        id, name: item.name, image: item.image, quantity: 0, subtotal: 0, prices: [],
      });
      const row = grouped.get(id);
      row.quantity += item.quantity;
      row.subtotal += item.price * item.quantity;
      if (!row.prices.includes(item.price)) row.prices.push(item.price);
      if (!row.image && item.image) row.image = item.image;
    }
  }
  const items = [...grouped.values()];
  return {items, total: items.reduce((sum, item) => sum + item.subtotal, 0)};
}

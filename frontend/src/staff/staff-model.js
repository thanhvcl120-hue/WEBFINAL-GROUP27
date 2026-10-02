export const plain = text => (text || "").normalize("NFD").replace(/\p{M}/gu, "").replace(/[đĐ]/g, "d").toLowerCase();

// Preserve each order's historical price, including price changes between rounds.
export function billLines(bill) {
  const lines = new Map();
  for (const order of bill.orders) {
    if (order.status === "cancelled") continue;
    for (const item of order.items) {
      const key = `${item.menu_item_id}:${item.price}:${item.name}`;
      if (!lines.has(key)) lines.set(key, { key, name: item.name, price: item.price, quantity: 0, subtotal: 0 });
      const line = lines.get(key);
      line.quantity += item.quantity;
      line.subtotal += item.price * item.quantity;
    }
  }
  return [...lines.values()];
}

export const billFingerprint = bill => JSON.stringify([bill.status, bill.total, bill.pendingCount, billLines(bill)]);

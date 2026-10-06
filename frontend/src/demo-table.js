// Accept  only whole table numbers from 1 to 12, including numeric input strings.
export function parseDemoTable(value) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const table = Number(value);
  return Number.isInteger(table) && table >= 1 && table <= 12 ? table : null;
}

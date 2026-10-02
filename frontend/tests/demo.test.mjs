import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parseDemoTable } from '../src/demo-table.js';

const source = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
test('demo accepts every table from 1 to 12 and rejects invalid input', () => {
  for (let n = 1; n <= 12; n++) assert.equal(parseDemoTable(String(n)), n);
  for (const value of ['', '0', '13', '-1', '1.5', '1e1', 'abc', ' ', 'Infinity', '2.0', null, undefined]) {
    assert.equal(parseDemoTable(value), null);
  }
});
test('demo button and QR use the same table; invalid input cannot navigate', () => {
  const body = source.split('function Demo() {')[1].split('  return <main')[0];
  for (const input of ['1', '7', '12', '', '0', '13', '2.5']) {
    const calls = [];
    const context = {
      parseDemoTable, AppContext: {}, useNavigate: () => path => calls.push(path),
      useContext: () => ({setTable: n => calls.push(n)}), useState: () => [input, () => {}],
      window: {location: {origin: 'https://restaurant.example'}},
    };
    const url = vm.runInNewContext(body + '\nopen(); menuUrl;', context);
    const n = parseDemoTable(input);
    assert.deepEqual(calls, n === null ? [] : [n, `/menu?table=${n}`]);
    assert.equal(url, n === null ? null : `https://restaurant.example/menu?table=${n}`);
  }
});
test('bill footer is guarded by a nonempty item list', () => {
  assert.match(source, /\{items\.length > 0 && <footer className="bill-total">/);
});

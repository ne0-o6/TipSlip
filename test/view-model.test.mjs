import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

async function loadKit() {
  const source = await readFile(new URL('../templates/_shared/receipt-kit.js', import.meta.url), 'utf8');
  const window = {};
  const document = { readyState: 'loading', addEventListener() {} };
  vm.runInNewContext(source, { window, document });
  return window.ReceiptKit;
}

const payments = JSON.parse(await readFile(new URL('../templates/_shared/payments.json', import.meta.url), 'utf8'));
const kit = await loadKit();

// Objects built inside the vm context have a foreign prototype; round-trip them for deepEqual.
const plain = (value) => JSON.parse(JSON.stringify(value));

test('groups gifts by companion and keeps per-gift quantities', async () => {
  const data = JSON.parse(await readFile(new URL('../examples/sample-multi.json', import.meta.url), 'utf8'));
  const model = kit.normalize(data, { payments });

  assert.equal(model.groups.length, 2);
  assert.deepEqual(plain(model.groups.map((g) => g.short)), ['小羽', '星野']);
  assert.deepEqual(plain(model.groups[1].items.map((i) => [i.name, i.qty, i.amount])), [
    ['客製打賞', '×1', '220 ASD'],
    ['語音陪玩（一小時）', '×3', '900 ASD'],
  ]);
  assert.equal(model.groups[1].subtotal, '1,120 ASD');
  assert.equal(model.recipientCount, 2);
  assert.equal(model.multi, true);
  assert.equal(model.toShortList, '小羽、星野');
});

test('resolves payment keys, labels and unknown methods', () => {
  assert.equal(kit.normalize({ payment: 'jkopay' }, { payments }).status, '打賞已使用街口支付付款');
  assert.equal(kit.normalize({ payment: '街口支付' }, { payments }).payment, '街口支付');
  assert.equal(kit.normalize({ payment: 'LINE Pay' }, { payments }).status, '打賞已使用LINE Pay付款');
  assert.equal(kit.normalize({ payment: 'jkopay', status: '自訂狀態' }, { payments }).status, '自訂狀態');
});

test('formats totals per payment method with overrides', () => {
  assert.equal(kit.normalize({ total: 1560 }, { payments }).total, 'NT$1,560');
  assert.equal(kit.normalize({ payment: 'crypto', total: 35.5 }, { payments }).total, '35.5 USDT');
  assert.equal(kit.normalize({ payment: 'usd_transfer', total: 20 }, { payments }).total, 'US$20');
  assert.equal(kit.normalize({ payment: 'crypto', currency: 'ETH ', total: 1 }, { payments }).total, 'ETH 1');
  assert.equal(kit.normalize({ totalFormat: '{amount} 元', total: 99 }, { payments }).total, '99 元');
});

test('omits optional fields instead of inventing them', () => {
  const model = kit.normalize({ items: [{ to: '@a', amount: 1 }] }, { payments });
  assert.equal(model.balance, '');
  assert.equal(model.total, '');
  assert.equal(model.status, '');
  assert.equal(model.items[0].name, '打賞');
  assert.equal(model.items[0].qty, '');
});

test('formats time in the requested zone and passes free-form text through', () => {
  const time = kit.formatTime('2026-09-30T05:24:00+08:00', 'Asia/Taipei');
  assert.equal(time.text, '2026/09/30（三）上午 05:24');
  assert.equal(time.stamp, '2026. 9.30');
  assert.equal(kit.formatTime('2026-09-29T21:24:00Z', 'Asia/Taipei').clock, '05:24');
  assert.equal(kit.formatTime('今天 上午 05:24', 'Asia/Taipei').text, '今天 上午 05:24');
});

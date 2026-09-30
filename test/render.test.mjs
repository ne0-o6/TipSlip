import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, describe, test } from 'node:test';
import { createServer } from '../src/server.mjs';
import { ReceiptRenderer, RenderError, listTemplates } from '../src/renderer.mjs';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const sample = JSON.parse(await readFile(new URL('../examples/sample-multi.json', import.meta.url), 'utf8'));
const edge = JSON.parse(await readFile(new URL('./fixtures/edge.json', import.meta.url), 'utf8'));

const pngSize = (png) => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) });

const templates = await listTemplates();
const renderer = new ReceiptRenderer({ concurrency: 3 });
after(() => renderer.close());

test('every template has a unique id and code', () => {
  assert.ok(templates.length >= 6);
  assert.equal(new Set(templates.map((t) => t.id)).size, templates.length);
  assert.equal(new Set(templates.map((t) => t.code)).size, templates.length);
  for (const t of templates) assert.ok(t.name && t.width, `${t.id} meta is incomplete`);
});

describe('rendering', () => {
  for (const template of templates) {
    test(`${template.code} ${template.id} renders sample and edge data`, async () => {
      for (const data of [sample, edge]) {
        const png = await renderer.render(template.id, data);
        assert.ok(png.subarray(0, 8).equals(PNG_SIGNATURE));
        assert.equal(pngSize(png).width, template.width * 2);
      }
    });
  }

  test('accepts a template code in any case', async () => {
    const png = await renderer.render('a', sample, { scale: 1 });
    assert.equal(pngSize(png).width, 400);
  });

  test('rejects unknown templates and malformed data', async () => {
    await assert.rejects(renderer.render('nope', sample), { code: 'UNKNOWN_TEMPLATE' });
    await assert.rejects(renderer.render('thermal', []), RenderError);
    await assert.rejects(renderer.render('thermal', { items: 'x' }), { code: 'INVALID_DATA' });
    await assert.rejects(renderer.render('thermal', { timeZone: 'Mars/Base' }), { code: 'INVALID_DATA' });
    await assert.rejects(renderer.render('thermal', { payer: 'x'.repeat(500) }), { code: 'INVALID_DATA' });
  });
});

describe('http service', () => {
  let server;
  let base;

  before(async () => {
    server = createServer({ renderer });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => new Promise((resolve) => server.close(resolve)));

  test('lists templates and payments', async () => {
    const templates = await (await fetch(`${base}/templates`)).json();
    assert.ok(templates.some((t) => t.id === 'thermal' && t.code === 'A'));
    const payments = await (await fetch(`${base}/payments`)).json();
    assert.ok(payments.some((p) => p.key === 'ctbc_cardless' && p.label === '中信無卡'));
  });

  test('renders a PNG', async () => {
    const res = await fetch(`${base}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template: 'ticket', data: sample }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/png');
    assert.ok(Buffer.from(await res.arrayBuffer()).subarray(0, 8).equals(PNG_SIGNATURE));
  });

  test('reports errors as JSON', async () => {
    const unknown = await fetch(`${base}/render`, { method: 'POST', body: JSON.stringify({ template: 'nope', data: {} }) });
    assert.equal(unknown.status, 404);
    assert.equal((await unknown.json()).error.code, 'UNKNOWN_TEMPLATE');

    const broken = await fetch(`${base}/render`, { method: 'POST', body: '{' });
    assert.equal(broken.status, 400);
    assert.equal((await broken.json()).error.code, 'INVALID_JSON');
  });

  test('does not serve files outside the static folders', async () => {
    assert.equal((await fetch(`${base}/package.json`)).status, 404);
    assert.equal((await fetch(`${base}/templates/..%2F..%2Fpackage.json`)).status, 404);
    assert.equal((await fetch(`${base}/templates/thermal/index.html`)).status, 200);
  });
});

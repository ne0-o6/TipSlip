#!/usr/bin/env node
// Regenerates the images referenced by README.md into docs/images/.
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { ReceiptRenderer, findChrome } from '../src/renderer.mjs';
import { createServer } from '../src/server.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT_DIR = path.join(ROOT, 'docs', 'images');

const FONTS_URL =
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@500;600&family=Noto+Sans+TC:wght@400;500;700;900&family=Space+Grotesk:wght@600;700&display=swap';

const BASE_CSS = `
  html, body { margin: 0; }
  #canvas {
    box-sizing: border-box;
    width: 1280px;
    background-color: #181716;
    background-image: radial-gradient(rgb(255 255 255 / .05) 1px, transparent 1px);
    background-size: 24px 24px;
    color: #f3efe6;
    font-family: "Noto Sans TC", "Microsoft JhengHei", sans-serif;
  }
  img { display: block; }
`;

const readJson = async (file) => JSON.parse(await readFile(path.join(ROOT, file), 'utf8'));
const dataUri = (png) => `data:image/png;base64,${png.toString('base64')}`;

function page(body, css) {
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8">
<link rel="stylesheet" href="${FONTS_URL}"><style>${BASE_CSS}${css}</style></head>
<body>${body}</body></html>`;
}

function banner(receipts) {
  return page(
    `<div id="canvas">
      <div class="copy">
        <p class="eyebrow">DISCORD BOT · RECEIPT RENDERER</p>
        <h1>tip-receipt</h1>
        <p class="tagline">把打賞資料變成一張收據圖</p>
        <p class="sub">結單時預覽、挑樣式、一鍵送出<br>6 種樣式 · 8 種付款方式 · Python / JavaScript 皆可接入</p>
        <ul class="chips"><li>discord.py</li><li>discord.js</li><li>HTTP API</li></ul>
      </div>
      <div class="stack">
        <img class="r1" src="${receipts.thermal}" alt="">
        <img class="r2" src="${receipts.card}" alt="">
        <img class="r3" src="${receipts.pastel}" alt="">
      </div>
    </div>`,
    `
    #canvas { position: relative; height: 640px; overflow: hidden; }
    .copy { position: absolute; top: 50%; left: 88px; width: 560px; transform: translateY(-50%); }
    .eyebrow { margin: 0; color: #e0b25a; font: 600 14px/1 "IBM Plex Mono", monospace; letter-spacing: .3em; }
    h1 { margin: 22px 0 10px; font: 700 92px/1 "Space Grotesk", sans-serif; letter-spacing: -.035em; }
    .tagline { margin: 0; font-size: 36px; font-weight: 900; letter-spacing: .02em; }
    .sub { margin: 18px 0 0; color: #b9b2a5; font-size: 19px; line-height: 1.75; }
    .chips { display: flex; gap: 10px; margin: 30px 0 0; padding: 0; list-style: none; }
    .chips li { padding: 7px 16px; border: 1px solid rgb(255 255 255 / .2); border-radius: 999px; color: #e8e2d6; font: 500 14px/1 "IBM Plex Mono", monospace; }
    .stack { position: absolute; top: 0; right: -30px; width: 640px; height: 100%; }
    .stack img { position: absolute; width: 300px; filter: drop-shadow(0 28px 40px rgb(0 0 0 / .55)); }
    .r1 { top: 86px; left: 20px; transform: rotate(-9deg); }
    .r2 { top: 44px; left: 180px; transform: rotate(2deg); }
    .r3 { top: 104px; left: 340px; transform: rotate(10deg); }
    `,
  );
}

function gallery(figures, { columns, wide = [] }) {
  const items = figures
    .map(
      ({ id, code, name, src }) => `<figure class="${wide.includes(id) ? 'wide' : ''}">
        <img src="${src}" alt="">
        <figcaption><b>${code}</b>${name}</figcaption>
      </figure>`,
    )
    .join('');
  return page(
    `<div id="canvas">${items}</div>`,
    `
    #canvas { display: grid; grid-template-columns: repeat(${columns}, minmax(0, 1fr)); gap: 56px 40px; align-items: center; padding: 64px 60px; }
    figure { margin: 0; }
    figure img { width: 100%; filter: drop-shadow(0 18px 28px rgb(0 0 0 / .45)); }
    figure.wide { grid-column: 1 / -1; justify-self: center; width: calc((100% - 40px) / ${columns}); }
    figcaption { margin-top: 18px; color: #d6cfc2; font-size: 17px; font-weight: 500; text-align: center; letter-spacing: .06em; }
    figcaption b { margin-right: 10px; color: #e0b25a; font: 600 16px "IBM Plex Mono", monospace; }
    `,
  );
}

async function shoot(browser, html, file) {
  const tab = await browser.newPage();
  await tab.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1.5 });
  await tab.setContent(html, { waitUntil: 'networkidle0' });
  await tab.evaluate(() => document.fonts.ready);
  await (await tab.$('#canvas')).screenshot({ path: path.join(OUT_DIR, file) });
  await tab.close();
  console.log(path.relative(ROOT, path.join(OUT_DIR, file)));
}

async function shootPreview(browser, renderer) {
  const server = createServer({ renderer });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const tab = await browser.newPage();
    await tab.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await tab.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1.5 });
    await tab.goto(`http://127.0.0.1:${server.address().port}/#boarding`, { waitUntil: 'networkidle0' });
    await tab.select('#example', 'sample-multi.json');
    await tab.waitForNetworkIdle();
    await tab.evaluate(() => document.fonts.ready);
    await new Promise((resolve) => setTimeout(resolve, 500));
    await tab.screenshot({ path: path.join(OUT_DIR, 'preview.png') });
    await tab.close();
    console.log(path.relative(ROOT, path.join(OUT_DIR, 'preview.png')));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

await mkdir(OUT_DIR, { recursive: true });
const renderer = new ReceiptRenderer({ concurrency: 3 });
const browser = await puppeteer.launch({ executablePath: findChrome() });

try {
  const single = await readJson('examples/sample.json');
  const multi = await readJson('examples/sample-multi.json');
  const templates = new Map((await renderer.templates()).map((t) => [t.id, t]));
  const render = async (id, data) => dataUri(await renderer.render(id, data));
  const figure = async (id) => ({ ...templates.get(id), src: await render(id, multi) });

  const [thermal, card, pastel] = await Promise.all(['thermal', 'card', 'pastel'].map((id) => render(id, single)));
  await shoot(browser, banner({ thermal, card, pastel }), 'banner.png');

  const portrait = await Promise.all(['thermal', 'card', 'pastel'].map(figure));
  await shoot(browser, gallery(portrait, { columns: 3 }), 'styles-portrait.png');

  const landscape = await Promise.all(['ticket', 'boarding', 'rail'].map(figure));
  await shoot(browser, gallery(landscape, { columns: 2, wide: ['rail'] }), 'styles-landscape.png');

  await shootPreview(browser, renderer);
} finally {
  await browser.close();
  await renderer.close();
}

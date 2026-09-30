import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

export const TEMPLATES_DIR = fileURLToPath(new URL('../templates/', import.meta.url));
const PAYMENTS_FILE = path.join(TEMPLATES_DIR, '_shared', 'payments.json');

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

const MAX_ITEMS = 30;
const MAX_TEXT_LENGTH = 200;

export class RenderError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = 'RenderError';
    this.code = code;
    this.status = status;
  }
}

/** Resolves the browser executable: explicit path, CHROME_PATH, then common install locations. */
export function findChrome(explicit = process.env.CHROME_PATH) {
  return explicit || CHROME_CANDIDATES.find((p) => existsSync(p));
}

export async function listTemplates() {
  const entries = await readdir(TEMPLATES_DIR, { withFileTypes: true });
  const templates = [];

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
    const dir = path.join(TEMPLATES_DIR, entry.name);
    const metaFile = path.join(dir, 'meta.json');
    if (!existsSync(metaFile) || !existsSync(path.join(dir, 'index.html'))) continue;

    const meta = JSON.parse(await readFile(metaFile, 'utf8'));
    templates.push({
      id: entry.name,
      code: meta.code,
      name: meta.name,
      description: meta.description ?? '',
      width: meta.width,
    });
  }

  return templates.sort((a, b) => String(a.code).localeCompare(String(b.code)));
}

export async function loadPayments() {
  return JSON.parse(await readFile(PAYMENTS_FILE, 'utf8'));
}

export async function listPayments() {
  const registry = await loadPayments();
  return Object.entries(registry).map(([key, p]) => ({ key, label: p.label, status: p.status }));
}

/** Accepts a template id ("thermal") or its code ("A"); falls back to the first template. */
export async function findTemplate(key) {
  const templates = await listTemplates();
  if (key == null || key === '') return templates[0];
  const wanted = String(key).toLowerCase();
  return templates.find((t) => t.id === wanted || String(t.code).toLowerCase() === wanted);
}

export function validateData(data) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new RenderError('`data` must be an object', 'INVALID_DATA');
  }
  if (data.items !== undefined && !Array.isArray(data.items)) {
    throw new RenderError('`data.items` must be an array', 'INVALID_DATA');
  }
  if ((data.items?.length ?? 0) > MAX_ITEMS) {
    throw new RenderError(`a receipt holds at most ${MAX_ITEMS} items`, 'INVALID_DATA');
  }
  if (data.timeZone !== undefined) {
    try {
      new Intl.DateTimeFormat('en', { timeZone: data.timeZone });
    } catch {
      throw new RenderError(`unknown time zone: ${data.timeZone}`, 'INVALID_DATA');
    }
  }

  const visit = (value, where) => {
    if (typeof value === 'string' && value.length > MAX_TEXT_LENGTH) {
      throw new RenderError(`${where} exceeds ${MAX_TEXT_LENGTH} characters`, 'INVALID_DATA');
    }
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) visit(child, `${where}.${key}`);
    }
  };
  visit(data, 'data');
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new RenderError(message, 'RENDER_TIMEOUT', 504)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export class ReceiptRenderer {
  #browser = null;
  #active = 0;
  #waiting = [];

  constructor({
    executablePath = process.env.CHROME_PATH,
    concurrency = 2,
    timeout = 20_000,
    scale = 2,
    noSandbox = process.env.CHROME_NO_SANDBOX === '1',
  } = {}) {
    this.executablePath = executablePath;
    this.concurrency = concurrency;
    this.timeout = timeout;
    this.scale = scale;
    this.noSandbox = noSandbox;
  }

  /** Same shape as ReceiptClient#templates, so either can back the Discord helpers. */
  templates() {
    return listTemplates();
  }

  /** Renders a receipt and resolves with PNG bytes. */
  async render(templateKey, data, { scale } = {}) {
    const template = await findTemplate(templateKey);
    if (!template) throw new RenderError(`unknown template: ${templateKey}`, 'UNKNOWN_TEMPLATE', 404);
    validateData(data);

    const deviceScaleFactor = Math.min(3, Math.max(1, Math.round(Number(scale ?? this.scale) || 2)));
    const url = pathToFileURL(path.join(TEMPLATES_DIR, template.id, 'index.html')).href;
    const payments = await loadPayments();

    await this.#acquire();
    let page;
    try {
      const browser = await this.#getBrowser();
      page = await browser.newPage();
      page.setDefaultTimeout(this.timeout);
      await page.setViewport({ width: (template.width ?? 400) + 80, height: 800, deviceScaleFactor });
      await page.goto(url, { waitUntil: 'load' });

      await withTimeout(
        page.evaluate(
          async (payload, registry) => {
            window.renderReceipt(payload, { payments: registry });
            await document.fonts.ready;
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            await document.fonts.ready;
            window.fitReceipt();
          },
          data,
          payments,
        ),
        this.timeout,
        `template ${template.id} did not finish rendering`,
      );

      const element = await page.$('#receipt');
      if (!element) throw new RenderError(`template ${template.id} has no #receipt element`, 'BROKEN_TEMPLATE', 500);
      return Buffer.from(await element.screenshot({ omitBackground: true }));
    } finally {
      await page?.close().catch(() => {});
      this.#release();
    }
  }

  async close() {
    const pending = this.#browser;
    this.#browser = null;
    const browser = await pending?.catch(() => null);
    await browser?.close();
  }

  #getBrowser() {
    this.#browser ??= this.#launch();
    return this.#browser;
  }

  async #launch() {
    const executablePath = findChrome(this.executablePath);
    if (!executablePath) {
      this.#browser = null;
      throw new RenderError('no Chrome/Chromium found; set CHROME_PATH', 'NO_BROWSER', 500);
    }
    try {
      const browser = await puppeteer.launch({
        executablePath,
        args: this.noSandbox ? ['--no-sandbox', '--disable-setuid-sandbox'] : [],
      });
      browser.on('disconnected', () => {
        this.#browser = null;
      });
      return browser;
    } catch (err) {
      this.#browser = null;
      throw err;
    }
  }

  async #acquire() {
    if (this.#active < this.concurrency) {
      this.#active += 1;
      return;
    }
    await new Promise((resolve) => this.#waiting.push(resolve));
  }

  #release() {
    const next = this.#waiting.shift();
    if (next) next();
    else this.#active -= 1;
  }
}

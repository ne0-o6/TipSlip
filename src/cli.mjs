#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ReceiptRenderer, RenderError, listTemplates } from './renderer.mjs';

const USAGE = `Usage:
  node src/cli.mjs list
  node src/cli.mjs render <template> <data.json> [out.png]`;

async function main([command, ...args]) {
  if (command === 'list') {
    for (const t of await listTemplates()) {
      console.log(`${t.code}  ${t.id.padEnd(10)} ${t.name}`);
    }
    return;
  }

  if (command === 'render' && args.length >= 2) {
    const [template, dataFile, out = path.join('out', `${template}.png`)] = args;
    const data = JSON.parse(await readFile(dataFile, 'utf8'));
    const renderer = new ReceiptRenderer();
    try {
      const png = await renderer.render(template, data);
      await mkdir(path.dirname(path.resolve(out)), { recursive: true });
      await writeFile(out, png);
      console.log(out);
    } finally {
      await renderer.close();
    }
    return;
  }

  console.error(USAGE);
  process.exitCode = 1;
}

main(process.argv.slice(2)).catch((err) => {
  console.error(err instanceof RenderError ? `error: ${err.message}` : err);
  process.exitCode = 1;
});

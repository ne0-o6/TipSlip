#!/usr/bin/env node
// Renders every template with every examples/*.json into out/<template>-<example>.png.
// Pass a template id or code to limit the run: `npm run samples -- ticket`.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ReceiptRenderer, listTemplates } from '../src/renderer.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EXAMPLES_DIR = path.join(ROOT, 'examples');
const OUT_DIR = path.join(ROOT, 'out');

const filter = process.argv[2]?.toLowerCase();
const templates = (await listTemplates()).filter(
  (t) => !filter || t.id === filter || String(t.code).toLowerCase() === filter,
);
const examples = (await readdir(EXAMPLES_DIR)).filter((file) => file.endsWith('.json'));

await mkdir(OUT_DIR, { recursive: true });
const renderer = new ReceiptRenderer({ concurrency: 4 });
const started = Date.now();

try {
  await Promise.all(
    templates.flatMap((template) =>
      examples.map(async (file) => {
        const data = JSON.parse(await readFile(path.join(EXAMPLES_DIR, file), 'utf8'));
        const png = await renderer.render(template.id, data);
        const out = path.join(OUT_DIR, `${template.id}-${path.basename(file, '.json')}.png`);
        await writeFile(out, png);
        console.log(path.relative(ROOT, out));
      }),
    ),
  );
  console.log(`${templates.length * examples.length} images in ${Date.now() - started} ms`);
} finally {
  await renderer.close();
}

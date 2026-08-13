// Generates src/inject/worker-source.ts — embeds the core inject bundle's own source
// as a string so the Worker/Blob patcher can prepend it into detector web workers.
// Usage:
//   node scripts/gen-worker-embed.mjs            → writes empty stub (pass 1)
//   node scripts/gen-worker-embed.mjs <file>     → embeds that file's source (pass 2)
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dest = resolve(here, '../src/inject/worker-source.ts');
const from = process.argv[2];
const src = from ? readFileSync(resolve(here, '..', from), 'utf8') : '';
writeFileSync(
  dest,
  '// AUTO-GENERATED — do not edit. Core bundle source embedded for worker injection.\n' +
  'export const WORKER_SOURCE: string = ' + JSON.stringify(src) + ';\n',
);
console.log(from ? `worker-source.ts: embedded ${src.length} bytes from ${from}` : 'worker-source.ts: stub written (pass 1)');

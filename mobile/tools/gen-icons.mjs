// Regenerates the Android adaptive icons from the master icon.svg.
// Run: node tools/gen-icons.mjs
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const res = resolve(root, 'android/app/src/main/res');
const src = resolve(root, '../gui/assets/icon.svg');

const densities = [
  ['mipmap-mdpi', 48],
  ['mipmap-hdpi', 72],
  ['mipmap-xhdpi', 96],
  ['mipmap-xxhdpi', 144],
  ['mipmap-xxxhdpi', 192],
];

if (!existsSync(src)) { console.error('master icon missing:', src); process.exit(1); }
if (!existsSync(res)) { console.error('android platform not added yet (run `npx cap add android`)'); process.exit(1); }

for (const [dir, px] of densities) {
  const d = resolve(res, dir);
  execFileSync('mkdir', ['-p', d]);
  // launcher icon (square with padding)
  execFileSync('magick', ['-background', 'none', src, '-resize', String(px) + 'x' + String(px), resolve(d, 'ic_launcher.png')]);
  // round icon
  execFileSync('magick', ['-background', 'none', src, '-resize', String(px) + 'x' + String(px),
    '(', '+clone', '-alpha', 'extract', '-draw', 'circle 0.5,0.5 0.5,0', ')', '-alpha', 'on', '-channel', 'RGBA', '-compose', 'CopyOpacity', '-composite', resolve(d, 'ic_launcher_round.png')]);
  // foreground (larger, transparent)
  const fg = Math.round(px * 1.7);
  execFileSync('magick', ['-background', 'none', src, '-resize', String(fg) + 'x' + String(fg), resolve(d, 'ic_launcher_foreground.png')]);
  console.log('generated', dir, px);
}
// Play store icon
execFileSync('magick', ['-background', 'none', src, '-resize', '512x512', resolve(res, 'mipmap-xxxhdpi/ic_launcher_playstore.png')]);
console.log('done. background color: set android:icon / ic_launcher_background in android/app/src/.../res/values/colors.xml or mipmap-anydpi xml if needed.');

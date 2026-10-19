import { readFile, writeFile } from 'node:fs/promises';
import { Resvg } from '@resvg/resvg-js';

const svg = await readFile(new URL('../public/icons/app.svg', import.meta.url));
for (const size of [180, 192, 512]) {
  const icon = new Resvg(svg, { fitTo: { mode: 'width', value: size }, background: '#7052b4', font: { loadSystemFonts: false } });
  await writeFile(new URL(`../public/icons/app-${size}.png`, import.meta.url), icon.render().asPng());
}
console.log('Generated the 180, 192, and 512px app icons.');

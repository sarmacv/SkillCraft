// Renders media/icon.svg to the PNG sizes the VS Code Marketplace and chat need.
import { Resvg } from '@resvg/resvg-js';
import { readFileSync, writeFileSync } from 'node:fs';

const svg = readFileSync('media/icon.svg', 'utf8');
for (const [file, size] of [['media/icon.png', 256], ['media/icon-128.png', 128]]) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(file, png);
  console.log(`${file} ${size}px`);
}

#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Resvg } from '@resvg/resvg-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const svgPath = join(__dirname, 'images', 'backlog_add_task.svg');
const sizes = [16, 32, 48, 128];

const svg = readFileSync(svgPath);

for (const size of sizes) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: size },
  });
  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();
  const outputPath = join(__dirname, 'images', `icon${size}.png`);
  writeFileSync(outputPath, pngBuffer);
  console.log(`Created ${outputPath}`);
}

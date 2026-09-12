const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const svgPath = path.join(__dirname, 'public', 'icons', 'icon.svg');
const svgBuffer = fs.readFileSync(svgPath);

const sizes = [72, 96, 120, 128, 144, 152, 192, 300, 384, 512];

async function generate() {
  for (const size of sizes) {
    const outPath = path.join(__dirname, 'public', 'icons', `icon-${size}x${size}.png`);
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(outPath);
    console.log(`Generated icon-${size}x${size}.png`);
  }
}

generate().catch(console.error);

import { deflateSync } from 'zlib';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { execSync } from 'child_process';

// ── CRC32 ──────────────────────────────────────────────────────────────────────
const CRC = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  CRC[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.allocUnsafe(4); len.writeUInt32BE(data.length);
  const crcBuf = Buffer.allocUnsafe(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crcBuf]);
}

// ── Drawing helpers ────────────────────────────────────────────────────────────
function fillRect(px, size, x0, y0, w, h, r, g, b) {
  for (let y = Math.max(0, y0); y < Math.min(size, y0 + h); y++) {
    for (let x = Math.max(0, x0); x < Math.min(size, x0 + w); x++) {
      const i = (y * size + x) * 3;
      px[i] = r; px[i + 1] = g; px[i + 2] = b;
    }
  }
}

// ── Generate PNG ───────────────────────────────────────────────────────────────
function createPNG(size = 1024) {
  const px = Buffer.alloc(size * size * 3);

  // Background #0a0a18
  for (let i = 0; i < px.length; i += 3) { px[i] = 10; px[i + 1] = 10; px[i + 2] = 24; }

  // Subtle rounded-rect card: slightly lighter panel in center
  const pad = Math.floor(size * 0.12);
  fillRect(px, size, pad, pad, size - pad * 2, size - pad * 2, 18, 18, 40);

  // Color: bright light-blue #a0c4ff
  const [R, G, B] = [160, 196, 255];

  // Grid unit: 1/24 of icon size
  const u = Math.floor(size / 24);
  const cx = Math.floor(size / 2);
  const cy = Math.floor(size / 2);

  // ── ">" chevron ──────────────────────────────────────────────────
  // 5-row, pixel-art chevron
  // Row offsets from top of glyph:
  //  0: X X . . .
  //  1: . . X X .
  //  2: . . . . X X  ← tip
  //  3: . . X X .
  //  4: X X . . .
  const gx = cx - u * 7;
  const gy = cy - u * 3;
  const t = u;        // thickness of each bar
  const half = u * 2; // width of each diagonal segment

  fillRect(px, size, gx,           gy,           half, t, R, G, B);
  fillRect(px, size, gx + half,    gy + t,       half, t, R, G, B);
  fillRect(px, size, gx + half*2,  gy + t * 2,   t*2,  t, R, G, B); // tip
  fillRect(px, size, gx + half,    gy + t * 3,   half, t, R, G, B);
  fillRect(px, size, gx,           gy + t * 4,   half, t, R, G, B);

  // ── "_" underscore ────────────────────────────────────────────────
  const ux = cx + u;
  const uy = cy + u * 2;
  fillRect(px, size, ux, uy, u * 5, t, R, G, B);

  // ── Build PNG scanlines ────────────────────────────────────────────
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.allocUnsafe(1 + size * 3);
    row[0] = 0; // filter: None
    px.copy(row, 1, y * size * 3, (y + 1) * size * 3);
    rows.push(row);
  }

  const compressed = deflateSync(Buffer.concat(rows), { level: 6 });
  const ihdr = Buffer.allocUnsafe(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Write files ────────────────────────────────────────────────────────────────
mkdirSync('./build', { recursive: true });
writeFileSync('./build/icon.png', createPNG(1024));
console.log('✓ build/icon.png (1024×1024)');

// macOS: convert to .icns via sips + iconutil
try {
  const iconset = './build/icon.iconset';
  mkdirSync(iconset, { recursive: true });

  const sizes = [
    [16,   'icon_16x16.png'],
    [32,   'icon_16x16@2x.png'],
    [32,   'icon_32x32.png'],
    [64,   'icon_32x32@2x.png'],
    [128,  'icon_128x128.png'],
    [256,  'icon_128x128@2x.png'],
    [256,  'icon_256x256.png'],
    [512,  'icon_256x256@2x.png'],
    [512,  'icon_512x512.png'],
    [1024, 'icon_512x512@2x.png'],
  ];
  for (const [s, name] of sizes) {
    execSync(`sips -z ${s} ${s} ./build/icon.png --out ${iconset}/${name}`, { stdio: 'pipe' });
  }
  execSync(`iconutil -c icns ${iconset} -o ./build/icon.icns`);
  rmSync(iconset, { recursive: true });
  console.log('✓ build/icon.icns');
} catch (e) {
  console.warn('⚠ Could not create .icns (requires macOS sips/iconutil)');
}

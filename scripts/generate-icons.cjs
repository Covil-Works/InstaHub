const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Minimal pure-Node PNG generator
function createPNG(size) {
  const width = size;
  const height = size;

  // Raw RGBA pixels buffer with 1 filter byte per scanline
  const scanlineLength = width * 4 + 1;
  const buffer = Buffer.alloc(height * scanlineLength);

  const cx = size / 2;
  const cy = size / 2;

  for (let y = 0; y < height; y++) {
    const rowOffset = y * scanlineLength;
    buffer[rowOffset] = 0; // Filter type 0 (None)

    for (let x = 0; x < width; x++) {
      const pxOffset = rowOffset + 1 + x * 4;

      // Rounded rectangle background
      const cornerR = size * 0.22;
      const dx = Math.max(0, Math.abs(x - cx) - (size / 2 - cornerR));
      const dy = Math.max(0, Math.abs(y - cy) - (size / 2 - cornerR));
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= cornerR) {
        // Linear gradient: bottom-left (amber/orange) to top-right (purple/magenta)
        const t = (x + (height - y)) / (width + height);
        let r, g, b;
        if (t < 0.5) {
          const k = t * 2;
          r = Math.round(245 * (1 - k) + 225 * k);
          g = Math.round(158 * (1 - k) + 29 * k);
          b = Math.round(11 * (1 - k) + 72 * k);
        } else {
          const k = (t - 0.5) * 2;
          r = Math.round(225 * (1 - k) + 147 * k);
          g = Math.round(29 * (1 - k) + 51 * k);
          b = Math.round(72 * (1 - k) + 234 * k);
        }

        // Inner white emblem / circle / camera / shield outline
        const emblemDist = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
        const emblemR = size * 0.26;
        const emblemThickness = Math.max(1.5, size * 0.08);

        // Center dot
        const dotR = size * 0.09;

        if (
          Math.abs(emblemDist - emblemR) <= emblemThickness / 2 ||
          emblemDist <= dotR
        ) {
          buffer[pxOffset] = 255;
          buffer[pxOffset + 1] = 255;
          buffer[pxOffset + 2] = 255;
          buffer[pxOffset + 3] = 255;
        } else {
          buffer[pxOffset] = r;
          buffer[pxOffset + 1] = g;
          buffer[pxOffset + 2] = b;
          buffer[pxOffset + 3] = 255;
        }
      } else {
        // Transparent
        buffer[pxOffset] = 0;
        buffer[pxOffset + 1] = 0;
        buffer[pxOffset + 2] = 0;
        buffer[pxOffset + 3] = 0;
      }
    }
  }

  // Compress IDAT data
  const compressed = zlib.deflateSync(buffer);

  // PNG Signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // Bit depth: 8
  ihdr[9] = 6; // Color type: 6 (RGBA)
  ihdr[10] = 0; // Compression
  ihdr[11] = 0; // Filter
  ihdr[12] = 0; // Interlace

  const ihdrChunk = createChunk('IHDR', ihdr);
  const idatChunk = createChunk('IDAT', compressed);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type, data) {
  const length = data.length;
  const chunk = Buffer.alloc(length + 12);
  chunk.writeUInt32BE(length, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);

  const crc = crc32(chunk.slice(4, length + 8));
  chunk.writeInt32BE(crc, length + 8);
  return chunk;
}

// CRC32 table
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) {
      c = 0xedb88320 ^ (c >>> 1);
    } else {
      c = 0xedb88320 ^ (c >>> 1);
    }
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) | 0;
}

const outDir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

[16, 32, 48, 128].forEach((sz) => {
  const png = createPNG(sz);
  fs.writeFileSync(path.join(outDir, `icon${sz}.png`), png);
  console.log(`Generated icon${sz}.png`);
});

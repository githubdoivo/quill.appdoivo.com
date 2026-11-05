// Zip read/write with no dependencies (same code as Expenses' xlsx.js), used for
// backups: data.json plus every photo. Browser and Node 18+.
const MAX_FILE = 2 * 1024 * 1024 * 1024; // 2 GB backup
const MAX_UNZIPPED = 4 * 1024 * 1024 * 1024;
/* ---------- zip ---------- */
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

export async function pipe(bytes, stream, limit) {
  const out = []; let size = 0;
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (limit && size > limit) { await reader.cancel(); throw new Error("too-big"); }
    out.push(value);
  }
  const all = new Uint8Array(size); let o = 0;
  for (const c of out) { all.set(c, o); o += c.length; }
  return all;
}

export async function unzip(bytes) {
  bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (bytes.length > MAX_FILE) throw new Error("too-big");
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("not-xlsx");
  const count = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  const files = new Map(); let budget = MAX_UNZIPPED;
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || u32(bytes, p) !== 0x02014b50) throw new Error("not-xlsx");
    const method = u16(bytes, p + 10), csize = u32(bytes, p + 20), nlen = u16(bytes, p + 28);
    const elen = u16(bytes, p + 30), clen = u16(bytes, p + 32), local = u32(bytes, p + 42);
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + elen + clen;
    if (local + 30 > bytes.length || u32(bytes, local) !== 0x04034b50) throw new Error("not-xlsx");
    const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
    const data = bytes.subarray(start, start + csize);
    let raw;
    if (method === 0) raw = data;
    else if (method === 8) raw = await pipe(data, new DecompressionStream("deflate-raw"), budget);
    else throw new Error("not-xlsx");
    budget -= raw.length;
    if (budget < 0) throw new Error("too-big");
    files.set(name, raw);
  }
  return files;
}

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

export async function zip(entries) {
  const enc = new TextEncoder(); const parts = []; const central = []; let offset = 0;
  for (const [name, content] of entries) {
    const raw = typeof content === "string" ? enc.encode(content) : content;
    const comp = await pipe(raw, new CompressionStream("deflate-raw"));
    const n = enc.encode(name), crc = crc32(raw);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(8, 8, true);
    h.setUint32(14, crc, true); h.setUint32(18, comp.length, true); h.setUint32(22, raw.length, true); h.setUint16(26, n.length, true);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(10, 8, true);
    c.setUint32(16, crc, true); c.setUint32(20, comp.length, true); c.setUint32(24, raw.length, true); c.setUint16(28, n.length, true); c.setUint32(42, offset, true);
    parts.push(new Uint8Array(h.buffer), n, comp); central.push(new Uint8Array(c.buffer), n);
    offset += 30 + n.length + comp.length;
  }
  const csize = central.reduce((s, x) => s + x.length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, entries.length, true); e.setUint16(10, entries.length, true);
  e.setUint32(12, csize, true); e.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)]);
}

export { crc32 };

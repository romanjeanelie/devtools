#!/usr/bin/env node
/**
 * Repair the hvcC box of an HEVC-with-alpha file produced by ffmpeg + VideoToolbox.
 *
 * VideoToolbox encodes Apple's HEVC alpha as two layers: the picture on
 * nuh_layer_id 0 and the alpha on nuh_layer_id 1, each with its own SPS and PPS.
 * ffmpeg's mov/mp4 muxer keeps only the layer-0 parameter sets when it builds
 * the hvcC box, so AVFoundation — Safari, QuickTime, QuickLook, Finder — cannot
 * decode the alpha layer and rejects the file outright. The picture data itself
 * is intact in mdat.
 *
 * This puts the missing layer-1 parameter sets back into hvcC, harvesting them
 * from the raw Annex-B stream of the same encode.
 *
 * It also corrects alpha_channel_use_idc in the alpha_channel_info SEI.
 * VideoToolbox writes 1 ("the picture is premultiplied by alpha") whatever it is
 * handed, but ffmpeg feeds it straight, non-premultiplied RGBA. Apple's decoder
 * then divides the edge pixels by their own alpha and the matte grows a bright
 * halo. Declaring 0 — what the data actually is — removes it without touching a
 * single pixel.
 *
 *   node hevc_alpha_fix.mjs --video=out.mov --params=raw.hevc [--out=fixed.mov]
 */
import { readFileSync, writeFileSync } from 'fs';

// ── Annex-B → NAL units ───────────────────────────────────────────────────────
function annexbNals(buf) {
  const nals = [];
  const starts = [];
  for (let i = 0; i + 3 <= buf.length; i++) {
    if (buf[i] === 0 && buf[i + 1] === 0 && buf[i + 2] === 1) starts.push(i + 3);
  }
  for (let k = 0; k < starts.length; k++) {
    const from = starts[k];
    let to = k + 1 < starts.length ? starts[k + 1] - 3 : buf.length;
    while (to > from && buf[to - 1] === 0) to--;   // drop the trailing zero of the next start code
    if (to - from >= 2) nals.push(buf.subarray(from, to));
  }
  return nals;
}

const nalType  = (n) => (n[0] >> 1) & 0x3f;
const nalLayer = (n) => ((n[0] & 1) << 5) | (n[1] >> 3);

/** Offset of the SEI payload inside a NAL, or -1 when it is not the wanted type */
function seiPayloadStart(nal, wantedType) {
  let p = 2;                                    // past the 2-byte NAL header
  let type = 0;
  while (p < nal.length && nal[p] === 0xff) { type += 255; p++; }
  if (p >= nal.length) return -1;
  type += nal[p++];
  while (p < nal.length && nal[p] === 0xff) p++;  // payloadSize, value unused
  if (p >= nal.length) return -1;
  p++;
  return type === wantedType && p < nal.length ? p : -1;
}

/**
 * Force alpha_channel_use_idc to 0 (straight, non-premultiplied) in an
 * alpha_channel_info SEI. First payload byte is
 *   [cancel_flag:1][use_idc:3][bit_depth_minus8:3][…]
 * so the three use_idc bits are the 0x70 mask. Returns a new NAL, or null.
 */
function straightAlphaSei(nal) {
  if (((nal[0] >> 1) & 0x3f) !== 39) return null;   // prefix SEI only
  const at = seiPayloadStart(nal, 165);
  if (at < 0) return null;
  if ((nal[at] & 0x70) === 0) return null;          // already straight
  const copy = Buffer.from(nal);
  copy[at] &= ~0x70;
  return copy;
}

// ── ISO-BMFF walking ──────────────────────────────────────────────────────────
function* children(buf, start, end) {
  let pos = start;
  while (pos + 8 <= end) {
    let size = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    let body = pos + 8;
    if (size === 1) { size = Number(buf.readBigUInt64BE(pos + 8)); body = pos + 16; }
    if (size === 0) size = end - pos;
    if (size < 8) return;
    yield { type, start: pos, body, end: pos + size };
    pos += size;
  }
}

const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'stsd', 'hvc1', 'hev1']);
const BODY_SKIP  = { stsd: 8, hvc1: 78, hev1: 78 };

/** Depth-first search returning the box plus every ancestor, so their sizes can be grown. */
function locate(buf, type, start, end, ancestors = []) {
  for (const box of children(buf, start, end)) {
    if (box.type === type) return { box, ancestors };
    if (CONTAINERS.has(box.type)) {
      const found = locate(buf, type, box.body + (BODY_SKIP[box.type] || 0), box.end, [...ancestors, box]);
      if (found) return found;
    }
  }
  return null;
}

function collect(buf, types, start, end, out = []) {
  for (const box of children(buf, start, end)) {
    if (types.has(box.type)) out.push(box);
    if (CONTAINERS.has(box.type)) collect(buf, types, box.body + (BODY_SKIP[box.type] || 0), box.end, out);
  }
  return out;
}

// ── hvcC ──────────────────────────────────────────────────────────────────────
function parseHvcC(buf) {
  const header = buf.subarray(0, 23);          // fixed part, up to and including numOfArrays
  const arrays = [];
  let p = 23;
  for (let a = 0; a < buf[22]; a++) {
    const flags = buf[p];
    const count = buf.readUInt16BE(p + 1);
    p += 3;
    const nals = [];
    for (let n = 0; n < count; n++) {
      const len = buf.readUInt16BE(p);
      nals.push(buf.subarray(p + 2, p + 2 + len));
      p += 2 + len;
    }
    arrays.push({ flags, type: flags & 0x3f, nals });
  }
  return { header, arrays };
}

function buildHvcC({ header, arrays }) {
  const parts = [Buffer.from(header)];
  parts[0][22] = arrays.length;
  for (const arr of arrays) {
    const head = Buffer.alloc(3);
    head[0] = arr.flags;
    head.writeUInt16BE(arr.nals.length, 1);
    parts.push(head);
    for (const nal of arr.nals) {
      const len = Buffer.alloc(2);
      len.writeUInt16BE(nal.length, 0);
      parts.push(len, nal);
    }
  }
  return Buffer.concat(parts);
}

// ── main ──────────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter((a) => a.startsWith('--'))
    .map((a) => { const i = a.indexOf('='); return i < 0 ? [a.slice(2), true] : [a.slice(2, i), a.slice(i + 1)]; })
);

if (!args.video || !args.params) {
  console.error('usage: hevc_alpha_fix.mjs --video=out.mov --params=raw.hevc [--out=fixed.mov]');
  process.exit(2);
}

const video = readFileSync(args.video);
const raw   = readFileSync(args.params);

// Parameter sets of the auxiliary (alpha) layer, which the muxer dropped
const extra = annexbNals(raw).filter((n) => [32, 33, 34].includes(nalType(n)) && nalLayer(n) > 0);
if (extra.length === 0) {
  console.error('No layer-1 parameter sets in the raw stream — nothing to repair.');
  process.exit(1);
}

const found = locate(video, 'hvcC', 0, video.length);
if (!found) { console.error('No hvcC box found in ' + args.video); process.exit(1); }
const { box: hvcCBox, ancestors } = found;

const cfg = parseHvcC(video.subarray(hvcCBox.body, hvcCBox.end));

// The raw stream must come from the same encode, otherwise its parameter sets
// describe a different bitstream. The layer-0 SPS is the fingerprint: it is in
// both files, and it changes with resolution, profile and encoder settings.
const rawBase = annexbNals(raw).find((n) => nalType(n) === 33 && nalLayer(n) === 0);
const boxBase = cfg.arrays.find((a) => a.type === 33)?.nals.find((n) => nalLayer(n) === 0);
if (!rawBase || !boxBase || !rawBase.equals(boxBase)) {
  console.error('Parameter sets do not match the video — the raw stream must come from the same encode.');
  process.exit(1);
}
let added = 0;
for (const nal of extra) {
  const t = nalType(nal);
  let arr = cfg.arrays.find((a) => a.type === t);
  if (!arr) { arr = { flags: 0x80 | t, type: t, nals: [] }; cfg.arrays.push(arr); }
  if (arr.nals.some((n) => n.equals(nal))) continue;
  arr.nals.push(nal);
  added++;
}

// Retag the matte as straight alpha wherever the SEI appears
const seiEdits = [];
for (const arr of cfg.arrays) {
  arr.nals = arr.nals.map((nal) => {
    const fixed = straightAlphaSei(nal);
    if (!fixed) return nal;
    seiEdits.push([nal, fixed]);
    return fixed;
  });
}

if (added === 0 && seiEdits.length === 0) {
  console.log('hvcC already correct — left unchanged.');
  process.exit(0);
}

const newBody = buildHvcC(cfg);
const newBox  = Buffer.concat([Buffer.alloc(8), newBody]);
newBox.writeUInt32BE(newBox.length, 0);
newBox.write('hvcC', 4, 'latin1');

const delta = newBox.length - (hvcCBox.end - hvcCBox.start);

// Chunk offsets that point past the splice have to move with it
const chunkBoxes = collect(video, new Set(['stco', 'co64']), 0, video.length)
  .map((b) => ({ ...b, entries: video.readUInt32BE(b.body + 4) }));

const out = Buffer.concat([
  video.subarray(0, hvcCBox.start),
  newBox,
  video.subarray(hvcCBox.end),
]);

// Every ancestor box grows by the same delta
for (const anc of ancestors) {
  const size = out.readUInt32BE(anc.start);
  if (size === 1) { console.error('64-bit box size on an ancestor is not handled'); process.exit(1); }
  out.writeUInt32BE(size + delta, anc.start);
}

for (const cb of chunkBoxes) {
  const shifted = cb.start > hvcCBox.start ? delta : 0;
  const base = cb.body + shifted + 8;           // version/flags + entry_count
  for (let i = 0; i < cb.entries; i++) {
    if (cb.type === 'stco') {
      const off = out.readUInt32BE(base + i * 4);
      if (off >= hvcCBox.start) out.writeUInt32BE(off + delta, base + i * 4);
    } else {
      const off = out.readBigUInt64BE(base + i * 8);
      if (off >= BigInt(hvcCBox.start)) out.writeBigUInt64BE(off + BigInt(delta), base + i * 8);
    }
  }
}

// The same SEI can also sit in-band in mdat. The edit keeps the byte length, so
// a straight buffer replacement is safe and moves nothing.
let inband = 0;
for (const [before, after] of seiEdits) {
  let from = 0;
  for (;;) {
    const at = out.indexOf(before, from);
    if (at < 0) break;
    after.copy(out, at);
    inband++;
    from = at + before.length;
  }
}

const dest = args.out || args.video;
writeFileSync(dest, out);

const parts = [];
if (added) parts.push(`+${added} alpha-layer parameter set(s), ${hvcCBox.end - hvcCBox.start} → ${newBox.length} bytes`);
if (seiEdits.length) parts.push(`alpha retagged as straight (${seiEdits.length + inband} SEI)`);
console.log('hvcC repaired: ' + parts.join(' · '));

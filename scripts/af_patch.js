#!/usr/bin/env node
/**
 * af_patch.js — Repair .af files produced by an old af.js that didn't
 * write `width` / `height` in the manifest.
 *
 * Usage:
 *   node af_patch.js <file.af> [--width=W --height=H]
 *   node af_patch.js <folder>  [--width=W --height=H]   # batch
 *
 * Resolution order for dimensions:
 *   1. Explicit --width / --height flags
 *   2. Sibling MP4 (same basename) probed with ffprobe
 *   3. Parsed from the SPS NAL in the manifest's `description` (base64 avcC/hvcC box)
 *
 * A timestamped backup `.af.bak` is written next to every patched file.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// ─── CLI parsing ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let target = null;
let forcedW = null;
let forcedH = null;
let dryRun = false;

for (const a of args) {
    if (a.startsWith('--width='))       forcedW  = parseInt(a.slice(8), 10);
    else if (a.startsWith('--height=')) forcedH  = parseInt(a.slice(9), 10);
    else if (a === '--dry-run')         dryRun   = true;
    else if (!target)                   target   = a;
}

if (!target) {
    console.error('Usage: node af_patch.js <file.af|folder> [--width=W --height=H] [--dry-run]');
    process.exit(1);
}

// ─── SPS parsing ──────────────────────────────────────────────────────────────

/** Removes H.264/H.265 emulation prevention bytes (0x000003 → 0x0000) */
function removeEmulationPrevention(buf) {
    const out = [];
    for (let i = 0; i < buf.length; i++) {
        if (i + 2 < buf.length && buf[i] === 0x00 && buf[i + 1] === 0x00 && buf[i + 2] === 0x03) {
            out.push(0x00, 0x00);
            i += 2;
        } else {
            out.push(buf[i]);
        }
    }
    return Buffer.from(out);
}

/** Minimal Exp-Golomb bit reader */
class BitReader {
    constructor(buf) { this.buf = buf; this.pos = 0; }
    readBit() {
        const byte = this.buf[this.pos >> 3];
        const bit = (byte >> (7 - (this.pos & 7))) & 1;
        this.pos++;
        return bit;
    }
    readBits(n) { let v = 0; for (let i = 0; i < n; i++) v = (v << 1) | this.readBit(); return v; }
    readUE() {
        let zeros = 0;
        while (this.readBit() === 0 && zeros < 32) zeros++;
        return ((1 << zeros) - 1) + this.readBits(zeros);
    }
    readSE() { const v = this.readUE(); return (v & 1) ? (v + 1) >> 1 : -(v >> 1); }
}

/** Parse H.264 SPS NAL payload (without the 1-byte NAL header) → {width, height} */
function parseH264SPS(sps) {
    const r = new BitReader(sps);
    const profile_idc = r.readBits(8);
    r.readBits(8);                     // constraint flags + reserved
    r.readBits(8);                     // level_idc
    r.readUE();                        // seq_parameter_set_id

    if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].includes(profile_idc)) {
        const chroma_format_idc = r.readUE();
        if (chroma_format_idc === 3) r.readBit();      // separate_colour_plane_flag
        r.readUE();                                     // bit_depth_luma_minus8
        r.readUE();                                     // bit_depth_chroma_minus8
        r.readBit();                                    // qpprime_y_zero_transform_bypass
        const seq_scaling_matrix_present = r.readBit();
        if (seq_scaling_matrix_present) {
            const n = (chroma_format_idc !== 3) ? 8 : 12;
            for (let i = 0; i < n; i++) {
                const present = r.readBit();
                if (present) {
                    const size = (i < 6) ? 16 : 64;
                    let lastScale = 8, nextScale = 8;
                    for (let j = 0; j < size; j++) {
                        if (nextScale !== 0) {
                            const delta = r.readSE();
                            nextScale = (lastScale + delta + 256) & 0xff;
                        }
                        lastScale = (nextScale === 0) ? lastScale : nextScale;
                    }
                }
            }
        }
    }

    r.readUE();                                          // log2_max_frame_num_minus4
    const pic_order_cnt_type = r.readUE();
    if (pic_order_cnt_type === 0) r.readUE();            // log2_max_pic_order_cnt_lsb_minus4
    else if (pic_order_cnt_type === 1) {
        r.readBit();                                     // delta_pic_order_always_zero_flag
        r.readSE();                                      // offset_for_non_ref_pic
        r.readSE();                                      // offset_for_top_to_bottom_field
        const n = r.readUE();
        for (let i = 0; i < n; i++) r.readSE();
    }
    r.readUE();                                          // max_num_ref_frames
    r.readBit();                                         // gaps_in_frame_num_value_allowed_flag

    const pic_width_in_mbs_minus1       = r.readUE();
    const pic_height_in_map_units_minus1 = r.readUE();
    const frame_mbs_only_flag           = r.readBit();
    if (!frame_mbs_only_flag) r.readBit();               // mb_adaptive_frame_field_flag
    r.readBit();                                         // direct_8x8_inference_flag

    const frame_cropping_flag = r.readBit();
    let cropLeft = 0, cropRight = 0, cropTop = 0, cropBottom = 0;
    if (frame_cropping_flag) {
        cropLeft   = r.readUE();
        cropRight  = r.readUE();
        cropTop    = r.readUE();
        cropBottom = r.readUE();
    }

    const width  = (pic_width_in_mbs_minus1 + 1) * 16 - (cropLeft + cropRight) * 2;
    const height = (2 - frame_mbs_only_flag) * (pic_height_in_map_units_minus1 + 1) * 16 - (cropTop + cropBottom) * 2;
    return { width, height };
}

/**
 * Extract coded width/height from a base64 avcC/hvcC description.
 * For H.264 (avcC) we parse the first SPS.
 * For H.265 we can't easily parse the SPS without a full HEVC parser — return null.
 */
function dimsFromDescription(descBase64, type) {
    if (!descBase64) return null;
    const buf = Buffer.from(descBase64, 'base64');

    if (type === 'h264') {
        // avcC layout: [cfgVer(1)][profile(1)][compat(1)][level(1)][lenSize(1)][numSPS(1)][SPS_len(2)][SPS...]
        if (buf.length < 8) return null;
        const numSPS = buf[5] & 0x1f;
        if (numSPS < 1) return null;
        const spsLen = buf.readUInt16BE(6);
        if (buf.length < 8 + spsLen) return null;
        const spsNal = buf.subarray(8, 8 + spsLen);
        // First byte is the NAL header (forbidden_zero_bit + nal_ref_idc + nal_unit_type)
        const payload = removeEmulationPrevention(spsNal.subarray(1));
        try { return parseH264SPS(payload); } catch { return null; }
    }

    // h265 (hvcC) parsing is much more involved — not implemented here
    return null;
}

// ─── MP4 probe (sibling file) ────────────────────────────────────────────────

function dimsFromSiblingMp4(afPath) {
    const mp4Path = afPath.replace(/\.af$/i, '.mp4');
    if (!fs.existsSync(mp4Path)) return null;

    const probe = spawnSync('ffprobe', [
        '-v', 'quiet',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height',
        '-of', 'default=noprint_wrappers=1:nokey=0',
        mp4Path
    ], { encoding: 'utf8' });

    if (probe.status !== 0) return null;
    const out = probe.stdout || '';
    const w = parseInt((out.match(/width=(\d+)/)  || [])[1], 10);
    const h = parseInt((out.match(/height=(\d+)/) || [])[1], 10);
    if (!w || !h) return null;
    return { width: w, height: h, source: path.basename(mp4Path) };
}

// ─── .af read/write ──────────────────────────────────────────────────────────

function readAf(filePath) {
    const buf = fs.readFileSync(filePath);
    if (buf.length < 4) throw new Error('File too small');
    const manifestEnd = buf.length - 4;
    const dataEnd     = buf.readUInt32LE(manifestEnd);   // footer: offset where manifest starts
    const manifestBuf = buf.subarray(dataEnd, manifestEnd);
    const dataBuf     = buf.subarray(0, dataEnd);

    let manifest;
    try { manifest = JSON.parse(manifestBuf.toString('utf8')); }
    catch (e) { throw new Error('Could not parse manifest JSON: ' + e.message); }

    return { dataBuf, manifest, dataEnd };
}

function writeAf(filePath, dataBuf, manifest) {
    const manifestBuf = Buffer.from(JSON.stringify(manifest));
    const footer = Buffer.alloc(4);
    footer.writeUInt32LE(dataBuf.length, 0);
    fs.writeFileSync(filePath, Buffer.concat([dataBuf, manifestBuf, footer]));
}

// ─── Patch a single file ─────────────────────────────────────────────────────

function patchFile(afPath) {
    const name = path.basename(afPath);
    let info;
    try { info = readAf(afPath); }
    catch (e) { console.error(`✗  ${name}: ${e.message}`); return false; }

    const { dataBuf, manifest } = info;

    if (manifest.width && manifest.height) {
        console.log(`•  ${name}: already has ${manifest.width}×${manifest.height}, skipping`);
        return false;
    }

    let dims = null, src = null;

    if (forcedW && forcedH) {
        dims = { width: forcedW, height: forcedH };
        src = 'CLI flags';
    }
    if (!dims) {
        const fromMp4 = dimsFromSiblingMp4(afPath);
        if (fromMp4) { dims = fromMp4; src = `sibling ${fromMp4.source}`; }
    }
    if (!dims) {
        const fromSps = dimsFromDescription(manifest.description, manifest.type || 'h264');
        if (fromSps) { dims = fromSps; src = 'SPS'; }
    }

    if (!dims) {
        console.error(`✗  ${name}: could not resolve dimensions (no --width/--height, no sibling .mp4, SPS unparsable for ${manifest.type || '?'})`);
        return false;
    }

    manifest.width = dims.width;
    manifest.height = dims.height;

    if (dryRun) {
        console.log(`→  ${name}: would set ${dims.width}×${dims.height} (from ${src})`);
        return true;
    }

    const backup = afPath + '.bak';
    if (!fs.existsSync(backup)) fs.copyFileSync(afPath, backup);

    writeAf(afPath, dataBuf, manifest);
    console.log(`✓  ${name}: patched to ${dims.width}×${dims.height} (from ${src}, backup: ${path.basename(backup)})`);
    return true;
}

// ─── Main ────────────────────────────────────────────────────────────────────

const stat = fs.existsSync(target) && fs.statSync(target);
if (!stat) { console.error(`Target not found: ${target}`); process.exit(1); }

let patched = 0, total = 0;
if (stat.isDirectory()) {
    const files = fs.readdirSync(target).filter(f => f.toLowerCase().endsWith('.af'));
    for (const f of files) { total++; if (patchFile(path.join(target, f))) patched++; }
} else {
    total = 1;
    if (patchFile(target)) patched++;
}

console.log(`\nDone: ${patched}/${total} patched${dryRun ? ' (dry-run)' : ''}`);

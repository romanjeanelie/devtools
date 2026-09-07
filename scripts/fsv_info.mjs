#!/usr/bin/env node
/**
 * fsv_info.mjs — Display metadata from a .fsv file
 * Usage: node fsv_info.mjs <file.fsv>
 */

import fs from 'fs';

const file = process.argv[2];
if (!file) {
    console.error('Usage: node fsv_info.mjs <file.fsv>');
    process.exit(1);
}

const buf = fs.readFileSync(file);
const stats = fs.statSync(file);

const parsed = parseFsvBuffer(buf);
if (!parsed.ok) {
    console.error('Error:', parsed.error);
    process.exit(1);
}

const { manifest, dataSize, manifestSize, hasAlphaTrack, alphaSize } = parsed;

console.log('File:         ', file);
console.log('Size:         ', (stats.size / 1024 / 1024).toFixed(2), 'MB');
console.log('');
console.log('Codec:        ', manifest.config?.codec || manifest.codec || '?');
console.log('Dimensions:   ', `${manifest.config?.codedWidth || manifest.width}×${manifest.config?.codedHeight || manifest.height}`);
console.log('FPS:          ', manifest.fps?.toFixed(2) || '?');
console.log('Frames:       ', manifest.length || manifest.frames?.length || '?');
console.log('Duration:     ', ((manifest.duration || 0)).toFixed(2), 's');
console.log('');
console.log('Alpha track:  ', hasAlphaTrack || manifest.alphaConfig ? 'Yes' : 'No');
if (hasAlphaTrack) {
    console.log('Alpha size:   ', (alphaSize / 1024 / 1024).toFixed(2), 'MB');
}
if (manifest.alphaConfig) {
    console.log('Alpha codec:  ', manifest.alphaConfig.codec);
}
console.log('');
console.log('Data size:    ', (dataSize / 1024 / 1024).toFixed(2), 'MB');
console.log('Manifest size:', (manifestSize / 1024).toFixed(2), 'KB');

/** @plutotcool/fsv layout — see node_modules/@plutotcool/fsv/dist/core/Demuxer.mjs */
function parseFsvBuffer(buf) {
    const alphaOffset = buf.readUInt32LE(0);
    const colorStart = alphaOffset ? 4 : 0;
    const colorEnd = alphaOffset || buf.length;

    const color = parseTrack(buf, colorStart, colorEnd);
    if (color.ok) {
        return { ...color, hasAlphaTrack: alphaOffset > 0, alphaSize: alphaOffset ? buf.length - alphaOffset : 0 };
    }

    const dataEnd = buf.readUInt32LE(buf.length - 4);
    if (dataEnd > 0 && dataEnd < buf.length - 4 && buf[dataEnd] === 0x7b) {
        const manifestBuf = buf.subarray(dataEnd, buf.length - 4);
        try {
            const manifest = JSON.parse(manifestBuf.toString('utf8'));
            return { ok: true, manifest, manifestSize: manifestBuf.length, dataSize: dataEnd };
        } catch {
            return { ok: false, error: 'Failed to parse legacy manifest JSON' };
        }
    }

    return { ok: false, error: color.error || 'Not a valid .fsv file' };
}

function parseTrack(buf, trackStart, trackEnd) {
    if (trackStart + 8 > trackEnd) {
        return { ok: false, error: 'File too small for FSV track header' };
    }
    const manifestSize = buf.readUInt32LE(trackStart + 4);
    const manifestStart = trackStart + 8;
    const manifestEnd = manifestStart + manifestSize;

    if (manifestSize <= 0 || manifestEnd > trackEnd) {
        return { ok: false, error: `Invalid manifest size: ${manifestSize}` };
    }
    if (buf[manifestStart] !== 0x7b) {
        return { ok: false, error: 'Manifest does not start with JSON' };
    }

    const manifestBuf = buf.subarray(manifestStart, manifestEnd);
    try {
        const manifest = JSON.parse(manifestBuf.toString('utf8'));
        return { ok: true, manifest, manifestSize, dataSize: trackEnd - manifestEnd };
    } catch {
        return { ok: false, error: 'Failed to parse manifest JSON' };
    }
}

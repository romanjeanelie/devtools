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

let manifest;
let dataSize;
let manifestSize;

// Try format 1: manifest at beginning (header: 8 bytes with sizes + manifest)
const firstU32 = buf.readUInt32LE(0);
const secondU32 = buf.readUInt32LE(8);

if (buf[12] === 0x7b && secondU32 > 0 && secondU32 < buf.length) {
  // Format 1: [dataSize:u32][padding:4][manifestSize:u32][manifest JSON][video data]
  manifestSize = secondU32;
  const manifestBuf = buf.subarray(12, 12 + manifestSize);
  manifest = JSON.parse(manifestBuf.toString('utf8'));
  dataSize = buf.length - 12 - manifestSize;
} else {
  // Format 2: manifest at end (footer: last 4 bytes = offset)
  const manifestOffset = buf.readUInt32LE(buf.length - 4);
  const manifestBuf = buf.subarray(manifestOffset, buf.length - 4);
  manifest = JSON.parse(manifestBuf.toString('utf8'));
  dataSize = manifestOffset;
  manifestSize = manifestBuf.length;
}

console.log('File:         ', file);
console.log('Size:         ', (stats.size / 1024 / 1024).toFixed(2), 'MB');
console.log('');
console.log('Codec:        ', manifest.config?.codec || manifest.codec || '?');
console.log('Dimensions:   ', `${manifest.width}×${manifest.height}`);
console.log('FPS:          ', manifest.fps?.toFixed(2) || '?');
console.log('Frames:       ', manifest.length || manifest.frames?.length || '?');
console.log('Duration:     ', ((manifest.duration || 0)).toFixed(2), 's');
console.log('');
console.log('Alpha track:  ', manifest.alphaConfig ? 'Yes' : 'No');
if (manifest.alphaConfig) {
    console.log('Alpha codec:  ', manifest.alphaConfig.codec);
}
console.log('');
console.log('Data size:    ', (dataSize / 1024 / 1024).toFixed(2), 'MB');
console.log('Manifest size:', (manifestSize / 1024).toFixed(2), 'KB');

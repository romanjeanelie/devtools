#!/usr/bin/env node
/**
 * fsv_convert.mjs — Wrapper around @plutotcool/fsv Converter API
 * to fix the h265 profile bug (hardcoded "baseline" in the CLI).
 *
 * Usage:
 *   node fsv_convert.mjs <input.webm> <output.fsv> \
 *     --input-codec=libvpx-vp9 \
 *     --output-codec=libx265 \
 *     --crf=20 \
 *     --gop=5 \
 *     --alpha \
 *     [--debug]
 */

import { Converter } from '@plutotcool/fsv/core/Converter';

// ─── Parse CLI args ───────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let inputFile = null;
let outputFile = null;
let inputCodec = null;
let outputCodec = 'libx264';
let crf = 20;
let gop = 5;
let alpha = false;
let debug = false;

for (const arg of args) {
    if (arg.startsWith('--input-codec='))   inputCodec   = arg.slice(14);
    else if (arg.startsWith('--output-codec=')) outputCodec = arg.slice(15);
    else if (arg.startsWith('--crf='))       crf          = parseInt(arg.slice(6), 10);
    else if (arg.startsWith('--gop='))       gop          = parseInt(arg.slice(6), 10);
    else if (arg === '--alpha')              alpha        = true;
    else if (arg === '--debug')              debug        = true;
    else if (!inputFile)                     inputFile    = arg;
    else if (!outputFile)                    outputFile   = arg;
}

if (!inputFile || !outputFile) {
    console.error('Usage: node fsv_convert.mjs <input> <output> [--input-codec=...] [--output-codec=...] [--crf=N] [--gop=N] [--alpha] [--debug]');
    process.exit(1);
}

// ─── Resolve encoder profile based on codec ──────────────────────────────────

let profile = 'baseline';
let level = '5.1';

if (outputCodec === 'libx265') {
    profile = 'main';
    level = '5.1';
} else if (outputCodec === 'libx264') {
    profile = 'baseline';
    level = '5.1';
}

// ─── Build encoder options ───────────────────────────────────────────────────

const encoderOptions = {
    gopSize: gop,
    options: {
        crf,
        preset: 'slower',
        tune: 'fastdecode',
        profile,
        level,
        sc_threshold: '0',
        movflags: '+faststart',
        refs: '1'
    }
};

// ─── Run conversion ───────────────────────────────────────────────────────────

if (debug) {
    console.log('Input:        ', inputFile);
    console.log('Output:       ', outputFile);
    console.log('Input codec:  ', inputCodec || 'auto');
    console.log('Output codec: ', outputCodec);
    console.log('CRF:          ', crf);
    console.log('GOP:          ', gop);
    console.log('Alpha:        ', alpha);
    console.log('Profile:      ', profile);
    console.log('Level:        ', level);
    console.log('');
}

try {
    await Converter.convert(inputFile, outputFile, {
        alpha,
        inputCodec,
        outputCodec,
        encoder: encoderOptions,
        debug
    });
    console.log('✅ Conversion complete:', outputFile);
} catch (err) {
    console.error('❌ Conversion failed:', err.message);
    if (debug) console.error(err);
    process.exit(1);
}

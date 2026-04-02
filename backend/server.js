import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import { join, resolve, normalize } from 'path';
import { tmpdir } from 'os';
import cors from 'cors';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// All scripts live one level up in /scripts
const ROOT = resolve(import.meta.dirname, '..');
const SCRIPTS_DIR = join(ROOT, 'scripts');
const SCRIPTS_JSON = join(SCRIPTS_DIR, 'scripts.json');

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ─── Security ─────────────────────────────────────────────────────────────────

/** Only allow alphanumerics, hyphens, underscores, dots, slashes for param keys */
function sanitizeKey(key) {
  return key.replace(/[^a-zA-Z0-9_-]/g, '');
}

/** Strip shell-dangerous characters from param values */
function sanitizeValue(val) {
  return String(val).replace(/[;&|`$(){}!\n\r]/g, '');
}

/** Ensure a resolved path stays within an allowed root */
function guardPath(targetPath, allowedRoot) {
  const normalized = normalize(resolve(targetPath));
  if (!normalized.startsWith(normalize(allowedRoot))) {
    throw new Error('Path traversal attempt blocked');
  }
  return normalized;
}

// ─── Active process tracking ──────────────────────────────────────────────────

let activeProcess = null;

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(msg);
  });
}

// ─── WebSocket ────────────────────────────────────────────────────────────────

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({ type: 'connected' }));
});

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /scripts — list from scripts.json
app.get('/scripts', (req, res) => {
  try {
    const scripts = JSON.parse(readFileSync(SCRIPTS_JSON, 'utf8'));
    res.json(scripts);
  } catch (e) {
    res.status(500).json({ error: 'Failed to load scripts.json: ' + e.message });
  }
});

// GET /script-content?path=./scripts/foo.sh — read a script file
app.get('/script-content', (req, res) => {
  try {
    const rawPath = req.query.path;
    if (!rawPath) return res.status(400).json({ error: 'Missing path' });

    // Resolve relative to project root
    const fullPath = guardPath(join(ROOT, rawPath), SCRIPTS_DIR);
    if (!existsSync(fullPath)) return res.status(404).json({ error: 'Script not found' });

    res.json({ content: readFileSync(fullPath, 'utf8') });
  } catch (e) {
    res.status(403).json({ error: e.message });
  }
});

// PUT /script-content — save edits
app.put('/script-content', (req, res) => {
  try {
    const { path: rawPath, content } = req.body;
    if (!rawPath || content === undefined) return res.status(400).json({ error: 'Missing fields' });

    const fullPath = guardPath(join(ROOT, rawPath), SCRIPTS_DIR);
    writeFileSync(fullPath, content, 'utf8');
    res.json({ success: true });
  } catch (e) {
    res.status(403).json({ error: e.message });
  }
});

// POST /run — execute a script
app.post('/run', (req, res) => {
  if (activeProcess) {
    return res.status(409).json({ error: 'A process is already running. Stop it first.' });
  }

  const { scriptPath, input, params } = req.body;
  if (!scriptPath) return res.status(400).json({ error: 'scriptPath is required' });

  let fullScriptPath;
  try {
    fullScriptPath = guardPath(join(ROOT, scriptPath), SCRIPTS_DIR);
  } catch (e) {
    return res.status(403).json({ error: e.message });
  }

  if (!existsSync(fullScriptPath)) {
    return res.status(404).json({ error: 'Script file not found: ' + fullScriptPath });
  }

  // Build argument list — no shell interpolation (spawn, not exec)
  const args = [fullScriptPath];
  if (input) args.push(`--input=${sanitizeValue(input)}`);
  if (params && typeof params === 'object') {
    for (const [k, v] of Object.entries(params)) {
      if (v !== '' && v !== null && v !== undefined) {
        args.push(`--${sanitizeKey(k)}=${sanitizeValue(v)}`);
      }
    }
  }

  broadcast({ type: 'start', script: scriptPath });

  const proc = spawn('bash', args, {
    cwd: SCRIPTS_DIR,
    env: { ...process.env, TERM: 'dumb' },
  });

  activeProcess = proc;
  res.json({ pid: proc.pid });

  proc.stdout.on('data', (d) => broadcast({ type: 'log', stream: 'stdout', data: d.toString() }));
  proc.stderr.on('data', (d) => broadcast({ type: 'log', stream: 'stderr', data: d.toString() }));

  proc.on('close', (code) => {
    activeProcess = null;
    broadcast({ type: 'done', code });
  });

  proc.on('error', (err) => {
    activeProcess = null;
    broadcast({ type: 'error', message: err.message });
  });
});

// POST /stop — kill the active process
app.post('/stop', (req, res) => {
  if (!activeProcess) return res.status(400).json({ error: 'No active process' });
  activeProcess.kill('SIGTERM');
  res.json({ success: true });
});

// GET /font-glyphs — list all printable codepoints in a font via fontTools
app.get('/font-glyphs', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'Missing path' });

  const PYTHON = `
import sys, json
from fontTools.ttLib import TTFont

def get_block(cp):
    if 0x0020 <= cp <= 0x007E: return 'Basic Latin'
    if 0x00A0 <= cp <= 0x00FF: return 'Latin-1 Supplement'
    if 0x0100 <= cp <= 0x017F: return 'Latin Extended-A'
    if 0x0180 <= cp <= 0x024F: return 'Latin Extended-B'
    if 0x0250 <= cp <= 0x02AF: return 'IPA Extensions'
    if 0x02B0 <= cp <= 0x02FF: return 'Spacing Modifiers'
    if 0x0300 <= cp <= 0x036F: return 'Combining Diacritics'
    if 0x0370 <= cp <= 0x03FF: return 'Greek & Coptic'
    if 0x0400 <= cp <= 0x04FF: return 'Cyrillic'
    if 0x0500 <= cp <= 0x052F: return 'Cyrillic Supplement'
    if 0x1E00 <= cp <= 0x1EFF: return 'Latin Extended Additional'
    if 0x2000 <= cp <= 0x206F: return 'General Punctuation'
    if 0x2070 <= cp <= 0x209F: return 'Superscripts & Subscripts'
    if 0x20A0 <= cp <= 0x20CF: return 'Currency Symbols'
    if 0x2100 <= cp <= 0x214F: return 'Letterlike Symbols'
    if 0x2150 <= cp <= 0x218F: return 'Number Forms'
    if 0x2190 <= cp <= 0x21FF: return 'Arrows'
    if 0x2200 <= cp <= 0x22FF: return 'Mathematical Operators'
    if 0xFB00 <= cp <= 0xFB4F: return 'Alphabetic Presentation'
    return 'Other'

path = sys.argv[1]
font = TTFont(path, lazy=True)
cmap = font.getBestCmap()
if not cmap:
    print(json.dumps([]))
    sys.exit(0)

chars = []
for cp in sorted(cmap.keys()):
    try:
        ch = chr(cp)
        if ch.isprintable():
            chars.append({'cp': cp, 'char': ch, 'block': get_block(cp)})
    except:
        pass
print(json.dumps(chars))
`;

  const proc = spawn('python3', ['-c', PYTHON, filePath]);
  let out = '';
  proc.stdout.on('data', (d) => out += d);
  proc.stderr.on('data', () => {});
  proc.on('close', (code) => {
    if (code !== 0) return res.status(500).json({ error: 'fontTools not available — install with: pip install fonttools' });
    try { res.json(JSON.parse(out)); }
    catch { res.status(500).json({ error: 'Parse error' }); }
  });
});

// GET /file-stat — return file size in bytes + kb
app.get('/file-stat', (req, res) => {
  const filePath = req.query.path;
  if (!filePath || !existsSync(filePath)) return res.json({ size: 0 });
  try {
    const { size } = statSync(filePath);
    res.json({ size, sizeKb: (size / 1024).toFixed(1) });
  } catch (e) {
    res.json({ size: 0 });
  }
});

// POST /save-temp — save pasted content to a temp file, return path
app.post('/save-temp', (req, res) => {
  const { content, ext } = req.body;
  if (!content || !ext) return res.status(400).json({ error: 'Missing content or ext' });
  if (!/^[a-z0-9]+$/.test(ext)) return res.status(400).json({ error: 'Invalid ext' });
  try {
    const name = `scripts-gui-${Date.now()}.${ext}`;
    const filePath = join(tmpdir(), name);
    writeFileSync(filePath, content, 'utf8');
    res.json({ path: filePath });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /probe — read video metadata via ffprobe
app.get('/probe', (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).json({ error: 'Missing path' });

  const proc = spawn('ffprobe', [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_streams',
    '-show_format',
    filePath,
  ]);

  let out = '';
  proc.stdout.on('data', (d) => out += d);
  proc.on('close', (code) => {
    if (code !== 0) return res.status(500).json({ error: 'ffprobe failed' });
    try {
      const data = JSON.parse(out);
      const video = data.streams?.find((s) => s.codec_type === 'video');
      if (!video) return res.status(422).json({ error: 'No video stream found' });

      // r_frame_rate is a fraction like "30/1" or "30000/1001"
      const [num, den] = (video.r_frame_rate || '0/1').split('/').map(Number);
      const fps = den ? Math.round((num / den) * 100) / 100 : 0;

      res.json({
        fps,
        codec:    video.codec_name,
        width:    video.width,
        height:   video.height,
        format:   data.format?.format_long_name,
        duration: parseFloat(data.format?.duration || 0),
      });
    } catch {
      res.status(500).json({ error: 'Failed to parse ffprobe output' });
    }
  });
});

// GET /status — quick health check
app.get('/status', (req, res) => {
  res.json({ running: !!activeProcess, pid: activeProcess?.pid ?? null });
});

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`[backend] http://localhost:${PORT}`);
  console.log(`[backend] scripts dir: ${SCRIPTS_DIR}`);
});

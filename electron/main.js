const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const { spawn }  = require('child_process');
const { connect } = require('net');
const path = require('path');
const fs = require('fs').promises;

const DEV          = process.env.NODE_ENV === 'development';
const FRONTEND_URL = 'http://localhost:5173';
const BACKEND_PORT = 3001;

let win = null;
let backendProc = null;

// ── Start Express backend ─────────────────────────────────────────────────────
function startBackend() {
  const serverPath = path.join(__dirname, '../backend/server.js');

  backendProc = spawn(process.execPath, [serverPath], {
    env:   { ...process.env, PORT: String(BACKEND_PORT) },
    stdio: 'inherit',
    cwd:   path.join(__dirname, '..'),
  });

  backendProc.on('error', (err) => console.error('[backend]', err.message));
}

// ── Poll until a TCP port accepts connections ─────────────────────────────────
function waitForPort(port, timeout = 15_000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeout;

    function attempt() {
      const sock = connect(port, '127.0.0.1');
      sock.once('connect', () => { sock.destroy(); resolve(); });
      sock.once('error',   () => {
        sock.destroy();
        if (Date.now() > deadline) return reject(new Error(`Port ${port} not ready`));
        setTimeout(attempt, 300);
      });
    }
    attempt();
  });
}

// ── Create window ─────────────────────────────────────────────────────────────
async function createWindow() {
  win = new BrowserWindow({
    width:  1280,
    height: 820,
    minWidth:  900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',   // macOS traffic lights inside window
    backgroundColor: '#070711',
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Open external links in the system browser, not in Electron
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (DEV) {
    // Wait for Vite dev server too
    await waitForPort(5173).catch(() => {});
    win.loadURL(FRONTEND_URL);
    win.webContents.openDevTools({ mode: 'bottom' });
  } else {
    win.loadFile(path.join(__dirname, '../frontend/dist/index.html'));
  }
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  startBackend();

  try {
    await waitForPort(BACKEND_PORT);
  } catch {
    console.warn('[electron] Backend did not start in time — opening anyway');
  }

  await createWindow();
});

app.on('window-all-closed', () => {
  backendProc?.kill('SIGTERM');
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  backendProc?.kill('SIGTERM');
});

ipcMain.handle('open-folder-dialog', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    properties: ['openDirectory', 'createDirectory'],
  });
  return canceled ? null : filePaths[0];
});

ipcMain.handle('read-file', async (event, filePath) => {
  return await fs.readFile(filePath);
});

ipcMain.handle('get-file-stat', async (event, filePath) => {
  const stats = await fs.stat(filePath);
  return { size: stats.size, sizeKb: (stats.size / 1024).toFixed(1) };
});

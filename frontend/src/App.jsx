import { FileDropZone } from '@/components/FileDropZone';
import { FsvInfo } from '@/components/FsvInfo';
import { LogConsole, LogOutput, CopyLogsButton } from '@/components/LogConsole';
import { ParamsPanel } from '@/components/ParamsPanel';
import { ScriptEditor } from '@/components/ScriptEditor';
import { ScriptList } from '@/components/ScriptList';
import { isAbsolutePath } from '@/lib/droppedPath';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { AlertCircle, Code2, Play, Square, Terminal, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

const BACKEND     = 'http://localhost:3001';
const WS_URL      = 'ws://localhost:3001';
const STORAGE_KEY = 'scripts-gui-params';

function getParamSummary(paramList, values) {
  const items = [];
  function collect(params) {
    params?.forEach((p) => {
      // A param hidden by showWhen must not show up in the summary either
      if (p.showWhen && String(values[p.showWhen.param] ?? '') !== String(p.showWhen.value)) return;
      if (p.summary) {
        const val = values[p.name] ?? p.default ?? '';
        items.push(`${val}${p.suffix || ''}`);
      }
      if (p.params) collect(p.params);
    });
  }
  collect(paramList);
  return items;
}

function loadSavedParams() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
  catch { return {}; }
}

function saveParams(scriptPath, params) {
  try {
    const all = loadSavedParams();
    all[scriptPath] = params;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {}
}

export default function App() {
  const [scripts, setScripts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [showFsvInfo, setShowFsvInfo] = useState(false);
  const [inputPath, setInputPath] = useState('');
  const [videoMeta, setVideoMeta] = useState(null);
  const [fontGlyphs, setFontGlyphs] = useState(null);
  const [fileStat, setFileStat] = useState(null);   // { sizeKb }
  const [runResult, setRunResult] = useState(null); // { savedKb, reductionPct }
  const [params, setParams] = useState({});
  const [logs, setLogs] = useState([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [editorPanel, setEditorPanel] = useState(false);
  const [consoleModal, setConsoleModal] = useState(false);
  const [consoleHeight, setConsoleHeight] = useState(208); // px
  const [showConsole, setShowConsole]     = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = parseInt(localStorage.getItem('scripts-gui-sidebar-width'), 10);
    return Number.isFinite(saved) && saved >= 160 && saved <= 600 ? saved : 224;
  });
  const sidebarWidthRef = useRef(sidebarWidth);
  useEffect(() => { sidebarWidthRef.current = sidebarWidth; }, [sidebarWidth]);
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef(null);
  const reconnectTimer = useRef(null);
  const destroyed = useRef(false);

  // ── WebSocket ──────────────────────────────────────────────────────────────
  useEffect(() => {
    destroyed.current = false;

    function connect() {
      if (destroyed.current) return;
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => setWsConnected(true);
      ws.onclose = () => {
        setWsConnected(false);
        if (!destroyed.current) {
          reconnectTimer.current = setTimeout(connect, 2000);
        }
      };
      ws.onerror = () => ws.close();
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === 'connected') return;
        if (msg.type === 'start') { setRunning(true); setRunResult(null); setShowConsole(true); }
        if (msg.type === 'done' || msg.type === 'error') setRunning(false);
        // Parse svgo savings from log lines
        if (msg.type === 'log' && msg.text) {
          const m = msg.text.match(/Total saved:\s*([\d.]+)\s*KB/);
          if (m) setRunResult({ savedKb: m[1] });
          const m2 = msg.text.match(/(-[\d.]+%)/);
          if (m2) setRunResult((prev) => prev ? { ...prev, reductionPct: m2[1] } : { reductionPct: m2[1] });
        }
        setLogs((prev) => [...prev, msg]);
      };
    }

    connect();
    return () => {
      destroyed.current = true;
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, []);

  // ── Console resize ─────────────────────────────────────────────────────────
  function startResize(e) {
    e.preventDefault();
    const startY = e.clientY;
    const startH = consoleHeight;

    function onMove(ev) {
      const delta = startY - ev.clientY;
      setConsoleHeight(Math.min(Math.max(startH + delta, 80), window.innerHeight * 0.8));
    }
    function onUp() {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // ── Load scripts ───────────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${BACKEND}/scripts`)
      .then((r) => r.json())
      .then((data) => {
        setScripts(Array.isArray(data) ? data : []);
      })
      .catch(() => setError('Failed to connect to backend. Is it running?'));
  }, []);

  // ── Select script ──────────────────────────────────────────────────────────
  function handleSelectScript(script) {
    setSelected(script);
    setShowFsvInfo(false);
    setEditorPanel(false);
    // Restore saved params for this script
    const saved = loadSavedParams()[script.path] || {};
    const defaults = {};
    function collectDefaults(paramList) {
      paramList?.forEach((p) => {
        if (p.type === 'row-group' || p.type === 'column-group') {
          collectDefaults(p.params);
        } else if (p.type === 'toggle-group') {
          defaults[p.name] = saved[p.name] ?? p.default ?? false;
          collectDefaults(p.params);
        } else {
          defaults[p.name] = saved[p.name] ?? p.default ?? '';
        }
      });
    }
    collectDefaults(script.params);
    setParams(defaults);
  }

  function handleInputChange(path) {
    setInputPath(path);
    setVideoMeta(null);
    setFontGlyphs(null);
    setFileStat(null);
    setRunResult(null);
    if (!path) return;
    if (selected?.inputType === 'folder') return;
    const ext = path.split('.').pop().toLowerCase();
    if (['ttf', 'otf', 'woff', 'woff2'].includes(ext)) {
      fetch(`${BACKEND}/font-glyphs?path=${encodeURIComponent(path)}`)
        .then((r) => r.json())
        .then((data) => { setFontGlyphs(Array.isArray(data) ? data : { error: data.error }); })
        .catch((e) => { setFontGlyphs({ error: e.message }); });
    } else if (ext === 'svg') {
      fetch(`${BACKEND}/file-stat?path=${encodeURIComponent(path)}`)
        .then((r) => r.json())
        .then((data) => { if (data.sizeKb) setFileStat(data); })
        .catch(() => {});
    } else {
      fetch(`${BACKEND}/probe?path=${encodeURIComponent(path)}`)
        .then((r) => r.json())
        .then((data) => { if (!data.error) setVideoMeta(data); })
        .catch(() => {});
    }
  }

  function handleParamChange(name, value) {
    setParams((prev) => {
      const next = { ...prev, [name]: value };
      if (selected) saveParams(selected.path, next);
      return next;
    });
  }

  // ── Run ────────────────────────────────────────────────────────────────────
  async function handleRun() {
    if (!selected) return;
    setError('');
    setLogs([]);
    try {
      const res = await fetch(`${BACKEND}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scriptPath: selected.path, input: inputPath, params }),
      });
      const data = await res.json();
      if (data.error) setError(data.error);
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleStop() {
    await fetch(`${BACKEND}/stop`, { method: 'POST' });
  }

  const canRun = !!selected && isAbsolutePath(inputPath) && !running;

  // ── Layout ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen bg-background overflow-hidden">
      {/* Top bar */}
      <header className="flex items-center justify-between pl-20 pr-4 h-10 border-b border-border shrink-0 select-none" style={{ WebkitAppRegion: 'drag' }}>
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm tracking-tight">Scripts GUI</span>
          <Badge variant="outline" className="text-[10px] py-0 h-4">local</Badge>
        </div>
        <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' }}>
          <span className={`h-1.5 w-1.5 rounded-full ${wsConnected ? 'bg-emerald-400' : 'bg-red-400 animate-pulse'}`} />
          <span className="text-[11px] text-muted-foreground">
            {wsConnected ? 'connected' : 'disconnected'}
          </span>
        </div>
      </header>

      {/* Body: sidebar + right column (main + console) */}
      <div className="flex min-h-0 flex-1">

        {/* ── Left: script list — full height (resizable) */}
        <aside
          className="shrink-0 border-r border-border flex flex-col relative"
          style={{ width: sidebarWidth }}
        >
          <ScriptList
            scripts={scripts}
            selected={selected}
            onSelect={handleSelectScript}
            onEdit={(script) => { handleSelectScript(script); setEditorPanel(true); }}
            onFsvInfo={() => { setShowFsvInfo(true); setSelected(null); setEditorPanel(false); }}
            showFsvInfo={showFsvInfo}
          />
          {/* Drag handle */}
          <div
            className="absolute top-0 right-0 h-full w-1 cursor-col-resize hover:bg-primary/40 active:bg-primary/60 transition-colors z-10"
            onMouseDown={(e) => {
              e.preventDefault();
              const startX = e.clientX;
              const startWidth = sidebarWidth;
              const onMove = (ev) => {
                const next = Math.min(600, Math.max(160, startWidth + (ev.clientX - startX)));
                setSidebarWidth(next);
              };
              const onUp = () => {
                document.removeEventListener('mousemove', onMove);
                document.removeEventListener('mouseup', onUp);
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
                try { localStorage.setItem('scripts-gui-sidebar-width', String(sidebarWidthRef.current)); } catch {}
              };
              document.body.style.cursor = 'col-resize';
              document.body.style.userSelect = 'none';
              document.addEventListener('mousemove', onMove);
              document.addEventListener('mouseup', onUp);
            }}
          />
        </aside>

        {/* ── Right column: controls + console */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">

          {/* Center: params + editor panel */}
          <main className="flex-1 flex min-h-0 overflow-hidden">
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-1 p-4 space-y-4 overflow-y-auto">
                {error && (
                  <div className="flex items-start gap-2 text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    {error}
                  </div>
                )}

                {showFsvInfo && <FsvInfo />}

                {!selected && !showFsvInfo && (
                  <div className="text-sm text-muted-foreground text-center py-4">
                    Select a script from the left panel
                  </div>
                )}

                {selected && !showFsvInfo && (
                  <>
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-medium text-muted-foreground">Input</p>
                        <button
                          type="button"
                          onClick={() => setEditorPanel((v) => !v)}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] transition-colors ${editorPanel ? 'text-primary bg-primary/15 border border-primary/30' : 'text-muted-foreground hover:text-foreground hover:bg-accent border border-border'}`}
                        >
                          <Code2 className="h-3 w-3" />
                          Edit script
                        </button>
                      </div>
                      <FileDropZone value={inputPath} onChange={handleInputChange} meta={videoMeta} allowPaste={selected?.path?.includes('svg')} inputType={selected?.inputType} />
                      {fileStat && (
                        <div className="flex items-center gap-2 px-1 mt-1">
                          <span className="text-[11px] font-mono text-muted-foreground">{fileStat.sizeKb} KB</span>
                          {runResult?.savedKb && (
                            <>
                              <span className="text-[11px] text-muted-foreground/40">→</span>
                              <span className="text-[11px] font-mono text-emerald-400">
                                -{runResult.savedKb} KB saved
                                {runResult.reductionPct && ` (${runResult.reductionPct})`}
                              </span>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    <Separator />

                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-3">Parameters</p>
                      <ParamsPanel
                        params={selected.params}
                        values={params}
                        onChange={handleParamChange}
                        meta={videoMeta}
                        glyphs={fontGlyphs}
                      />
                    </div>
                  </>
                )}
              </div>

              {/* Sticky bottom bar */}
              {selected && (
                <div className="shrink-0 border-t border-border px-4 py-2.5 flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-1.5 flex-wrap">
                    {getParamSummary(selected.params, params).map((s, i) => (
                      <span key={i} className="text-[11px] font-mono text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded">
                        {s}
                      </span>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowConsole((v) => !v)}
                    title="Toggle console"
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] border transition-colors ${showConsole ? 'text-primary bg-primary/15 border-primary/30' : 'text-muted-foreground border-border hover:text-foreground hover:bg-accent'}`}
                  >
                    <Terminal className="h-3 w-3" />
                    Console
                    {running && <span className="h-1.5 w-1.5 rounded-full bg-yellow-400 animate-pulse" />}
                  </button>
                  {running ? (
                    <Button variant="destructive" size="sm" className="gap-1.5" onClick={handleStop}>
                      <Square className="h-3.5 w-3.5" />
                      Stop
                    </Button>
                  ) : (
                    <Button size="sm" className="gap-1.5" disabled={!canRun} onClick={handleRun}>
                      <Play className="h-3.5 w-3.5" />
                      Run
                    </Button>
                  )}
                </div>
              )}
            </div>

            {/* ── Editor side panel */}
            {editorPanel && selected && (
              <div className="w-[480px] shrink-0 border-l border-border flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
                  <span className="text-xs font-semibold text-muted-foreground truncate">{selected.name}</span>
                  <button
                    type="button"
                    onClick={() => setEditorPanel(false)}
                    className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="flex-1 overflow-hidden">
                  <ScriptEditor script={selected} />
                </div>
              </div>
            )}
          </main>

          {/* ── Bottom: log console */}
          {showConsole && (
            <div
              className="shrink-0 border-t border-border flex flex-col"
              style={{ height: consoleHeight }}
            >
              <div
                onMouseDown={startResize}
                className="h-1 w-full cursor-row-resize hover:bg-primary/40 transition-colors shrink-0"
                title="Drag to resize"
              />
              <LogConsole
                logs={logs}
                running={running}
                onClear={() => setLogs([])}
                onExpand={() => setConsoleModal(true)}
              />
            </div>
          )}

        </div>
      </div>

      {/* Console modal */}
      <Dialog open={consoleModal} onOpenChange={setConsoleModal}>
        <DialogContent className="w-[85vw] max-w-5xl h-[80vh] flex flex-col p-0">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <Terminal className="h-4 w-4 text-muted-foreground" />
              <DialogTitle className="text-sm font-semibold">Console</DialogTitle>
              {running && (
                <span className="h-1.5 w-1.5 rounded-full bg-yellow-400 animate-pulse" />
              )}
              <CopyLogsButton logs={logs} className="ml-auto mr-8" />
            </div>
          </DialogHeader>
          <LogOutput logs={logs} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

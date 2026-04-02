import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Save, RefreshCw, Copy, Check } from 'lucide-react';
import CodeMirror from '@uiw/react-codemirror';
import { StreamLanguage } from '@codemirror/language';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { oneDark } from '@codemirror/theme-one-dark';

const shellLang = StreamLanguage.define(shell);

export function ScriptEditor({ script }) {
  const [content, setContent]     = useState('');
  const [original, setOriginal]   = useState('');
  const [loading, setLoading]     = useState(false);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');
  const [savedFlash, setSavedFlash] = useState(false);

  const isDirty = content !== original;
  const [copied, setCopied] = useState(false);

  async function copyToClipboard() {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function load() {
    setLoading(true);
    setError('');
    try {
      const res  = await fetch(`http://localhost:3001/script-content?path=${encodeURIComponent(script.path)}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setContent(data.content);
      setOriginal(data.content);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      const res  = await fetch('http://localhost:3001/script-content', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: script.path, content }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setOriginal(content);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1500);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const handleKeyDown = useCallback((e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      if (isDirty) save();
    }
  }, [isDirty, content]);

  useEffect(() => { load(); }, [script.path]);

  return (
    <div className="flex flex-col h-full" onKeyDown={handleKeyDown}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">{script.path}</span>
          {isDirty    && <Badge variant="warning" className="text-[10px] py-0 h-4">unsaved</Badge>}
          {savedFlash && <Badge variant="success" className="text-[10px] py-0 h-4">saved</Badge>}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground"
            onClick={copyToClipboard}
            disabled={loading}
            title="Copy script"
          >
            {copied
              ? <Check className="h-3.5 w-3.5 text-green-500" />
              : <Copy className="h-3.5 w-3.5" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground"
            onClick={load}
            disabled={loading}
            title="Reload from disk"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={save}
            disabled={!isDirty || saving}
          >
            <Save className="h-3.5 w-3.5" />
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="px-4 py-2 bg-destructive/10 text-destructive text-xs border-b border-border shrink-0">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-auto">
        <CodeMirror
          value={content}
          extensions={[shellLang]}
          theme={oneDark}
          onChange={setContent}
          placeholder={loading ? 'Loading…' : ''}
          editable={!loading}
          basicSetup={{
            lineNumbers: true,
            foldGutter: false,
            highlightActiveLine: true,
            highlightSelectionMatches: true,
            autocompletion: false,
          }}
          style={{ fontSize: '12px', height: '100%' }}
          height="100%"
        />
      </div>
    </div>
  );
}

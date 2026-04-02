import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Trash2, Maximize2 } from 'lucide-react';

export function LogOutput({ logs }) {
  const bottomRef = useRef(null);
  const autoScrollRef = useRef(true);

  useEffect(() => {
    if (autoScrollRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  return (
    <div
      className="flex-1 overflow-y-auto console-scroll font-mono text-xs leading-5 p-3"
      onScroll={(e) => {
        const el = e.currentTarget;
        autoScrollRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
    >
      {logs.length === 0 && (
        <span className="text-muted-foreground/40">{'// Output will appear here...'}</span>
      )}
      {logs.map((entry, i) => (
        <div
          key={i}
          className={cn(
            'whitespace-pre-wrap break-all',
            entry.type === 'start'    && 'text-primary font-semibold',
            entry.type === 'done'     && (entry.code === 0 ? 'text-emerald-400 font-semibold' : 'text-destructive font-semibold'),
            entry.type === 'error'    && 'text-destructive',
            entry.stream === 'stderr' && entry.type === 'log' && 'text-yellow-400',
            entry.stream === 'stdout' && entry.type === 'log' && 'text-foreground/90',
          )}
        >
          {entry.type === 'start' && `▶  Running: ${entry.script}`}
          {entry.type === 'done'  && (entry.code === 0 ? '✓  Process exited successfully' : `✗  Process exited with code ${entry.code}`)}
          {entry.type === 'error' && `⚠  Error: ${entry.message}`}
          {entry.type === 'log'   && entry.data}
        </div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

export function LogConsole({ logs, running, onClear, onExpand }) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Console</p>
          {running && (
            <Badge variant="warning" className="gap-1 py-0 h-4">
              <span className="h-1.5 w-1.5 rounded-full bg-yellow-400 animate-pulse" />
              running
            </Badge>
          )}
          {!running && logs.length > 0 && (
            <Badge variant="outline" className="py-0 h-4 text-[10px]">{logs.length} lines</Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost" size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={onExpand}
            title="Open in modal"
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost" size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={onClear}
            title="Clear console"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <LogOutput logs={logs} />
    </div>
  );
}

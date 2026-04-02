import { cn } from '@/lib/utils';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Film, Image, FileCode2, Globe, Type, Code2, Clapperboard } from 'lucide-react';

function getScriptIcon(name) {
  const n = name.toLowerCase();
  if (n.includes('font')) return Type;
  if (n.includes('svg')) return FileCode2;
  if (n.includes('favicon')) return Globe;
  if (n.includes('web') && n.includes('video')) return Clapperboard;
  if (n.includes('video')) return Film;
  if (n.includes('png') || n.includes('webp') || n.includes('image')) return Image;
  return Film;
}

export function ScriptList({ scripts, selected, onSelect, onEdit }) {
  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-border">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Scripts</p>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {scripts.length === 0 && (
            <p className="text-xs text-muted-foreground px-2 py-4 text-center">No scripts found</p>
          )}
          {scripts.map((script) => {
            const isSelected = selected?.path === script.path;
            return (
              <div
                key={script.path}
                className={cn(
                  'group flex items-center gap-1 rounded-lg transition-colors',
                  isSelected ? 'bg-primary/15' : 'hover:bg-accent'
                )}
              >
                <button
                  onClick={() => onSelect(script)}
                  className="flex-1 flex items-center gap-2 px-3 py-2.5 text-left min-w-0"
                >
                  {(() => { const Icon = getScriptIcon(script.name); return <Icon className={cn('h-4 w-4 shrink-0', isSelected ? 'text-primary' : 'text-muted-foreground')} />; })()}
                  <span className={cn(
                    'text-sm font-medium truncate',
                    isSelected ? 'text-foreground' : 'text-muted-foreground'
                  )}>
                    {script.name}
                  </span>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onEdit(script); }}
                  title="Edit script"
                  className={cn(
                    'shrink-0 p-1.5 mr-1 rounded transition-colors text-muted-foreground hover:text-foreground hover:bg-accent',
                    isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                  )}
                >
                  <Code2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

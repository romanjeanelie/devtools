import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { Clapperboard, Code2, FileCode2, Film, Globe, Image, Info, Type } from 'lucide-react';

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

export function ScriptList({ scripts, selected, onSelect, onEdit, onFsvInfo, showFsvInfo }) {
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
          {scripts.filter((item) => !item.hidden).map((item, index) => {
            // Section header
            if (item.type === 'section') {
              return (
                <div key={`section-${index}`} className={cn('px-2 pt-3 pb-1', index > 0 && 'mt-2')}>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                    {item.title}
                  </p>
                </div>
              );
            }
            
            // Script item
            const isSelected = selected?.path === item.path && !showFsvInfo;
            return (
              <div
                key={item.path}
                className={cn(
                  'group flex items-center gap-1 rounded-lg transition-colors',
                  isSelected ? 'bg-primary/15' : 'hover:bg-accent'
                )}
              >
                <button
                  onClick={() => onSelect(item)}
                  className="flex-1 flex items-center gap-2 px-3 py-2.5 text-left min-w-0"
                >
                  {(() => { const Icon = getScriptIcon(item.name); return <Icon className={cn('h-4 w-4 shrink-0', isSelected ? 'text-primary' : 'text-muted-foreground')} />; })()}
                  <span className={cn(
                    'text-sm font-medium truncate',
                    isSelected ? 'text-foreground' : 'text-muted-foreground'
                  )}>
                    {item.name}
                  </span>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onEdit(item); }}
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
          
          <Separator className="my-2" />
          
          <button
            onClick={onFsvInfo}
            className={cn(
              'w-full flex items-center gap-2 px-3 py-2.5 text-left rounded-lg transition-colors',
              showFsvInfo ? 'bg-primary/15' : 'hover:bg-accent'
            )}
          >
            <Info className={cn('h-4 w-4 shrink-0', showFsvInfo ? 'text-primary' : 'text-muted-foreground')} />
            <span className={cn(
              'text-sm font-medium',
              showFsvInfo ? 'text-foreground' : 'text-muted-foreground'
            )}>
              FSV Info
            </span>
          </button>
        </div>
      </ScrollArea>
    </div>
  );
}

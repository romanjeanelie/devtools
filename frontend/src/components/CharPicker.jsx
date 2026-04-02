import { useMemo, useEffect } from 'react';
import { cn } from '@/lib/utils';

const FONT_EXTS = ['ttf', 'otf', 'woff', 'woff2'];

function cpToHex(cp) {
  return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
}

function parseSelected(value) {
  if (!value) return new Set();
  return new Set(value.split(',').map((s) => s.trim()).filter(Boolean));
}

function toValue(set) {
  return Array.from(set).sort().join(',');
}

export function CharPicker({ glyphs, value, onChange }) {
  const blocks = useMemo(() => {
    const map = new Map();
    glyphs?.forEach((g) => {
      if (!map.has(g.block)) map.set(g.block, []);
      map.get(g.block).push(g);
    });
    return Array.from(map.entries()).map(([name, chars]) => ({ name, chars }));
  }, [glyphs]);

  const selected = useMemo(() => parseSelected(value), [value]);

  // Select all by default when glyphs first load
  useEffect(() => {
    if (glyphs?.length && !value) {
      onChange(glyphs.map((g) => cpToHex(g.cp)).join(','));
    }
  }, [glyphs]);

  if (!glyphs) {
    return <p className="text-[11px] text-muted-foreground/40 py-1 text-center">Drop a font file to see characters</p>;
  }

  if (glyphs.error) {
    return (
      <p className="text-[11px] text-destructive/80 py-1">
        {glyphs.error.includes('fontTools')
          ? 'fontTools not found — install with: pip install fonttools brotli'
          : glyphs.error}
      </p>
    );
  }

  if (glyphs.length === 0) {
    return <p className="text-[11px] text-muted-foreground/40 py-1 text-center">No printable glyphs found</p>;
  }

  const total = glyphs.length;

  function toggleChar(cp) {
    const hex = cpToHex(cp);
    const next = new Set(selected);
    next.has(hex) ? next.delete(hex) : next.add(hex);
    onChange(toValue(next));
  }

  function toggleBlock(chars) {
    const hexes = chars.map((g) => cpToHex(g.cp));
    const allOn = hexes.every((h) => selected.has(h));
    const next = new Set(selected);
    hexes.forEach((h) => (allOn ? next.delete(h) : next.add(h)));
    onChange(toValue(next));
  }

  function selectAll()  { onChange(glyphs.map((g) => cpToHex(g.cp)).join(',')); }
  function selectNone() { onChange(''); }

  return (
    <div className="space-y-2">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {['All', 'None'].map((label) => (
            <button
              key={label}
              type="button"
              onClick={label === 'All' ? selectAll : selectNone}
              className="h-6 px-2 rounded text-[11px] border border-border text-muted-foreground hover:text-foreground hover:border-primary/50 transition-colors"
            >
              {label}
            </button>
          ))}
        </div>
        <span className="text-[11px] font-mono text-muted-foreground tabular-nums">
          {selected.size} / {total}
        </span>
      </div>

      {/* Blocks */}
      <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
        {blocks.map(({ name, chars }) => {
          const hexes = chars.map((g) => cpToHex(g.cp));
          const onCount = hexes.filter((h) => selected.has(h)).length;
          const allOn  = onCount === chars.length;
          const someOn = onCount > 0 && !allOn;

          return (
            <div key={name}>
              {/* Block header */}
              <button
                type="button"
                onClick={() => toggleBlock(chars)}
                className="w-full flex items-center justify-between mb-1 group"
              >
                <span className="text-[11px] text-muted-foreground group-hover:text-foreground transition-colors">
                  {name}
                </span>
                <span className={cn(
                  'text-[10px] font-mono tabular-nums',
                  allOn ? 'text-primary' : someOn ? 'text-yellow-400/80' : 'text-muted-foreground/30'
                )}>
                  {onCount}/{chars.length}
                </span>
              </button>

              {/* Char grid */}
              <div className="flex flex-wrap gap-0.5">
                {chars.map((g) => {
                  const hex = cpToHex(g.cp);
                  const on = selected.has(hex);
                  return (
                    <button
                      key={g.cp}
                      type="button"
                      onClick={() => toggleChar(g.cp)}
                      title={`${g.char}  ${hex}`}
                      className={cn(
                        'w-6 h-6 flex items-center justify-center rounded text-[12px] transition-colors border',
                        on
                          ? 'bg-primary/15 border-primary/30 text-foreground hover:bg-primary/25'
                          : 'bg-transparent border-transparent text-muted-foreground/25 hover:border-border hover:text-muted-foreground/60'
                      )}
                    >
                      {g.char}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { FONT_EXTS };

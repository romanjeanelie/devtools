import { CharPicker } from '@/components/CharPicker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { FolderOpen } from 'lucide-react';

function renderControl(param, currentValue, onChange, meta, glyphs) {
  if (param.type === 'slider') {
    return (
      <Slider
        id={param.name}
        min={param.min ?? 0}
        max={param.max ?? 100}
        step={1}
        steps={param.steps}
        stepLabels={param.stepLabels}
        value={[Number(currentValue || param.default)]}
        onValueChange={([v]) => onChange(param.name, v)}
      />
    );
  }

  if (param.type === 'select') {
    return (
      <Select value={currentValue} onValueChange={(v) => onChange(param.name, v)}>
        <SelectTrigger id={param.name} className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {param.options?.map((opt) => (
            <SelectItem key={opt} value={String(opt)} className="text-xs">{opt}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (param.type === 'number' || param.type === 'text') {
    return (
      <Input
        id={param.name}
        type={param.type === 'number' ? 'number' : 'text'}
        min={param.min}
        max={param.max}
        placeholder={param.placeholder ?? ''}
        className="h-8 text-xs"
        value={currentValue}
        onChange={(e) => onChange(param.name, e.target.value)}
      />
    );
  }

  if (param.type === 'preset-or-custom') {
    const limitValue = param.limitBy && meta ? meta[param.limitBy] : null;
    return (
      <div className="space-y-1">
        <div className="grid grid-cols-2 gap-1">
          {param.presets?.map((preset) => {
            const isActive = currentValue === String(preset);
            const isAboveLimit = limitValue != null && preset > limitValue;
            return (
              <button
                key={preset}
                type="button"
                onClick={() => onChange(param.name, preset)}
                className={cn(
                  'h-7 px-1 rounded text-[11px] font-mono transition-colors border',
                  isActive
                    ? 'bg-primary text-primary-foreground border-primary'
                    : isAboveLimit
                    ? 'bg-transparent text-muted-foreground/30 border-border/40 cursor-default'
                    : 'bg-transparent text-muted-foreground border-border hover:border-primary/50 hover:text-foreground'
                )}
              >
                {preset}
              </button>
            );
          })}
        </div>
        <Input
          id={param.name}
          type="number"
          min={param.min}
          max={param.max}
          placeholder="Custom…"
          className="h-7 text-[11px] font-mono"
          value={currentValue}
          onChange={(e) => onChange(param.name, e.target.value)}
        />
      </div>
    );
  }

  if (param.type === 'button-group') {
    const cols = param.options?.length === 3 ? 'grid-cols-3' : 'grid-cols-2';
    return (
      <div className={`grid ${cols} gap-1`}>
        {param.options?.map((opt) => {
          const isActive = currentValue === String(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onChange(param.name, opt)}
              className={cn(
                'h-7 px-1 rounded text-[11px] font-mono uppercase tracking-wide transition-colors border',
                isActive
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-transparent text-muted-foreground border-border hover:border-primary/50 hover:text-foreground'
              )}
            >
              {opt}
            </button>
          );
        })}
      </div>
    );
  }

  if (param.type === 'folder-picker') {
    return (
      <div className="flex gap-1.5">
        <Input
          id={param.name}
          type="text"
          placeholder={param.placeholder ?? 'Choose folder…'}
          className="h-8 text-xs flex-1 font-mono"
          value={currentValue}
          onChange={(e) => onChange(param.name, e.target.value)}
        />
        <button
          type="button"
          title="Browse…"
          onClick={async () => {
            const path = await window.electronAPI?.openFolderDialog?.();
            if (path) onChange(param.name, path);
          }}
          className="shrink-0 h-8 w-8 flex items-center justify-center rounded border border-border text-muted-foreground hover:text-foreground hover:border-primary/50 hover:bg-accent/30 transition-colors"
        >
          <FolderOpen className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  if (param.type === 'char-picker') {
    return <CharPicker glyphs={glyphs} value={currentValue} onChange={(v) => onChange(param.name, v)} />;
  }

  // Simple toggle (used inside row-group)
  if (param.type === 'toggle-group') {
    const isOn = currentValue === 'true';
    return (
      <button
        type="button"
        onClick={() => onChange(param.name, !isOn)}
        className={cn(
          'w-full h-7 rounded text-[11px] border transition-colors',
          isOn
            ? 'bg-primary/15 border-primary/30 text-primary'
            : 'bg-transparent border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
        )}
      >
        {isOn ? 'On' : 'Off'}
      </button>
    );
  }

  return null;
}

export function ParamsPanel({ params = [], values, onChange, meta, glyphs }) {
  if (params.length === 0) {
    return <p className="text-xs text-muted-foreground py-1">No parameters for this script.</p>;
  }

  return (
    <div className="space-y-4">
      {params.map((param) => {
        const currentValue = String(values[param.name] ?? param.default ?? '');

        if (param.type === 'row-group') {
          const colCount = param.cols ?? param.params?.length ?? 3;
          const hasStepLabels = param.params?.some((c) => c.type === 'slider' && c.stepLabels?.length);
          return (
            <div key={param.name} className={`grid grid-cols-${colCount} gap-3 items-end`}>
              {param.params?.map((child) => {
                const childValue = String(values[child.name] ?? child.default ?? '');
                const needsSpacer = hasStepLabels && child.type === 'slider' && !child.stepLabels?.length;
                return (
                  <div key={child.name} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-[11px] text-muted-foreground">{child.label}</Label>
                      {child.type === 'slider' && (
                        <span className="text-[11px] font-mono text-foreground tabular-nums">{childValue}</span>
                      )}
                    </div>
                    {needsSpacer && <div className="h-9" />}
                    {renderControl(child, childValue, onChange, meta, glyphs)}
                  </div>
                );
              })}
            </div>
          );
        }

        if (param.type === 'column-group') {
          const cols = param.cols ?? param.params?.length ?? 2;
          return (
            <div key={param.name} className={`grid grid-cols-${cols} gap-3 items-start`}>
              {param.params?.map((child) => (
                <ParamsPanel key={child.name} params={[child]} values={values} onChange={onChange} meta={meta} glyphs={glyphs} />
              ))}
            </div>
          );
        }

        if (param.type === 'toggle-group') {
          const isOn = currentValue === 'true';
          return (
            <div key={param.name} className="rounded-lg border border-border overflow-hidden">
              <button
                type="button"
                onClick={() => onChange(param.name, !isOn)}
                className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-accent/30 transition-colors select-none"
              >
                <span className="text-muted-foreground">{param.label}</span>
                <span className={cn(
                  'h-4 w-7 rounded-full transition-colors relative inline-block shrink-0',
                  isOn ? 'bg-primary' : 'bg-muted'
                )}>
                  <span className={cn(
                    'absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform',
                    isOn ? 'translate-x-[12px]' : 'translate-x-0'
                  )} />
                </span>
              </button>
              {isOn && param.params?.length > 0 && (
                <div className="px-3 pb-3 pt-2 space-y-3 border-t border-border bg-accent/10">
                  <ParamsPanel params={param.params} values={values} onChange={onChange} meta={meta} glyphs={glyphs} />
                </div>
              )}
            </div>
          );
        }

        // showWhen — hide param unless condition is met
        if (param.showWhen) {
          const condValue = String(values[param.showWhen.param] ?? '');
          if (condValue !== String(param.showWhen.value)) return null;
        }

        // Normal param with label
        return (
          <div key={param.name} className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor={param.name} className="text-xs text-muted-foreground">
                {param.label}
              </Label>
              {param.type === 'slider' && (
                <span className="text-xs font-mono text-foreground tabular-nums">
                  {values[param.name] ?? param.default}
                </span>
              )}
            </div>
            {renderControl(param, currentValue, onChange, meta, glyphs)}
          </div>
        );
      })}
    </div>
  );
}

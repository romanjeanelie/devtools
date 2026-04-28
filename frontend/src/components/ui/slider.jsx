import { cn } from '@/lib/utils';
import * as SliderPrimitive from '@radix-ui/react-slider';
import * as React from 'react';

const Slider = React.forwardRef(({ className, steps, stepLabels, min = 0, max = 100, ...props }, ref) => {
  const hasSteps = steps && steps.length > 0;
  
  return (
    <div className="relative w-full">
      {/* Step indicators */}
      {hasSteps && (
        <div className="absolute -top-8 left-0 right-0 h-8 pointer-events-none">
          {/* Optimal web range highlight (18-28 for CRF) */}
          {steps.includes(18) && steps.includes(28) && (
            <div
              className="absolute h-full bg-green-500/10 border-t border-green-500/30"
              style={{
                left: `${((18 - min) / (max - min)) * 100}%`,
                right: `${100 - ((28 - min) / (max - min)) * 100}%`,
              }}
            />
          )}
          
          {steps.map((step, i) => {
            const position = ((step - min) / (max - min)) * 100;
            const isOptimal = step >= 18 && step <= 28;
            return (
              <div
                key={step}
                className="absolute flex flex-col items-center"
                style={{ left: `${position}%`, transform: 'translateX(-50%)' }}
              >
                {stepLabels?.[i] && (
                  <span className={cn(
                    "text-[9px] whitespace-nowrap mb-0.5 font-medium",
                    isOptimal ? "text-green-600 dark:text-green-400" : "text-muted-foreground/60"
                  )}>
                    {stepLabels[i]}
                  </span>
                )}
                <div className={cn(
                  "w-px h-3",
                  isOptimal ? "bg-green-500/50" : "bg-muted-foreground/20"
                )} />
              </div>
            );
          })}
        </div>
      )}
      
      <SliderPrimitive.Root
        ref={ref}
        min={min}
        max={max}
        className={cn('relative flex w-full touch-none select-none items-center', hasSteps && 'mt-9', className)}
        {...props}
      >
        <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-primary/20">
          <SliderPrimitive.Range className="absolute h-full bg-primary" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb className="block h-4 w-4 rounded-full border border-primary/50 bg-background shadow transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50" />
      </SliderPrimitive.Root>
    </div>
  );
});
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };

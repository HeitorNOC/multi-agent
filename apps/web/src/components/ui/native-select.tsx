/**
 * Select nativo com a mesma cara do `Input`. Fundo sólido e opções com as cores do tema: com fundo
 * transparente, o Windows pinta a lista de branco e o texto claro do tema escuro some.
 */
import * as React from "react";
import { ChevronDownIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** `className` posiciona e dimensiona (fica no invólucro); `selectClassName` muda o próprio campo. */
function NativeSelect({
  className,
  selectClassName,
  size = "default",
  ...props
}: Omit<React.ComponentProps<"select">, "size"> & { size?: "sm" | "default"; selectClassName?: string }) {
  return (
    <div data-slot="native-select-wrapper" className={cn("relative min-w-0", className)}>
      <select
        data-slot="native-select"
        className={cn(
          "w-full min-w-0 cursor-pointer appearance-none rounded-md border border-input bg-background pr-8 pl-3 text-sm shadow-xs transition-[color,box-shadow] outline-none dark:bg-input/30",
          "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
          "aria-invalid:border-destructive aria-invalid:ring-destructive/20",
          "[&_optgroup]:bg-popover [&_optgroup]:text-popover-foreground [&_option]:bg-popover [&_option]:text-popover-foreground",
          size === "sm" ? "h-8" : "h-9",
          selectClassName,
        )}
        {...props}
      />
      <ChevronDownIcon aria-hidden className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

export { NativeSelect };

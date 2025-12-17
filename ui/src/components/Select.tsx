import * as React from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

export interface SelectOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
  description?: string;
}

interface SelectProps {
  options: SelectOption[];
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  allowClear?: boolean;
  className?: string;
}

export function Select({
  options,
  value,
  onChange,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  emptyText = "No results found.",
  allowClear = true,
  className,
}: SelectProps) {
  const [open, setOpen] = React.useState(false);

  const selected = options.find((o) => o.value === value);

  const handleSelect = (currentValue: string) => {
    onChange(currentValue === value ? undefined : currentValue);
    setOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange(undefined);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          role="combobox"
          aria-expanded={open}
          className={cn(
            "flex items-center gap-2 px-3 py-2 bg-bg-surface border border-border-default rounded-md text-sm",
            "hover:border-border-accent focus:outline-none focus:border-hl-green transition-colors",
            "justify-between",
            className
          )}
        >
          <span className="flex items-center gap-2 min-w-0">
            {selected ? (
              <>
                {selected.icon && <span className="shrink-0">{selected.icon}</span>}
                <span className="text-text-primary truncate">{selected.label}</span>
              </>
            ) : (
              <span className="text-text-tertiary">{placeholder}</span>
            )}
          </span>
          <span className="flex items-center gap-1 shrink-0">
            {allowClear && selected && (
              <span
                onClick={handleClear}
                className="p-0.5 hover:bg-bg-hover rounded transition-colors"
              >
                <X className="h-3 w-3 text-text-tertiary" />
              </span>
            )}
            <ChevronsUpDown className="h-4 w-4 text-text-tertiary" />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent 
        className="p-0 bg-bg-tertiary border-border-accent" 
        style={{ width: "var(--radix-popover-trigger-width)", minWidth: "240px" }}
        align="start"
      >
        <Command className="bg-transparent">
          <CommandInput 
            placeholder={searchPlaceholder} 
            className="text-text-primary placeholder:text-text-tertiary"
          />
          <CommandList>
            <CommandEmpty className="text-text-tertiary">{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={`${option.label} ${option.description || ""}`}
                  onSelect={() => handleSelect(option.value)}
                  className="flex items-center gap-2 cursor-pointer text-text-primary data-[selected=true]:bg-bg-hover"
                >
                  {option.icon && <span className="shrink-0">{option.icon}</span>}
                  <div className="flex-1 min-w-0">
                    <div className="truncate">{option.label}</div>
                    {option.description && (
                      <div className="text-xs text-text-tertiary truncate">
                        {option.description}
                      </div>
                    )}
                  </div>
                  <Check
                    className={cn(
                      "h-4 w-4 shrink-0",
                      value === option.value ? "opacity-100 text-hl-green" : "opacity-0"
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

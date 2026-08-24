"use client";

import { useState } from "react";
import { format, parseISO } from "date-fns";
import { fr } from "date-fns/locale";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

interface DateFieldProps {
  value: string; // ISO "yyyy-MM-dd", "" when unset
  onChange: (value: string) => void;
  placeholder?: string;
  min?: string;
  max?: string;
  className?: string;
  id?: string;
}

// Remplace les <input type="date"> natifs (docs/12-maquettes-ui-ux.md §5) par
// le DatePicker Shadcn UI (Popover + Calendar), tout en gardant la meme
// representation ISO string que le reste de l'app (filtres API, etc.).
export function DateField({
  value,
  onChange,
  placeholder = "Choisir une date",
  min,
  max,
  className,
  id,
}: DateFieldProps) {
  const [open, setOpen] = useState(false);
  const selected = value ? parseISO(value) : undefined;
  const minDate = min ? parseISO(min) : undefined;
  const maxDate = max ? parseISO(max) : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            id={id}
            variant="outline"
            className={cn(
              "w-40 justify-start font-normal",
              !value && "text-muted-foreground",
              className,
            )}
          >
            <CalendarIcon className="opacity-70" />
            {selected ? format(selected, "d MMM yyyy", { locale: fr }) : placeholder}
          </Button>
        }
      />
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          locale={fr}
          selected={selected}
          defaultMonth={selected}
          disabled={(date) => (minDate && date < minDate) || (maxDate && date > maxDate) || false}
          onSelect={(date) => {
            onChange(date ? format(date, "yyyy-MM-dd") : "");
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

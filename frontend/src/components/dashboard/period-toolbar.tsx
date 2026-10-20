"use client";

import { addDays, differenceInCalendarDays, format, parseISO, startOfMonth } from "date-fns";
import { ChevronDown, Download, FileSpreadsheet, FileText, X } from "lucide-react";
import type { DashboardExportFormat } from "@/lib/api";
import { cn } from "@/lib/utils";
import { DateField } from "@/components/date-field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface Period {
  from: string; // ISO "yyyy-MM-dd", "" si non borne
  to: string;
}

type PresetKey = "today" | "7d" | "30d" | "month";

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "today", label: "Aujourd'hui" },
  { key: "7d", label: "7 jours" },
  { key: "30d", label: "30 jours" },
  { key: "month", label: "Ce mois-ci" },
];

const toIso = (date: Date) => format(date, "yyyy-MM-dd");

// Dates locales (et non toISOString, en UTC) pour que "Aujourd'hui"
// corresponde au jour de l'utilisateur.
export function presetPeriod(key: PresetKey, today = new Date()): Period {
  const to = toIso(today);
  switch (key) {
    case "today":
      return { from: to, to };
    case "7d":
      return { from: toIso(addDays(today, -6)), to };
    case "30d":
      return { from: toIso(addDays(today, -29)), to };
    case "month":
      return { from: toIso(startOfMonth(today)), to };
  }
}

// Periode de meme duree immediatement avant la periode donnee, pour les
// tendances. null si la periode n'est pas bornee des deux cotes.
export function previousPeriod(period: Period): Period | null {
  if (!period.from || !period.to) return null;
  const from = parseISO(period.from);
  const length = differenceInCalendarDays(parseISO(period.to), from) + 1;
  return { from: toIso(addDays(from, -length)), to: toIso(addDays(from, -1)) };
}

interface PeriodToolbarProps {
  period: Period;
  onPeriodChange: (period: Period) => void;
  canExport: boolean;
  exportingFormat: DashboardExportFormat | null;
  onExport: (format: DashboardExportFormat) => void;
}

export function PeriodToolbar({
  period,
  onPeriodChange,
  canExport,
  exportingFormat,
  onExport,
}: PeriodToolbarProps) {
  const activePreset = PRESETS.find((preset) => {
    const candidate = presetPeriod(preset.key);
    return candidate.from === period.from && candidate.to === period.to;
  })?.key;
  const hasPeriod = Boolean(period.from || period.to);

  return (
    <div
      role="group"
      aria-label="Période et export"
      className="flex flex-wrap items-end gap-x-4 gap-y-3 rounded-xl bg-card p-3 ring-1 ring-foreground/10"
    >
      <div className="flex flex-col gap-1.5">
        <span id="dashboard-presets-label" className="text-xs font-medium text-muted-foreground">
          Période
        </span>
        <div
          role="group"
          aria-labelledby="dashboard-presets-label"
          className="inline-flex flex-wrap rounded-lg bg-muted p-0.5"
        >
          {PRESETS.map((preset) => {
            const active = preset.key === activePreset;
            return (
              <button
                key={preset.key}
                type="button"
                aria-pressed={active}
                onClick={() => onPeriodChange(presetPeriod(preset.key))}
                className={cn(
                  "h-7 rounded-md px-2.5 text-sm whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
                  active && "bg-card font-medium text-primary shadow-sm ring-1 ring-foreground/10",
                )}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="dashboard-from-date" className="text-xs text-muted-foreground">
            Du
          </Label>
          <DateField
            id="dashboard-from-date"
            value={period.from}
            max={period.to}
            onChange={(from) => onPeriodChange({ ...period, from })}
            className="w-36"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="dashboard-to-date" className="text-xs text-muted-foreground">
            Au
          </Label>
          <DateField
            id="dashboard-to-date"
            value={period.to}
            min={period.from}
            onChange={(to) => onPeriodChange({ ...period, to })}
            className="w-36"
          />
        </div>
        {hasPeriod ? (
          <Button variant="ghost" onClick={() => onPeriodChange({ from: "", to: "" })}>
            <X aria-hidden="true" />
            Effacer la période
          </Button>
        ) : null}
      </div>

      <div className="ml-auto">
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={!canExport || exportingFormat !== null}
            render={<Button variant="outline" />}
          >
            <Download aria-hidden="true" />
            {exportingFormat ? "Export en cours…" : "Exporter le rapport"}
            <ChevronDown aria-hidden="true" className="opacity-60" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={() => onExport("csv")}>
              <FileSpreadsheet aria-hidden="true" />
              Exporter en CSV
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onExport("pdf")}>
              <FileText aria-hidden="true" />
              Exporter en PDF
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

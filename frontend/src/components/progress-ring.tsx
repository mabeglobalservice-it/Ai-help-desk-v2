"use client";

import { RadialBar, RadialBarChart, PolarAngleAxis } from "recharts";
import { CountUp } from "@/components/count-up";

interface ProgressRingProps {
  value: number; // 0-100
  size?: number;
  color?: string;
  trackColor?: string;
  label?: string;
}

// Anneau de progression anime (recharts RadialBarChart) : se remplit de 0 a
// la valeur reelle au montage (comportement par defaut de RadialBar), avec
// le pourcentage anime au centre (CountUp) en parallele.
export function ProgressRing({
  value,
  size = 140,
  color = "var(--color-terracotta)",
  trackColor = "var(--color-muted)",
  label,
}: ProgressRingProps) {
  const data = [{ value, fill: color }];

  return (
    <div className="relative flex flex-col items-center justify-center" style={{ width: size, height: size }}>
      <RadialBarChart
        width={size}
        height={size}
        data={data}
        startAngle={90}
        endAngle={-270}
        innerRadius="78%"
        outerRadius="100%"
        barSize={10}
      >
        <PolarAngleAxis type="number" domain={[0, 100]} tick={false} axisLine={false} />
        <RadialBar
          dataKey="value"
          background={{ fill: trackColor }}
          cornerRadius={999}
          animationDuration={800}
          animationEasing="ease-out"
        />
      </RadialBarChart>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-semibold text-foreground">
          <CountUp value={value} format={(n) => `${n.toFixed(0)}%`} />
        </span>
        {label ? <span className="mt-0.5 text-xs text-muted-foreground">{label}</span> : null}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import { animate } from "framer-motion";

interface CountUpProps {
  value: number;
  format?: (value: number) => string;
  duration?: number;
}

// Anime la valeur affichee de sa precedente valeur vers la nouvelle (0 au
// premier rendu) — utilise pour les chiffres des cartes KPI du dashboard.
export function CountUp({ value, format = (n) => String(Math.round(n)), duration = 0.8 }: CountUpProps) {
  const [display, setDisplay] = useState(0);
  const previousValue = useRef(0);

  useEffect(() => {
    const controls = animate(previousValue.current, value, {
      duration,
      ease: "easeOut",
      onUpdate: setDisplay,
    });
    previousValue.current = value;
    return () => controls.stop();
  }, [value, duration]);

  return <>{format(display)}</>;
}

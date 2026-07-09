"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import {
  formatCountdown,
  retainSecLeft,
  CASE_RETAIN_SEC,
} from "@/lib/emic/case-retain";

type Props = {
  firstSeenAt?: string;
  initialSec?: number;
  compact?: boolean;
};

export function CaseCountdown({ firstSeenAt, initialSec, compact }: Props) {
  const [sec, setSec] = useState(() =>
    initialSec != null ? initialSec : retainSecLeft(firstSeenAt, CASE_RETAIN_SEC),
  );

  useEffect(() => {
    const tick = () =>
      setSec(
        initialSec != null
          ? Math.max(0, retainSecLeft(firstSeenAt, initialSec))
          : retainSecLeft(firstSeenAt, CASE_RETAIN_SEC),
      );
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [firstSeenAt, initialSec]);

  const low = sec > 0 && sec <= 60;
  const done = sec <= 0;

  return (
    <span
      className={`case-countdown${low ? " low" : ""}${done ? " done" : ""}`}
      title="案件保留倒數"
    >
      <Clock size={compact ? 10 : 11} />
      {done ? "已到期" : formatCountdown(sec)}
    </span>
  );
}
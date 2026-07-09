"use client";

import { useEffect, useState } from "react";
import { formatCountdown, retainSecLeft } from "@/lib/emic/case-retain";

/** Toast 內容：顯示案件保留倒數計時 */
export function CaseRetainNotifyBody({
  ambulanceCode,
  branch,
  statusName,
  firstSeenAt,
}: {
  ambulanceCode?: string;
  branch?: string;
  statusName?: string;
  firstSeenAt?: string;
}) {
  const [sec, setSec] = useState(() => retainSecLeft(firstSeenAt));

  useEffect(() => {
    const t = setInterval(() => setSec(retainSecLeft(firstSeenAt)), 1000);
    return () => clearInterval(t);
  }, [firstSeenAt]);

  return (
    <div className="case-retain-toast-body">
      <div>
        {branch || ""} · {statusName || "新案件"}
      </div>
      <div className="case-retain-toast-count">
        保留倒數 <b>{formatCountdown(sec)}</b>
        {ambulanceCode ? ` · ${ambulanceCode}` : ""}
      </div>
    </div>
  );
}
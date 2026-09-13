export const fmtTime = (value: string) =>
  new Intl.DateTimeFormat("en-CA", { hour: "numeric", minute: "2-digit" }).format(new Date(value));

export const fmtMoney = (value: number, currency: "CAD" | "USD" = "CAD") =>
  new Intl.NumberFormat("en-CA", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);

export const statusLabel = (value: string) => value.replaceAll("_", " ");

/** 3.25 → "3h 15m". Dispatchers read clocks, not decimals. */
export const fmtDuration = (hours: number) => {
  const total = Math.max(0, Math.round(hours * 60));
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}m`;
};

export const fmtKm = (km: number) => `${Math.round(km).toLocaleString()} km`;

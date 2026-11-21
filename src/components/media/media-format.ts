const UNITS = ["byte", "kilobyte", "megabyte", "gigabyte", "terabyte"] as const

export function formatMediaSize(bytes: number, locale: string): string {
  let value = Math.max(0, bytes)
  let i = 0
  while (value >= 1024 && i < UNITS.length - 1) {
    value /= 1024
    i++
  }
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: UNITS[i],
    unitDisplay: "short",
    maximumFractionDigits: i === 0 ? 0 : 1,
  }).format(value)
}

export function formatMediaDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso))
}

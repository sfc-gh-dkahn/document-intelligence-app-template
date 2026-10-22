const BADGE_PALETTE = [
  "sf-badge bg-indigo-100 text-indigo-700",
  "sf-badge bg-purple-100 text-purple-700",
  "sf-badge bg-sky-100 text-sky-700",
  "sf-badge bg-amber-100 text-amber-700",
  "sf-badge bg-green-100 text-green-700",
  "sf-badge bg-rose-100 text-rose-700",
  "sf-badge bg-orange-100 text-orange-700",
  "sf-badge bg-teal-100 text-teal-700",
]

export const STATUS_BADGE_COLORS: Record<string, string> = {
  complete: "sf-badge bg-emerald-100 text-emerald-700",
  pending: "sf-badge bg-amber-100 text-amber-700",
  failed: "sf-badge bg-red-100 text-red-700",
}

export const DEFAULT_BADGE = "sf-badge bg-slate-100 text-slate-600"

function hashColor(s: string): string {
  let hash = 0
  for (let i = 0; i < s.length; i++) hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0
  return BADGE_PALETTE[Math.abs(hash) % BADGE_PALETTE.length]
}

export function lobBadgeClass(lob: string): string {
  if (!lob) return DEFAULT_BADGE
  return hashColor(lob)
}

export function statusBadgeClass(status: string): string {
  const s = status.toLowerCase()
  return STATUS_BADGE_COLORS[s] ?? hashColor(s)
}

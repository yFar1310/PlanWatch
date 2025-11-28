export function formatMinutes(total: number | null | undefined) {
    const m = Number(total ?? 0)
    if (!Number.isFinite(m) || m <= 0) return '0 min'
    if (m < 60) return `${m} min`
    const hours = Math.floor(m / 60)
    const minutes = m % 60
    if (minutes === 0) return `${hours} h`
    return `${hours} h ${minutes} min`
  }
  
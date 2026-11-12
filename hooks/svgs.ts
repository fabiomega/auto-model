// The pane's drawings, as plain SVG text. The colors read on a light page and on a dark one:
// neutrals are a semi-transparent gray, and the model colors are mid-tones. Words stay in the
// pane's own Text elements, which follow the person's theme; the drawings carry none, except
// the small axis labels of the chart, in a gray that holds on both.

export const TEAL = '#14A39A'
export const BLUE = '#3B7DD8'
export const VIOLET = '#7C5CD6'
export const ROSE = '#D6517D'
export const GREEN = '#2F9E63'
export const GOLD = '#C98A12'
export const RED = '#D14B4B'
export const MODEL_PALETTE: readonly string[] = [TEAL, BLUE, VIOLET, ROSE]
const TRACK = 'rgba(128,128,128,0.22)'
const GRID = 'rgba(128,128,128,0.16)'
const AXIS = '#8A93A3'

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo))
}

function num(n: number): string {
  return (Math.round(n * 10) / 10).toString()
}

/** A ring that fills to `percent`, in a teal-to-blue sweep. */
export function ringSvg(percent: number): string {
  const p = clamp(percent, 0, 100)

  return [
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">',
    `<defs><linearGradient id="r" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${TEAL}"/><stop offset="1" stop-color="${BLUE}"/></linearGradient></defs>`,
    `<circle cx="48" cy="48" r="38" fill="none" stroke="${TRACK}" stroke-width="9"/>`,
    p > 0
      ? `<circle cx="48" cy="48" r="38" fill="none" stroke="url(#r)" stroke-width="9" stroke-linecap="round" pathLength="100" stroke-dasharray="${num(p)} 100" transform="rotate(-90 48 48)"/>`
      : '',
    '</svg>',
  ].join('')
}

/** A thin bar for one usage window: what was used before in a soft tone, what the last answer added in full. */
export function usageBarSvg(from: number, to: number, color: string): string {
  const a = clamp(from, 0, 100)
  const b = clamp(to, 0, 100)
  const W = 520
  const x = (v: number) => (v / 100) * W
  const lo = Math.min(a, b)
  const hi = Math.max(a, b)

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="10" viewBox="0 0 ${W} 10">`,
    `<rect x="0" y="1" width="${W}" height="8" rx="4" fill="${TRACK}"/>`,
    lo > 0 ? `<rect x="0" y="1" width="${num(Math.max(8, x(lo)))}" height="8" rx="4" fill="${color}" fill-opacity="0.55"/>` : '',
    hi > lo ? `<rect x="${num(x(lo))}" y="1" width="${num(Math.max(6, x(hi) - x(lo)))}" height="8" rx="4" fill="${color}"/>` : '',
    '</svg>',
  ].join('')
}

/** One stacked bar for the share of each model, with a small gap between the pieces. */
export function stackedBarSvg(counts: readonly number[], colors: readonly string[]): string {
  const W = 520
  const total = counts.reduce((a, b) => a + b, 0)
  const parts: string[] = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="14" viewBox="0 0 ${W} 14">`)
  parts.push(`<rect x="0" y="0" width="${W}" height="14" rx="7" fill="${TRACK}"/>`)
  if (total > 0) {
    const live = counts.map((c, i) => ({ c, i })).filter(p => p.c > 0)
    const gap = 3
    const room = W - gap * (live.length - 1)
    let x = 0
    for (const { c, i } of live) {
      const w = Math.max(10, (c / total) * room)
      parts.push(`<rect x="${num(x)}" y="0" width="${num(w)}" height="14" rx="7" fill="${colors[i] ?? BLUE}"/>`)
      x += w + gap
    }
  }
  parts.push('</svg>')

  return parts.join('')
}

type Pt = { x: number; y: number }

// A smooth line through the points (Catmull-Rom turned into cubic curves).
function smooth(points: readonly Pt[]): string {
  if (points.length === 0) return ''
  const first = points[0] as Pt
  let d = `M${num(first.x)},${num(first.y)}`
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? (points[i] as Pt)
    const p1 = points[i] as Pt
    const p2 = points[i + 1] as Pt
    const p3 = points[i + 2] ?? p2
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 }
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 }
    d += ` C${num(c1.x)},${num(c1.y)} ${num(c2.x)},${num(c2.y)} ${num(p2.x)},${num(p2.y)}`
  }

  return d
}

const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

/** The 14-day chart: the real cost, the always-Opus cost dashed, and the saving shaded between. */
export function areaChartSvg(days: readonly { key: string; actual: number; opus: number }[]): string {
  const W = 520
  const H = 176
  const L = 14
  const R = 18
  const T = 14
  const B = 30
  const n = days.length
  const most = Math.max(1, ...days.map(d => Math.max(d.actual, d.opus)))
  const x = (i: number) => L + (n <= 1 ? 0 : (i * (W - L - R)) / (n - 1))
  const y = (v: number) => T + (1 - v / most) * (H - T - B)
  const real = days.map((d, i) => ({ x: x(i), y: y(d.actual) }))
  const top = days.map((d, i) => ({ x: x(i), y: y(d.opus) }))
  const realPath = smooth(real)
  const topPath = smooth(top)
  const back = smooth([...real].reverse()).replace(/^M/, 'L')
  const band = n > 1 ? `${topPath} ${back} Z` : ''
  const baseline = y(0)
  const area = n > 1 ? `${realPath} L${num(x(n - 1))},${num(baseline)} L${num(x(0))},${num(baseline)} Z` : ''
  const parts: string[] = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`)
  parts.push(
    `<defs><linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${TEAL}" stop-opacity="0.28"/><stop offset="1" stop-color="${TEAL}" stop-opacity="0"/></linearGradient></defs>`,
  )
  for (const f of [0, 0.5, 1]) {
    const gy = T + f * (H - T - B)
    parts.push(`<line x1="${L}" x2="${W - R}" y1="${num(gy)}" y2="${num(gy)}" stroke="${GRID}" stroke-width="1"/>`)
  }
  if (band !== '') parts.push(`<path d="${band}" fill="${VIOLET}" fill-opacity="0.14"/>`)
  if (area !== '') parts.push(`<path d="${area}" fill="url(#a)"/>`)
  if (topPath !== '') parts.push(`<path d="${topPath}" fill="none" stroke="${AXIS}" stroke-width="1.6" stroke-dasharray="4 5" stroke-linecap="round"/>`)
  if (realPath !== '') parts.push(`<path d="${realPath}" fill="none" stroke="${TEAL}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`)
  const last = real[n - 1]
  if (last !== undefined) parts.push(`<circle cx="${num(last.x)}" cy="${num(last.y)}" r="4" fill="${TEAL}"/><circle cx="${num(last.x)}" cy="${num(last.y)}" r="8" fill="${TEAL}" fill-opacity="0.2"/>`)
  days.forEach((d, i) => {
    if (i % 2 !== (n - 1) % 2) return
    const date = new Date(Number(d.key.slice(0, 4)), Number(d.key.slice(5, 7)) - 1, Number(d.key.slice(8, 10)), 12)
    const label = `${WEEKDAYS[date.getDay()] ?? ''}${d.key.slice(8, 10)}`
    parts.push(`<text x="${num(x(i))}" y="${H - 8}" fill="${AXIS}" font-size="11" font-family="system-ui, sans-serif" text-anchor="middle">${label}</text>`)
  })
  parts.push('</svg>')

  return parts.join('')
}

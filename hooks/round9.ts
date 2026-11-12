// 0.8.0: how long a request takes, and what a request will cost before it is sent.
//
// Everything here is pure. The hooks module keeps the history in $.store and hands it in.
// Estimates come only from the person's own history: a range (the middle half of similar
// requests), never a single invented number, and "sem histórico suficiente" until there is one.

import type { AutoModelTier, UsageReading } from '../types'
import { fmtPct } from './round5'
import { signOf } from './round8'

/** One finished request: its bucket, how long it took and the weighted tokens it used. */
export type DurSample = { b: string; ms: number; units: number; at: number }

/** How often the real time fell inside the range that was estimated. */
export type TimeCal = { hit: number; total: number }

/** One measured move of the usage windows, against the weighted tokens of the request that moved it. */
export type RatioSample = { id: string; units: number; ds: number; dw: number }

/** A range from history: the middle half of the similar requests, and how many there were. */
export type Range = { lo: number; hi: number; n: number }

/** At least this many similar requests before anything is estimated. */
export const MIN_SAMPLES = 5
/** At least this many measured usage moves before a token count is turned into percent. */
export const MIN_RATIOS = 3
const MAX_SAMPLES = 300
const MAX_RATIOS = 40
/** Above this length a request counts as a long text in its bucket. */
export const LONG_TEXT = 2500

/** The need band of a score, on the same scale the rules and the router use. */
export function needBand(score: number): number {
  if (score < 2.5) return 0
  if (score < 5.5) return 1
  if (score < 9) return 2

  return 3
}

/** Which requests count as "similar": the same model, effort, need band, attachments and length class. */
export function bucketOf(tier: AutoModelTier, effort: string | undefined, score: number, hasAttachments: boolean, isLong: boolean): string {
  return `${tier}|${effort ?? '-'}|${needBand(score)}|${hasAttachments ? 1 : 0}|${isLong ? 1 : 0}`
}

/**
 * The samples to estimate from: the exact bucket first, then wider neighbours (same model and
 * effort, then same model and need, then same model) until there are enough.
 */
export function similarSamples(list: readonly DurSample[], bucket: string): DurSample[] {
  const [tier, effort, need] = bucket.split('|')
  const levels: ((b: string[]) => boolean)[] = [
    b => b.join('|') === bucket,
    b => b[0] === tier && b[1] === effort && b[2] === need,
    b => b[0] === tier && b[1] === effort,
    b => b[0] === tier && b[2] === need,
    b => b[0] === tier,
  ]
  for (const fits of levels) {
    const found = list.filter(x => fits(x.b.split('|')))
    if (found.length >= MIN_SAMPLES) return found
  }

  return []
}

/** The value at quantile q (0 to 1) of a sorted list, interpolated. */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0
  const at = (sorted.length - 1) * q
  const lo = Math.floor(at)
  const hi = Math.ceil(at)
  const a = sorted[lo] ?? 0
  const b = sorted[hi] ?? a

  return a + (b - a) * (at - lo)
}

/** The middle half (p25 to p75) of the similar requests' duration or tokens; undefined below MIN_SAMPLES. */
export function rangeOf(list: readonly DurSample[], bucket: string, field: 'ms' | 'units'): Range | undefined {
  const found = similarSamples(list, bucket)
  const values = found.map(x => x[field]).filter(v => Number.isFinite(v) && v > 0)
  if (values.length < MIN_SAMPLES) return undefined
  const sorted = [...values].sort((a, b) => a - b)

  return { lo: quantile(sorted, 0.25), hi: quantile(sorted, 0.75), n: sorted.length }
}

export function pushDuration(list: readonly DurSample[], sample: DurSample): DurSample[] {
  if (!Number.isFinite(sample.ms) || sample.ms <= 0) return [...list]

  return [...list, sample].slice(-MAX_SAMPLES)
}

/** Counts whether the real time fell inside the estimated range. */
export function noteTime(cal: TimeCal, range: Range | undefined, ms: number): TimeCal {
  if (range === undefined || !Number.isFinite(ms) || ms <= 0) return cal

  return { hit: cal.hit + (ms >= range.lo && ms <= range.hi ? 1 : 0), total: cal.total + 1 }
}

/** "acerto do tempo: 78%", or undefined before the first estimated request finished. */
export function accuracyText(cal: TimeCal | undefined): string | undefined {
  if (cal === undefined || cal.total === 0) return undefined

  return `acerto do tempo: ${Math.round((cal.hit / cal.total) * 100)}% (em ${cal.total} pedidos com estimativa)`
}

/** "8 s", "1 min 42 s", "1 h 3 min". */
export function fmtDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  if (total < 60) return `${total} s`
  const min = Math.floor(total / 60)
  const sec = total % 60
  if (min < 60) return sec === 0 ? `${min} min` : `${min} min ${sec} s`
  const h = Math.floor(min / 60)
  const rest = min % 60

  return rest === 0 ? `${h} h` : `${h} h ${rest} min`
}

/** "≈ 2–4 min", "≈ 10–40 s", "≈ 1–2 h"; one value when the ends round to the same. */
export function fmtDurationRange(r: { lo: number; hi: number }): string {
  const join = (a: number, b: number, unit: string) => (a >= b ? `≈ ${b} ${unit}` : `≈ ${a}–${b} ${unit}`)
  if (r.hi < 60_000) return join(Math.max(1, Math.round(r.lo / 1000)), Math.max(1, Math.round(r.hi / 1000)), 's')
  if (r.hi < 3_600_000) return join(Math.max(1, Math.floor(r.lo / 60_000)), Math.max(1, Math.ceil(r.hi / 60_000)), 'min')

  return join(Math.max(1, Math.floor(r.lo / 3_600_000)), Math.max(1, Math.ceil(r.hi / 3_600_000)), 'h')
}

/** Compact token count in pt-BR: "800", "45 mil", "1,2 mi". */
export function fmtTokens(n: number): string {
  const v = Math.max(0, n)
  if (v < 1000) return String(Math.round(v))
  if (v < 1_000_000) return `${Math.round(v / 1000)} mil`
  const m = Math.round(v / 100_000) / 10

  return `${Number.isInteger(m) ? String(m) : m.toFixed(1).replace('.', ',')} mi`
}

export function tokensRangeText(r: { lo: number; hi: number }): string {
  const a = fmtTokens(r.lo)
  const b = fmtTokens(r.hi)

  return a === b ? `~${a}` : `~${a} – ${b}`
}

/** Keeps one measured move per request (the latest reading wins); a reset in between drops it. */
export function upsertRatio(list: readonly RatioSample[], sample: RatioSample): RatioSample[] {
  const rest = list.filter(x => x.id !== sample.id)
  if (!Number.isFinite(sample.units) || sample.units <= 0 || sample.ds < 0 || sample.dw < 0) return rest

  return [...rest, sample].slice(-MAX_RATIOS)
}

/** Percent points of each window per weighted token, learned from measured moves; undefined below MIN_RATIOS. */
export function ratioOf(list: readonly RatioSample[]): { session: number; week: number; n: number } | undefined {
  if (list.length < MIN_RATIOS) return undefined
  const units = list.reduce((sum, x) => sum + x.units, 0)
  if (units <= 0) return undefined

  return {
    session: list.reduce((sum, x) => sum + x.ds, 0) / units,
    week: list.reduce((sum, x) => sum + x.dw, 0) / units,
    n: list.length,
  }
}

/** Where a window would land after a request of `tokens`: a range, never past 100%. */
export function afterRange(before: number, perToken: number, tokens: { lo: number; hi: number }): { lo: number; hi: number } {
  return {
    lo: Math.min(100, before + perToken * tokens.lo),
    hi: Math.min(100, before + perToken * tokens.hi),
  }
}

/** "🟢 34% → ~38–42%"; the sign follows where the window lands, its upper end. */
export function windowAfterText(before: number, after: { lo: number; hi: number }, isTerminal: boolean): string {
  const a = fmtPct(Math.round(after.lo))
  const b = fmtPct(Math.round(after.hi))
  const to = a === b ? `~${b}%` : `~${a}–${b}%`

  return `${signOf(after.hi, isTerminal)} ${fmtPct(before)}% → ${to}`
}

/** What the prever command and the live preview know about a request before it is sent. */
export type Forecast = {
  time?: Range
  tokens?: Range
  /** The measured reading the "before" comes from, and how old it is in ms. */
  before?: UsageReading & { ageMs: number }
  after?: { session: { lo: number; hi: number }; week: { lo: number; hi: number } }
  /** How many similar requests the estimates stand on. */
  basis: number
}

export function forecastOf(
  durations: readonly DurSample[],
  ratios: readonly RatioSample[],
  bucket: string,
  latest: (UsageReading & { at: number }) | null,
  now: number,
): Forecast {
  const time = rangeOf(durations, bucket, 'ms')
  const tokens = rangeOf(durations, bucket, 'units')
  const ratio = ratioOf(ratios)
  const before = latest === null ? undefined : { session: latest.session, week: latest.week, ageMs: Math.max(0, now - latest.at) }
  const after =
    before !== undefined && tokens !== undefined && ratio !== undefined
      ? { session: afterRange(before.session, ratio.session, tokens), week: afterRange(before.week, ratio.week, tokens) }
      : undefined

  return {
    ...(time === undefined ? {} : { time }),
    ...(tokens === undefined ? {} : { tokens }),
    ...(before === undefined ? {} : { before }),
    ...(after === undefined ? {} : { after }),
    basis: Math.max(time?.n ?? 0, tokens?.n ?? 0),
  }
}

/** The extra on the live preview line: "≈2 min · ~1% da sessão"; undefined with nothing to say. */
export function previewExtra(f: Forecast): string | undefined {
  const parts: string[] = []
  if (f.time !== undefined) parts.push(fmtDurationRange(f.time).replace('≈ ', '≈'))
  if (f.after !== undefined && f.before !== undefined) {
    const move = Math.max(0, f.after.session.hi - f.before.session)
    parts.push(`~${fmtPct(Math.max(0.1, Math.round(move * 10) / 10))}% da sessão`)
  }

  return parts.length === 0 ? undefined : parts.join(' · ')
}

/** "pode passar de 90% da sessão" when the request may take a window past 90%; undefined otherwise. */
export function previewWarning(f: Forecast): string | undefined {
  if (f.after === undefined || f.before === undefined) return undefined
  const session = f.before.session <= 90 && f.after.session.hi > 90
  const week = f.before.week <= 90 && f.after.week.hi > 90
  if (session && week) return 'pode passar de 90% da sessão e da semana'
  if (session) return 'pode passar de 90% da sessão'
  if (week) return 'pode passar de 90% da semana'

  return undefined
}

/** The tone of the warning: red when it may pass 100%-ish (above 95), amber otherwise. */
export function warningTone(f: Forecast): 'accent' | 'bad' {
  const top = Math.max(f.after?.session.hi ?? 0, f.after?.week.hi ?? 0)

  return top > 95 ? 'bad' : 'accent'
}

/** The band's time line: "⏱ levou 1 min 42 s" or "⏱ estimado 2–4 min · levou 3 min 10 s". */
export function tookText(ms: number, estimate: { lo: number; hi: number } | undefined): string {
  const took = `levou ${fmtDuration(ms)}`
  if (estimate === undefined) return `⏱ ${took}`

  return `⏱ estimado ${fmtDurationRange(estimate).replace('≈ ', '')} · ${took}`
}

/** One plain sentence on why a router call failed, for the diagnostic. */
export function failText(r: unknown): string {
  if (r === undefined || r === null || typeof r !== 'object') return 'sem resposta'
  const x = r as { reason?: string; status?: number | null; error?: string }
  if (x.reason === 'api-error') {
    const what = x.error === undefined ? '' : ` · ${x.error}`
    return `erro da API${x.status === null || x.status === undefined ? ' (sem resposta do servidor)' : ` (HTTP ${x.status})`}${what}`
  }
  if (x.reason === 'empty-reply') return 'resposta vazia'
  if (x.reason === 'aborted') return 'chamada cancelada ou tempo esgotado no app'

  return 'resposta inesperada'
}

/** The forecast lines of /automodelo prever, labels aligned in one column. */
export function forecastLines(f: Forecast, isTerminal = false): string[] {
  const row = (label: string, value: string) => `  ${label.padEnd(10, ' ')} ${value}`
  const age = f.before === undefined || f.before.ageMs < 120_000 ? '' : ` (medido há ${Math.round(f.before.ageMs / 60_000)} min)`
  const tokens = f.tokens === undefined ? 'sem histórico suficiente' : tokensRangeText(f.tokens)
  const session =
    f.before === undefined
      ? 'sem leitura agora'
      : f.after === undefined
        ? `${signOf(f.before.session, isTerminal)} ${fmtPct(f.before.session)}% agora · sem dados para estimar${age}`
        : `${windowAfterText(f.before.session, f.after.session, isTerminal)}${age}`
  const week =
    f.before === undefined
      ? 'sem leitura agora'
      : f.after === undefined
        ? `${signOf(f.before.week, isTerminal)} ${fmtPct(f.before.week)}% agora · sem dados para estimar`
        : windowAfterText(f.before.week, f.after.week, isTerminal)
  const time = f.time === undefined ? 'sem histórico suficiente' : fmtDurationRange(f.time)

  return [
    row('Tokens', tokens),
    row('Sessão', session),
    row('Semana', week),
    `  ${'⏱ Tempo'.padEnd(10, ' ')} ${time}`,
    f.basis >= MIN_SAMPLES
      ? `  Estimativas com base em ${f.basis} pedidos parecidos`
      : `  Ainda sem pedidos parecidos suficientes para estimar (mínimo ${MIN_SAMPLES})`,
  ]
}

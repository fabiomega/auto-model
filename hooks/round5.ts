import type { AutoModelBandUsage, AutoModelSettings, AutoModelUsageState, UsageReading } from '../types'
import { type Change, fmtInt, normalize } from './logic'
import { dayKey } from './round2'

// ---- the usage meter: how much of the session and the week a request used ----

/** The budgets the estimate uses, in weighted tokens, when the official reading is not there. */
export const USAGE_DEFAULTS = { sessionTokens: 5_000_000, weekTokens: 40_000_000 } as const

/** The thresholds that warn once per period. */
export const USAGE_WARNINGS = [80, 90] as const

/** The official windows, as the session's usage reports them. */
export type RateWindow = { kind: string; percentUsed: number }

/**
 * The official reading: the five-hour window (`session`) and the seven-day
 * window (`week`), as percent used. Null unless both are there, so a half
 * reading never mixes measured and estimated figures.
 */
export function officialReading(windows: readonly RateWindow[]): UsageReading | null {
  const session = windows.find(w => w.kind === 'five_hour')
  const week = windows.find(w => w.kind === 'seven_day')
  if (session === undefined || week === undefined) return null
  if (!Number.isFinite(session.percentUsed) || !Number.isFinite(week.percentUsed)) return null

  return { session: session.percentUsed, week: week.percentUsed }
}

/** The percent of a budget that the given weighted tokens take. */
export function pctOf(units: number, tokens: number): number {
  return tokens > 0 ? (units / tokens) * 100 : 0
}

/** The Monday of the week a timestamp falls in, as a day key, so the weekly estimate restarts on Monday. */
export function weekKeyOf(ms: number): string {
  const d = new Date(ms)
  const back = (d.getDay() + 6) % 7

  return dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - back, 12).getTime())
}

/** The thresholds a move from `from` to `to` crossed, in order. */
export function crossedThresholds(from: number, to: number): number[] {
  return USAGE_WARNINGS.filter(t => from < t && to >= t)
}

/** The colour name for a percent: green under 70, gold under 90, red from 90. */
export function usageTone(pct: number): 'good' | 'accent' | 'bad' {
  if (pct >= 90) return 'bad'
  if (pct >= 70) return 'accent'

  return 'good'
}

/** A percent in pt-BR: whole numbers as they are, others with one decimal. */
export function fmtPct(value: number): string {
  const r = Math.round(value * 10) / 10

  return Number.isInteger(r) ? String(r) : r.toFixed(1).replace('.', ',')
}

function fmtDelta(value: number): string {
  const sign = value > 0 ? '+' : ''

  return `${sign}${fmtPct(value)}%`
}

/** One line for the band or the status: "Sessão 38% → 41% (+3%) · Semana 52% → 53% (+1%) · medido". */
export function usageLine(usage: AutoModelBandUsage): string {
  const part = (name: string, from: number, to: number) =>
    `${name} ${fmtPct(from)}% → ${fmtPct(to)}% (${fmtDelta(to - from)})`

  const head = `${part('Sessão', usage.from.session, usage.to.session)} · ${part('Semana', usage.from.week, usage.to.week)} · ${usage.source}`
  const split = usage.split
  // An estimate tells the request apart from the conversation it resent, so a tiny question that
  // happened to rebuild the cache does not read as a heavy one.
  if (usage.source !== 'estimado' || split === undefined || split.history < 0.05) return head

  return `${head} · pedido ${fmtDelta(split.request)}, histórico reenviado ${fmtDelta(split.history)}`
}

/** One request's weighted tokens, split into what it added and what the conversation resent. */
export function splitUnits(u: {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}, weights: { cacheRead: number; cacheWrite: number; output: number }): { request: number; history: number } {
  return {
    request: u.input_tokens + u.output_tokens * weights.output,
    history: u.cache_read_input_tokens * weights.cacheRead + u.cache_creation_input_tokens * weights.cacheWrite,
  }
}

/** The highest percent a line shows, for its colour. */
export function usagePeak(usage: AutoModelBandUsage): number {
  return Math.max(usage.to.session, usage.to.week)
}

/** The share of the weekly estimate a day's weighted tokens take, for the export. */
export function dayUsageShare(units: number, weekTokens: number): string {
  return pctOf(units, weekTokens).toFixed(2).replace('.', ',')
}

// ---- the command: /automodelo uso ----

const ON_WORDS = new Set(['ligar', 'ligado', 'on', 'sim'])
const OFF_WORDS = new Set(['desligar', 'desligado', 'off', 'nao'])

/** "5000000", "5m", "5 mi", "800k", "1,5m" → weighted tokens; undefined when it does not read as a count. */
export function parseTokens(text: string): number | undefined {
  const m = /^(\d+(?:[.,]\d+)?)\s*(k|m|mi|milhão|milhões|mil)?$/.exec(normalize(text).trim())
  if (m === null) return undefined
  const base = Number((m[1] ?? '').replace(',', '.'))
  const unit = m[2] ?? ''
  const scale = unit === 'k' || unit === 'mil' ? 1_000 : unit === '' ? 1 : 1_000_000
  const value = Math.round(base * scale)

  return Number.isFinite(value) && value > 0 ? value : undefined
}

export function describeUsage(s: AutoModelSettings): string {
  return [
    `Medidor de uso: ${s.isUsageOn ? 'ligado' : 'desligado'}`,
    `Sessão (janela de 5 horas): o oficial do Claude quando ele estiver disponível; senão, estimado com ${fmtInt(s.sessionTokens)} tokens.`,
    `Semana (janela de 7 dias): o oficial quando disponível; senão, estimado com ${fmtInt(s.weekTokens)} tokens.`,
    'Mude com: /automodelo uso ligar|desligar · sessao <tokens> · semana <tokens>, por exemplo sessao 5m ou semana 40m.',
  ].join('\n')
}

export function applyUsage(s: AutoModelSettings, words: readonly string[]): Change {
  const what = normalize(words[0] ?? '')
  const value = words.slice(1).join(' ')

  if (what === '') return { settings: s, text: describeUsage(s) }
  if (ON_WORDS.has(what)) {
    return {
      settings: { ...s, isUsageOn: true },
      text: 'Medidor de uso ligado: a faixa de cada resposta mostra quanto da sessão e da semana ela usou.',
    }
  }
  if (OFF_WORDS.has(what)) {
    return { settings: { ...s, isUsageOn: false }, text: 'Medidor de uso desligado: a faixa de cada resposta não mostra mais o uso.' }
  }
  if (what === 'sessao' || what === 'sessão') {
    const tokens = parseTokens(value)
    if (tokens === undefined) return { error: 'Use /automodelo uso sessao <tokens>, por exemplo sessao 5m.' }

    return { settings: { ...s, sessionTokens: tokens }, text: `Orçamento estimado da sessão: ${fmtInt(tokens)} tokens.` }
  }
  if (what === 'semana') {
    const tokens = parseTokens(value)
    if (tokens === undefined) return { error: 'Use /automodelo uso semana <tokens>, por exemplo semana 40m.' }

    return { settings: { ...s, weekTokens: tokens }, text: `Orçamento estimado da semana: ${fmtInt(tokens)} tokens.` }
  }

  return { error: 'Use /automodelo uso ligar|desligar · sessao <tokens> · semana <tokens>.' }
}

/** A fresh meter: nothing used, no period begun. */
export const EMPTY_METER: AutoModelUsageState = {
  start: null,
  est: { session: 0, week: 0 },
  sessionStart: 0,
  weekKey: '',
  last: null,
  warned: [],
}

/**
 * Moves the meter into the current periods: a new session (its start time
 * changed) or a new week (Monday came) starts its own estimate from zero.
 */
export function rollMeter(meter: AutoModelUsageState | null, startedAt: number, now: number): AutoModelUsageState {
  const base = meter ?? EMPTY_METER
  const week = weekKeyOf(now)
  const est = {
    session: base.sessionStart === startedAt ? base.est.session : 0,
    week: base.weekKey === week ? base.est.week : 0,
  }
  const periodsChanged = base.sessionStart !== startedAt || base.weekKey !== week

  return {
    ...base,
    est,
    sessionStart: startedAt,
    weekKey: week,
    warned: periodsChanged ? base.warned.filter(k => !k.includes(String(base.sessionStart)) && !k.includes(base.weekKey)) : base.warned,
  }
}

/** Adds one request's weighted tokens to the estimate, as percent of each budget. */
export function addEstimate(meter: AutoModelUsageState, units: number, s: AutoModelSettings): AutoModelUsageState {
  return {
    ...meter,
    est: {
      session: meter.est.session + pctOf(units, s.sessionTokens),
      week: meter.est.week + pctOf(units, s.weekTokens),
    },
  }
}

/** The warnings for one move: each window's threshold crossed for the first time in its period. */
export function warningsFor(
  from: UsageReading,
  to: UsageReading,
  periods: { session: string; week: string },
  warned: readonly string[],
): { text: string; key: string }[] {
  const out: { text: string; key: string }[] = []
  const windows = [
    { name: 'sessão', id: 'session', a: from.session, b: to.session, period: periods.session },
    { name: 'semana', id: 'week', a: from.week, b: to.week, period: periods.week },
  ] as const
  for (const w of windows) {
    for (const t of crossedThresholds(w.a, w.b)) {
      const key = `${w.id}-${t}-${w.period}`
      if (warned.includes(key)) continue
      out.push({ key, text: `Limite da ${w.name} em ${t}%` })
    }
  }

  return out
}

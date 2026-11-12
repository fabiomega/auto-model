import type {
  AutoModelDay,
  AutoModelDecision,
  AutoModelSettings,
  AutoModelTier,
} from '../types'
import {
  MODEL_IDS,
  MODEL_NAMES,
  OPUS,
  REASONS,
  THRESHOLDS,
  capTier,
  effortName,
  fmtInt,
  fmtNumber,
  fmtPercent,
  normalize,
} from './logic'
import type { Effort } from './logic'

// ---- 1. calibration from what really happened ----

export type Outcome = 'ok' | 'escalado' | 'errou' | 'frustracao'

export type Sample = {
  id: string
  at: number
  tier: AutoModelTier
  score: number
  groups: string[]
  outcome: Outcome
  /** The effort the turn was sent with, when the mod chose one. */
  effort?: string
}

export type Bucket = { n: number; ok: number }

export type Calibration = {
  samples: number
  thresholds: [number, number, number]
  groupShift: Record<string, number>
  buckets: Record<string, Bucket>
  /** Per "tier:effort", how many levels this combination has needed to move (positive: it needed more). */
  effortBias?: Record<string, number>
}

export const MIN_SAMPLES = 20
const MIN_PER_TIER = 8
const MIN_PER_BUCKET = 10
const SMOOTH = 0.3
const THRESHOLD_ROOM = 1.5
const SHIFT_LIMIT = 1.5
const MIN_PER_EFFORT = 6
const EFFORT_BIAS_LIMIT = 1.5
export const SAMPLE_LIMIT = 500

export function isFailure(outcome: Outcome): boolean {
  return outcome !== 'ok'
}

export function pushSample(list: readonly Sample[], sample: Sample): Sample[] {
  return [...list, sample].slice(-SAMPLE_LIMIT)
}

/** Marks the newest sample (the turn just before) with what came of it. */
export function markLast(list: readonly Sample[], outcome: Outcome): Sample[] {
  if (list.length === 0) return [...list]
  const last = list[list.length - 1]
  if (last === undefined || last.outcome !== 'ok') return [...list]

  return [...list.slice(0, -1), { ...last, outcome }]
}

function bucketKey(tier: AutoModelTier, score?: number): string {
  return score === undefined ? `${tier}` : `${tier}:${Math.round(score)}`
}

/**
 * Re-reads the history: a tier that fails often gets its upper threshold
 * lowered (more goes up), one that never fails gets it raised (more stays
 * cheap). Smoothed against the last calibration and held near the defaults.
 */
export function calibrate(list: readonly Sample[], previous?: Calibration): Calibration | undefined {
  if (list.length < MIN_SAMPLES) return undefined
  const old = previous?.thresholds ?? [...THRESHOLDS]
  const thresholds: [number, number, number] = [old[0], old[1], old[2]]

  for (const t of [0, 1, 2] as const) {
    const mine = list.filter(s => s.tier === t)
    if (mine.length < MIN_PER_TIER) continue
    const fail = mine.filter(s => isFailure(s.outcome)).length / mine.length
    const base = THRESHOLDS[t]
    let target = base
    if (fail > 0.25) target = base - Math.min(1, (fail - 0.25) / 0.25) * THRESHOLD_ROOM
    else if (fail < 0.05) target = base + 0.5
    const next = old[t] * (1 - SMOOTH) + target * SMOOTH
    thresholds[t] = Math.max(base - THRESHOLD_ROOM, Math.min(base + THRESHOLD_ROOM, next))
  }
  // Keep the bands in order with room between them.
  thresholds[1] = Math.max(thresholds[1], thresholds[0] + 1)
  thresholds[2] = Math.max(thresholds[2], thresholds[1] + 1)

  const groupShift: Record<string, number> = { ...(previous?.groupShift ?? {}) }
  const byGroup = new Map<string, Sample[]>()
  for (const s of list) {
    if (s.tier >= OPUS) continue
    for (const g of s.groups) byGroup.set(g, [...(byGroup.get(g) ?? []), s])
  }
  for (const [g, mine] of byGroup) {
    if (mine.length < MIN_PER_TIER) continue
    const fail = mine.filter(s => isFailure(s.outcome)).length / mine.length
    const target = fail > 0.3 ? 0.5 + (fail - 0.3) : fail < 0.05 ? -0.25 : 0
    const next = (groupShift[g] ?? 0) * (1 - SMOOTH) + target * SMOOTH
    groupShift[g] = Math.max(-SHIFT_LIMIT, Math.min(SHIFT_LIMIT, Math.round(next * 100) / 100))
  }

  const buckets: Record<string, Bucket> = {}
  for (const s of list) {
    for (const key of [bucketKey(s.tier), bucketKey(s.tier, s.score)]) {
      const b = buckets[key] ?? { n: 0, ok: 0 }
      buckets[key] = { n: b.n + 1, ok: b.ok + (isFailure(s.outcome) ? 0 : 1) }
    }
  }

  // Effort: a combination that keeps failing is asked for more next time; one
  // that never fails is lowered, but only slowly.
  const effortBias: Record<string, number> = { ...(previous?.effortBias ?? {}) }
  const byEffort = new Map<string, Sample[]>()
  for (const sample of list) {
    if (sample.effort === undefined) continue
    const key = `${sample.tier}:${sample.effort}`
    byEffort.set(key, [...(byEffort.get(key) ?? []), sample])
  }
  for (const [key, mine] of byEffort) {
    if (mine.length < MIN_PER_EFFORT) continue
    const fail = mine.filter(x => isFailure(x.outcome)).length / mine.length
    const target = fail > 0.5 ? 1.5 : fail > 0.3 ? 1 : fail < 0.05 && mine.length >= MIN_PER_EFFORT * 2 ? -0.6 : 0
    const next = (effortBias[key] ?? 0) * (1 - SMOOTH) + target * SMOOTH
    effortBias[key] = Math.max(-EFFORT_BIAS_LIMIT, Math.min(EFFORT_BIAS_LIMIT, round2(next)))
  }

  return {
    samples: list.length,
    thresholds: [round2(thresholds[0]), round2(thresholds[1]), round2(thresholds[2])],
    groupShift,
    buckets,
    effortBias,
  }
}

/** The empirical success rate of decisions like this one, once there are enough. */
export function calibratedConfidence(
  cal: Calibration | undefined,
  tier: AutoModelTier,
  score: number,
): { rate: number; n: number } | undefined {
  if (cal === undefined) return undefined
  for (const key of [bucketKey(tier, score), bucketKey(tier)]) {
    const b = cal.buckets[key]
    if (b !== undefined && b.n >= MIN_PER_BUCKET) return { rate: b.ok / b.n, n: b.n }
  }

  return undefined
}

export function mergeBias(
  learned: Readonly<Record<string, number>>,
  shift: Readonly<Record<string, number>> | undefined,
): Record<string, number> {
  const out: Record<string, number> = { ...learned }
  for (const [g, v] of Object.entries(shift ?? {})) out[g] = Math.max(-3, Math.min(3, (out[g] ?? 0) + v))

  return out
}

// ---- 2. "patinando": a cheaper model going round in circles ----

export type Slip = { calls: Record<string, number>; edits: Record<string, number>; errors: number }

export const EMPTY_SLIP: Slip = { calls: {}, edits: {}, errors: 0 }

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const NOT_INPUT = new Set(['tool', 'tool_use_id', 'agentId', 'consent', 'turnId'])

export function callKey(call: Readonly<Record<string, unknown>>): string {
  const keys = Object.keys(call)
    .filter(k => !NOT_INPUT.has(k))
    .sort()
  const input: Record<string, unknown> = {}
  for (const k of keys) input[k] = call[k]

  return `${String(call.tool)}:${JSON.stringify(input).slice(0, 2000)}`
}

export function noteCall(slip: Slip, call: Readonly<Record<string, unknown>>, isError: boolean): Slip {
  const key = callKey(call)
  const calls = { ...slip.calls, [key]: (slip.calls[key] ?? 0) + 1 }
  const edits = { ...slip.edits }
  const tool = String(call.tool)
  const file = typeof call.file_path === 'string' ? call.file_path : typeof call.notebook_path === 'string' ? call.notebook_path : undefined
  if (EDIT_TOOLS.has(tool) && file !== undefined) edits[file] = (edits[file] ?? 0) + 1

  return { calls, edits, errors: slip.errors + (isError ? 1 : 0) }
}

/** Why the turn should move up, or undefined while it is fine. */
export function slipReason(slip: Slip): string | undefined {
  if (slip.errors >= 3) return `${slip.errors} erros de ferramenta`
  const repeated = Object.entries(slip.calls).find(([, n]) => n >= 3)
  if (repeated !== undefined) {
    const tool = repeated[0].split(':')[0] ?? 'ferramenta'
    return `repetiu a mesma chamada de ${tool} ${repeated[1]} vezes`
  }
  const edited = Object.entries(slip.edits).find(([, n]) => n >= 4)
  if (edited !== undefined) {
    const name = edited[0].split(/[\\/]/).pop() ?? edited[0]
    return `editou ${name} ${edited[1]} vezes`
  }

  return undefined
}

// ---- 3. per-project profiles ----

export type Profiles = Record<string, AutoModelTier>

export function profileKey(cwd: string): string {
  return cwd.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

// ---- 4a. the effort a task asks for, apart from the model ----

export const EFFORT_LADDER: readonly Effort[] = ['low', 'medium', 'high', 'xhigh']

/** The ladder's step for a rules score: no words, only how big the score is. */
export function levelOfScore(score: number): number {
  return score < 2.5 ? 0 : score < 4.8 ? 1 : score < 9 ? 2 : 3
}

/** The highest step a model takes on its own: only Opus and Fable go beyond high. */
function topStep(tier: AutoModelTier): number {
  return tier >= OPUS ? 3 : 2
}

/** The calibrated nudge, in whole steps, for a model-and-effort the person's history has judged. */
export function effortNudge(cal: Calibration | undefined, tier: AutoModelTier, step: number): number {
  const level = EFFORT_LADDER[Math.max(0, Math.min(3, step))] ?? 'medium'

  return Math.round(cal?.effortBias?.[`${tier}:${level}`] ?? 0) || 0
}

/** The effort at a step for a model, held to what the model takes and nudged by what was learned. */
export function effortAtStep(tier: AutoModelTier, step: number, cal?: Calibration): Effort {
  const i = Math.max(0, Math.min(topStep(tier), step + effortNudge(cal, tier, step)))

  return EFFORT_LADDER[i] ?? 'medium'
}

export function effortStepOf(effort: string | number | undefined): number | undefined {
  if (typeof effort !== 'string') return undefined
  const i = EFFORT_LADDER.indexOf(effort as Effort)

  return i < 0 ? undefined : i
}

const STEP_WHY = [
  'a tarefa pede pouco raciocínio e poucos passos',
  'a tarefa tem tamanho médio',
  'a tarefa pede bastante raciocínio, vários passos ou cuidado',
  'o problema é difícil e longo',
]

export function effortWhyOf(step: number, nudge: number, source: 'tarefa' | 'pontuação', tier: AutoModelTier): string {
  const base =
    source === 'tarefa'
      ? (STEP_WHY[step] ?? STEP_WHY[1] ?? '')
      : `a pontuação das regras pede esforço ${effortName(EFFORT_LADDER[step])}`
  const cap = step > topStep(tier) ? `; ${MODEL_NAMES[tier]} não vai além de alto` : ''
  const learned = nudge === 0 ? '' : `; ajustado ${nudge > 0 ? 'para cima' : 'para baixo'} pelo seu histórico`

  return `${base}${cap}${learned}`
}

export type EffortPick = { tier: AutoModelTier; effort: Effort; why: string; detail: string[] }

const PAIR_MARGIN = 0.5

/**
 * The model's tier stays what the task's size decided; the effort is what the
 * task asks for, never what the session happens to be set to. Only right at
 * the edge of a model's band a cheaper model with a little more effort takes
 * the job, when it reaches it for clearly less.
 */
export function pickEffort(input: {
  tier: AutoModelTier
  need: number
  step: number
  source: 'tarefa' | 'pontuação'
  settings: AutoModelSettings
  thresholds: readonly number[]
  floor: AutoModelTier | undefined
  calibration: Calibration | undefined
  base: Effort | number | undefined
}): EffortPick {
  const { settings: s } = input
  let tier = input.tier
  let step = input.step
  const detail: string[] = []

  if (tier >= 1 && tier - 1 >= (input.floor ?? 0) && !(tier === 3 && !s.isFableOn)) {
    const lower = (tier - 1) as AutoModelTier
    const cand = Math.min(2, step + 1)
    const candEffort = effortAtStep(lower, cand, input.calibration)
    const baseEffort = effortAtStep(tier, step, input.calibration)
    const reach = reachOf(lower, candEffort, input.thresholds)
    const cheaper = costOf(lower, candEffort, s.prices) < costOf(tier, baseEffort, s.prices) * 0.9
    if (reach >= input.need + PAIR_MARGIN && cheaper) {
      detail.push(
        `${MODEL_NAMES[lower]} com esforço ${effortName(candEffort)} alcança o pedido (${fmtNumber(input.need)}) e custa menos que ${MODEL_NAMES[tier]}`,
      )
      tier = lower
      step = cand
    }
  }
  let effort = effortAtStep(tier, step, input.calibration)
  const nudge = effortNudge(input.calibration, tier, step)
  // The person's own effort is a ceiling only when they asked for that.
  const ceiling = settingsCeiling(s, input.base)
  if (ceiling !== undefined && EFFORT_LADDER.indexOf(effort) > ceiling) {
    effort = EFFORT_LADDER[ceiling] ?? effort
    detail.push(`o seu esforço padrão é o teto: ${effortName(effort)}`)
  }
  const why = effortWhyOf(step, nudge, input.source, tier)
  detail.push(`esforço ${effortName(effort)}: ${why}`)

  return { tier, effort, why, detail }
}

function settingsCeiling(s: AutoModelSettings, base: Effort | number | undefined): number | undefined {
  if (s.effortMode !== 'respeitar' || typeof base !== 'string') return undefined
  const i = EFFORT_LADDER.indexOf(base)

  return i < 0 ? undefined : i
}

// ---- 4. the cheapest (model, effort) that is up to the job ----

export const EFFORT_COST: Record<string, number> = { low: 0.6, medium: 1, high: 1.6, xhigh: 2.2 }
const EFFORT_REACH: Record<string, number> = { low: -1.5, medium: 0, high: 1, xhigh: 1.5 }
const COMBO_EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh']
// How much head room a combo needs over the task's score.
const MARGIN = 1
const INPUT_SHARE = 0.5

export type Combo = { tier: AutoModelTier; effort: Effort; reach: number; cost: number }

export function reachOf(tier: AutoModelTier, effort: Effort, thresholds: readonly number[]): number {
  const top = tier === 3 ? (thresholds[2] ?? 9) + 4 : (thresholds[tier] ?? 9)

  return top + (EFFORT_REACH[effort] ?? 0)
}

export function costOf(tier: AutoModelTier, effort: Effort, prices: readonly number[]): number {
  const p = prices[tier] ?? 1

  return p * (INPUT_SHARE + (1 - INPUT_SHARE) * (EFFORT_COST[effort] ?? 1))
}

export function cheapestCombo(
  score: number,
  floor: AutoModelTier,
  s: AutoModelSettings,
  thresholds: readonly number[],
): Combo | undefined {
  const top = capTier(3, s)
  if (!s.isFableOn && top === 3) return undefined
  let best: Combo | undefined
  for (let t = floor; t <= top; t += 1) {
    const tier = t as AutoModelTier
    if (tier === 3 && !s.isFableOn) continue
    for (const effort of COMBO_EFFORTS) {
      const reach = reachOf(tier, effort, thresholds)
      if (reach < score + MARGIN) continue
      const cost = costOf(tier, effort, s.prices)
      if (best === undefined || cost < best.cost - 1e-9) best = { tier, effort, reach, cost }
    }
  }

  return best
}

// The score a Haiku label stands for, in the middle of its band.
export const LABEL_SCORE: readonly [number, number, number, number] = [0.5, 4, 7, 10.5]

// ---- 5. the Opus budget ----

export function dayKey(ms: number): string {
  const d = new Date(ms)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')

  return `${d.getFullYear()}-${mm}-${dd}`
}

export function addDay(
  days: Readonly<Record<string, AutoModelDay>>,
  key: string,
  tier: AutoModelTier,
  units: number,
  prices: readonly number[],
): Record<string, AutoModelDay> {
  const held = days[key] ?? { actual: 0, opus: 0, top: 0, turns: 0 }
  const actual = units * (prices[tier] ?? 1)
  const next: Record<string, AutoModelDay> = {
    ...days,
    [key]: {
      actual: held.actual + actual,
      opus: held.opus + units * (prices[OPUS] ?? 5),
      top: held.top + (tier >= OPUS ? actual : 0),
      turns: held.turns + 1,
      units: (held.units ?? 0) + units,
    },
  }
  const keys = Object.keys(next).sort()
  for (const old of keys.slice(0, Math.max(0, keys.length - 400))) delete next[old]

  return next
}

export type Month = { actual: number; top: number; share: number }

export function monthOf(days: Readonly<Record<string, AutoModelDay>>, key: string): Month {
  const prefix = key.slice(0, 7)
  let actual = 0
  let top = 0
  for (const [k, d] of Object.entries(days)) {
    if (!k.startsWith(prefix)) continue
    actual += d.actual
    top += d.top
  }

  return { actual, top, share: actual > 0 ? top / actual : 0 }
}

/** How far into its Opus budget the month is: 1 means spent. */
export function budgetRatio(s: AutoModelSettings, month: Month): number | undefined {
  if (s.opusBudget === null || s.opusBudget === undefined || s.opusBudget <= 0) return undefined
  if (month.actual <= 0) return 0

  return month.share / (s.opusBudget / 100)
}

// ---- 11. words that never go to the cheapest model ----


export function criticalHit(text: string, words: readonly string[]): string | undefined {
  const clean = normalize(text)
  for (const word of words) {
    const w = normalize(word).trim()
    if (w === '') continue
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(clean)) return word
  }

  return undefined
}

// ---- the decision, refined by everything above ----

export type RefineInput = {
  score: number
  label?: string
  text: string
  settings: AutoModelSettings
  thresholds: readonly number[]
  floor: AutoModelTier | undefined
  budget: number | undefined
  baseEffort: Effort | number | undefined
  calibration: Calibration | undefined
  /** The step on the effort ladder (0 low .. 3 xhigh) the task itself asks for, when the router read it. */
  demandStep?: number
}

export type Refined = {
  tier: AutoModelTier
  reason: string
  effort?: string
  /** The step the effort was drawn from, for the turn to keep. */
  step?: number
  effortWhy?: string
  confidence?: number
  detail: string[]
}

const LABELS = ['simples', 'medio', 'complexo', 'extremo']

/**
 * Takes a decision the rules or the classifier made and applies, in order:
 * the cheapest model-and-effort, the critical words, the project's floor and
 * the Opus budget; then the calibrated confidence. A forced, continued,
 * escalated or cache-kept decision is left as it was.
 */
export function refine(d: AutoModelDecision, input: RefineInput): Refined {
  const s = input.settings
  const detail: string[] = []
  let tier = d.tier
  let reason = d.reason
  let effort: string | undefined
  const isOpen = d.layer === 'regras' || d.layer === 'haiku' || d.layer === 'roteador'

  if (!isOpen) return { tier, reason, detail }

  const labelIndex = LABELS.indexOf(input.label ?? '')
  const need = d.layer === 'haiku' && labelIndex >= 0 ? (LABEL_SCORE[labelIndex] ?? input.score) : input.score

  // The effort comes from what the task asks for, not from the session's setting.
  const source: 'tarefa' | 'pontuação' = input.demandStep === undefined ? 'pontuação' : 'tarefa'
  const step = input.demandStep ?? levelOfScore(need)
  const picked = pickEffort({
    tier,
    need,
    step,
    source,
    settings: s,
    thresholds: input.thresholds,
    floor: input.floor,
    calibration: input.calibration,
    base: input.baseEffort,
  })
  if (picked.tier !== tier) {
    tier = picked.tier
    reason = REASONS[tier]
  }
  effort = picked.effort
  let effortWhy: string | undefined = picked.why
  detail.push(...picked.detail)
  detail.push(`modelo e esforço: ${MODEL_NAMES[tier]} + ${effortName(effort)}`)
  let usedStep = picked.tier === d.tier ? step : Math.min(2, step + 1)

  const raise = (to: AutoModelTier, why: string, line: string) => {
    const capped = capTier(to, s)
    if (capped <= tier) return
    tier = capped
    reason = why
    effort = effortAtStep(tier, usedStep, input.calibration)
    effortWhy = effortWhyOf(usedStep, 0, source, tier)
    detail.push(line)
  }

  const word = criticalHit(input.text, s.criticals)
  if (word !== undefined) raise(1, `assunto crítico (${word})`, `palavra crítica "${word}": mínimo Sonnet`)

  if (input.floor !== undefined) {
    raise(input.floor, `perfil do projeto (${MODEL_NAMES[input.floor]})`, `perfil deste projeto: mínimo ${MODEL_NAMES[input.floor]}`)
    if (capTier(input.floor, s) < input.floor) detail.push(`o teto (${MODEL_NAMES[s.ceiling]}) vale mais que o perfil`)
  }

  if (tier >= OPUS && input.budget !== undefined) {
    const ratio = input.budget
    const bar = (input.thresholds[1] ?? 5.5) + Math.max(0, ratio - 0.6) * 5
    if (ratio >= 1) {
      tier = 1
      reason = 'orçamento do Opus esgotado'
      usedStep = Math.max(usedStep, 2)
      effort = effortAtStep(1, usedStep, input.calibration)
      effortWhy = 'o Sonnet com esforço alto cobre a falta do Opus'
      detail.push(`orçamento do Opus usado em ${fmtPercent(Math.min(ratio, 9.99))}: Opus só com !opus`)
    } else if (ratio >= 0.6 && need < bar + 1.5) {
      tier = 1
      reason = 'poupando o orçamento do Opus'
      usedStep = Math.max(usedStep, 2)
      effort = effortAtStep(1, usedStep, input.calibration)
      effortWhy = 'o Sonnet com esforço alto cobre a falta do Opus'
      detail.push(
        `orçamento do Opus em ${fmtPercent(ratio)}: a barra para o Opus subiu para ${fmtNumber(bar + 1.5)} (pedido ${fmtNumber(need)})`,
      )
    }
  }

  let confidence: number | undefined
  const cal = calibratedConfidence(input.calibration, tier, need)
  if (cal !== undefined) {
    confidence = Math.round(cal.rate * 100) / 100
    detail.push(`Confiança calibrada: ${fmtPercent(cal.rate)} de acerto em ${cal.n} pedidos parecidos`)
  }

  return { tier, reason, effort, step: usedStep, ...(effortWhy === undefined ? {} : { effortWhy }), confidence, detail }
}

// ---- 8. proof of savings ----

export type Proof = {
  days: { key: string; actual: number; opus: number }[]
  actual: number
  opus: number
  saved: number
  savedPercent: number
  baseline: number
  planDays: number
}

export function proofOf(
  days: Readonly<Record<string, AutoModelDay>>,
  todayKey: string,
  todayMs: number,
  baselineSetting: number,
): Proof {
  const list: { key: string; actual: number; opus: number }[] = []
  for (let i = 13; i >= 0; i -= 1) {
    const key = dayKey(todayMs - i * 86_400_000)
    const d = days[key]
    list.push({ key, actual: d?.actual ?? 0, opus: d?.opus ?? 0 })
  }
  if (list[list.length - 1]?.key !== todayKey) list[list.length - 1] = { key: todayKey, actual: days[todayKey]?.actual ?? 0, opus: days[todayKey]?.opus ?? 0 }
  let actual = 0
  let opus = 0
  let active = 0
  for (const d of Object.values(days)) {
    actual += d.actual
    opus += d.opus
    if (d.turns > 0) active += 1
  }
  const saved = Math.max(0, opus - actual)
  const baseline = baselineSetting > 0 ? baselineSetting : active > 0 ? opus / active : 0

  return {
    days: list,
    actual,
    opus,
    saved,
    savedPercent: opus > 0 ? Math.round((saved / opus) * 100) : 0,
    baseline,
    planDays: baseline > 0 ? Math.round((saved / baseline) * 10) / 10 : 0,
  }
}

/** Three rows of a two-series column chart, two cells per day. */
export function proofChart(proof: Proof): { actual: string[]; opus: string[] } {
  const most = Math.max(1, ...proof.days.map(d => d.opus), ...proof.days.map(d => d.actual))
  const rows = 3
  const actual: string[] = []
  const opus: string[] = []
  for (let r = rows; r >= 1; r -= 1) {
    let a = ''
    let o = ''
    for (const d of proof.days) {
      const ha = Math.round((d.actual / most) * rows)
      const ho = Math.round((d.opus / most) * rows)
      a += ha >= r ? '█' : ' '
      o += ho >= r && ha < r ? '░' : ' '
      a += ' '
      o += ' '
    }
    actual.push(a)
    opus.push(o)
  }

  return { actual, opus }
}

// ---- 12. export ----

function csvCell(v: string | number): string {
  const text = String(v)

  return /[",;\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function exportCsv(
  samples: readonly Sample[],
  days: Readonly<Record<string, AutoModelDay>>,
  weekTokens = 40_000_000,
): string {
  const lines = ['tipo,data,modelo,resultado,pontuacao,grupos,custo_real,custo_sempre_opus,pedidos,uso_semana_estimado_pct']
  for (const s of samples) {
    lines.push(
      ['decisao', dayKey(s.at), MODEL_NAMES[s.tier], s.outcome, fmtNumber(s.score), s.groups.join(' '), '', '', '', '']
        .map(csvCell)
        .join(','),
    )
  }
  for (const key of Object.keys(days).sort()) {
    const d = days[key]
    if (d === undefined) continue
    const share = weekTokens > 0 ? ((d.units ?? 0) / weekTokens) * 100 : 0
    lines.push(
      ['dia', key, '', '', '', '', Math.round(d.actual), Math.round(d.opus), d.turns, share.toFixed(2).replace('.', ',')]
        .map(csvCell)
        .join(','),
    )
  }

  return `${lines.join('\n')}\n`
}

export function exportMarkdown(input: {
  date: string
  proof: Proof
  samples: readonly Sample[]
  days: Readonly<Record<string, AutoModelDay>>
  settings: AutoModelSettings
  calibration: Calibration | undefined
}): string {
  const { proof, samples } = input
  const byTier = [0, 0, 0, 0]
  let failures = 0
  for (const s of samples) {
    byTier[s.tier] = (byTier[s.tier] ?? 0) + 1
    if (isFailure(s.outcome)) failures += 1
  }
  const out = [
    `# Relatório do Auto Model · ${input.date}`,
    '',
    'Valores estimados com preços relativos aproximados, comparados com usar sempre o Opus nos mesmos tokens.',
    '',
    '## Resumo',
    '',
    `- Economia estimada: ${proof.savedPercent}%`,
    `- Custo relativo real: ${fmtInt(proof.actual)} · sempre Opus: ${fmtInt(proof.opus)}`,
    `- Equivale a cerca de ${fmtNumber(proof.planDays)} dias de uso do plano (base diária ${fmtInt(proof.baseline)})`,
    `- Decisões registradas: ${samples.length} · precisaram subir ou foram corrigidas: ${failures}`,
    `- Calibração: ${input.calibration === undefined ? `ainda não (precisa de ${MIN_SAMPLES} pedidos)` : `ativa, com ${input.calibration.samples} pedidos`}`,
    '',
    '## Por modelo',
    '',
    '| Modelo | Pedidos |',
    '| --- | ---: |',
    ...MODEL_NAMES.map((n, i) => `| ${n} | ${byTier[i] ?? 0} |`),
    '',
    '## Por dia',
    '',
    '| Dia | Pedidos | Custo real | Sempre Opus |',
    '| --- | ---: | ---: | ---: |',
    ...Object.keys(input.days)
      .sort()
      .map(k => {
        const d = input.days[k]
        return d === undefined ? '' : `| ${k} | ${d.turns} | ${fmtInt(d.actual)} | ${fmtInt(d.opus)} |`
      })
      .filter(Boolean),
    '',
    `Modelos: ${MODEL_IDS.join(', ')}.`,
    '',
  ]

  return out.join('\n')
}

// ---- help ----

export const HELP = [
  'Auto Model: comandos',
  '/automodelo · abre o painel',
  '/automodelo ligar | desligar',
  '/automodelo porque · por que o último modelo foi escolhido',
  '/automodelo porque detalhes · a conta completa',
  '/automodelo modo economia | equilibrado | qualidade · economia gasta menos; qualidade sobe de modelo mais cedo',
  '/automodelo explicar ligar | desligar · uma frase curta sobre cada escolha (desligado: só o modelo)',
  '/automodelo teste · mostra para onde iriam 6 pedidos de exemplo, sem enviar nada',
  '/automodelo prever <texto> · mostra o modelo e o esforço que esse texto receberia, sem enviar nada',
  '   e também os tokens, a sessão e a semana (antes → depois) e o tempo estimados, pelo seu histórico',
  '/automodelo tempo ligar | desligar · a faixa mostra quanto cada resposta levou (e o estimado, quando houver)',
  '/automodelo perfil · mostra o perfil deste projeto',
  '/automodelo perfil haiku | sonnet | opus | auto · mínimo para este projeto (auto = sem mínimo)',
  '/automodelo perfil limpar',
  '/automodelo orcamento · como está o orçamento do Opus neste mês',
  '/automodelo orcamento opus <porcentagem> · limite do mês para Opus e Fable',
  '/automodelo orcamento limpar',
  '/automodelo uso ligar | desligar · quanto da sessão e da semana cada resposta usou, só com números medidos pelo app',
  '/automodelo config · todas as configurações',
  '/automodelo config teto <haiku|sonnet|opus|fable>',
  '/automodelo config fable ligar | desligar',
  '/automodelo config sincronizar ligar | desligar · desligado por padrão: o app não troca o seletor e nada extra aparece na conversa',
  '/automodelo config esforco automatico | respeitar · automático: o pedido define o esforço; respeitar: o seu esforço padrão é o teto',
  '/automodelo config rotulo ligar | desligar · o rodapé mostra o modelo e o esforço, por exemplo "Haiku·baixo"',
  '/automodelo config usorodape ligar | desligar · o rodapé mostra a janela de uso mais cheia, por exemplo 🟡 Sessão 78%',
  '/automodelo config roteador ligar | desligar · o Haiku lê o que o pedido exige (desligado: só regras grátis)',
  '/automodelo config previsaoextra ligar | desligar · a prévia mostra também o tempo e a parte da sessão estimados',
  '/automodelo config preco <modelo> <número>',
  '/automodelo config base <número|auto> · custo de um dia típico, para "dias de plano"',
  '/automodelo config criticos · lista as palavras críticas',
  '/automodelo config criticos adicionar <palavra> | remover <palavra>',
  '/automodelo resumo · economia, uso, modelos e últimas decisões aqui na conversa (serve quando o painel não aparece)',
  '/automodelo diagnostico · versão, o que o motor mostra, o que foi aplicado, se o painel abriu e de onde vem o uso',
  '/automodelo exportar · salva um relatório .md e uma planilha .csv',
  '/automodelo zerar · zera as estatísticas (o que ele aprendeu continua)',
  'No começo de um pedido: !haiku, !sonnet, !opus ou !fable força o modelo só naquele pedido.',
].join('\n')

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

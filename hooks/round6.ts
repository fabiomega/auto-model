import type { AutoModelDay, AutoModelSettings, AutoModelTier } from '../types'

// ---- the modes: economia, equilibrado, qualidade ----

export type Strategy = AutoModelSettings['strategy']

export const STRATEGIES: readonly Strategy[] = ['economia', 'equilibrado', 'qualidade']

// How far each mode moves the thresholds between models: economia asks for a
// bigger need before it goes up a model, qualidade asks for less.
const SHIFT: Record<Strategy, number> = { economia: 0.8, equilibrado: 0, qualidade: -0.8 }

export function shiftThresholds(thresholds: readonly number[], strategy: Strategy): number[] {
  const by = SHIFT[strategy] ?? 0

  return thresholds.map(t => Math.max(0.5, t + by))
}

/** The effort step after the mode: one down for economia where it is safe, one up for qualidade. */
export function shiftStep(step: number, strategy: Strategy, isSensitive: boolean): number {
  if (strategy === 'economia') return isSensitive ? step : Math.max(0, step - 1)
  if (strategy === 'qualidade') return Math.min(3, step + 1)

  return step
}

export function strategyText(strategy: Strategy): string {
  if (strategy === 'economia') {
    return 'Modo economia: o Auto Model pede mais do pedido antes de subir de modelo e usa um nível a menos de esforço, sem passar dos pisos de segurança (palavras críticas e perfil do projeto).'
  }
  if (strategy === 'qualidade') {
    return 'Modo qualidade: o Auto Model sobe de modelo mais cedo e usa um nível a mais de esforço.'
  }

  return 'Modo equilibrado: o ponto de partida do Auto Model, o mais barato que dá conta.'
}

// ---- the long task: no stepping down in the middle of one ----

/** True when a model must not drop below the one working on a task that is still going. */
export function shouldHold(input: {
  buildStreak: number
  previous: AutoModelTier | undefined
  tier: AutoModelTier
  isContinuation: boolean
  isRelated: boolean
}): boolean {
  return (
    input.buildStreak >= 2 &&
    input.previous !== undefined &&
    input.tier < input.previous &&
    (input.isContinuation || input.isRelated)
  )
}

// ---- what a project teaches: its own floor ----

export type ProjectLearn = {
  /** The last ten outcomes, oldest first: which model, and whether it missed. */
  recent: { tier: AutoModelTier; bad: boolean }[]
  /** The floor the project has earned by itself; absent when none. */
  floor?: AutoModelTier
  /** Decisions in a row without a miss since the floor was raised. */
  clean: number
}

export const EMPTY_LEARN: ProjectLearn = { recent: [], clean: 0 }

/** Three misses on one model in the last ten raise the floor above it; twenty clean decisions lower it. */
export const MISSES_TO_RAISE = 3
export const CLEAN_TO_DECAY = 20

export function noteOutcome(held: ProjectLearn | undefined, tier: AutoModelTier, bad: boolean): ProjectLearn {
  const base = held ?? EMPTY_LEARN
  let recent = [...base.recent, { tier, bad }].slice(-10)
  let floor = base.floor
  let clean = bad ? 0 : base.clean + 1

  if (bad) {
    const misses = recent.filter(r => r.tier === tier && r.bad).length
    if (misses >= MISSES_TO_RAISE && tier < 2) {
      const up = (tier + 1) as AutoModelTier
      floor = floor === undefined ? up : (Math.max(floor, up) as AutoModelTier)
      recent = recent.filter(r => r.tier !== tier)
      clean = 0
    }
  } else if (floor !== undefined && clean >= CLEAN_TO_DECAY) {
    floor = floor > 1 ? ((floor - 1) as AutoModelTier) : undefined
    clean = 0
  }

  return { recent, ...(floor === undefined ? {} : { floor }), clean }
}

/** The higher of the person's own floor and the one the project earned. */
export function combineFloor(manual: AutoModelTier | undefined, learned: AutoModelTier | undefined): AutoModelTier | undefined {
  if (manual === undefined) return learned
  if (learned === undefined) return manual

  return Math.max(manual, learned) as AutoModelTier
}

// ---- the week: a summary once a week ----

/** A new day entry with every count at zero. */
function emptyDay(): AutoModelDay {
  return { actual: 0, opus: 0, top: 0, turns: 0 }
}

/** One more switch of model, or one more "errou", on a day. */
export function bumpDay(
  days: Readonly<Record<string, AutoModelDay>>,
  key: string,
  field: 'switches' | 'errou',
): Record<string, AutoModelDay> {
  const held = days[key] ?? emptyDay()

  return { ...days, [key]: { ...held, [field]: (held[field] ?? 0) + 1 } }
}

function keyOfDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')

  return `${d.getFullYear()}-${mm}-${dd}`
}

/** The Monday-to-Sunday day keys of the week that ends the day before `mondayKey`. */
export function previousWeek(mondayKey: string): string[] {
  const [y, m, d] = mondayKey.split('-').map(Number)
  const out: string[] = []
  for (let back = 7; back >= 1; back -= 1) out.push(keyOfDate(new Date(y ?? 1970, (m ?? 1) - 1, (d ?? 1) - back, 12)))

  return out
}

function ptDate(key: string): string {
  return `${key.slice(8, 10)}/${key.slice(5, 7)}`
}

export type WeekSummary = {
  turns: number
  savedPercent: number
  switches: number
  errou: number
  usagePercent: number
  from: string
  to: string
}

export function summarizeWeek(
  days: Readonly<Record<string, AutoModelDay>>,
  keys: readonly string[],
  weekTokens: number,
): WeekSummary {
  let actual = 0
  let opus = 0
  let turns = 0
  let switches = 0
  let errou = 0
  let units = 0
  for (const key of keys) {
    const day = days[key]
    if (day === undefined) continue
    actual += day.actual
    opus += day.opus
    turns += day.turns
    switches += day.switches ?? 0
    errou += day.errou ?? 0
    units += day.units ?? 0
  }

  return {
    turns,
    savedPercent: opus > 0 ? Math.max(0, Math.round(((opus - actual) / opus) * 100)) : 0,
    switches,
    errou,
    usagePercent: weekTokens > 0 ? Math.round((units / weekTokens) * 100) : 0,
    from: ptDate(keys[0] ?? ''),
    to: ptDate(keys[keys.length - 1] ?? ''),
  }
}

export function weekSummaryText(w: WeekSummary): string {
  const times = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

  return `Semana ${w.from} a ${w.to}: economia de ${w.savedPercent}% · ${times(w.switches, 'troca de modelo', 'trocas de modelo')} · ${times(w.errou, 'vez em que você apertou "errou"', 'vezes em que você apertou "errou"')} · uso estimado de ${w.usagePercent}% do limite semanal`
}

// ---- the colors: one per model, the same everywhere ----

/** Haiku teal, Sonnet blue, Opus violet, Fable rose: mid-tones that read on light and dark. */
export const MODEL_COLORS: readonly [string, string, string, string] = ['#14A39A', '#3B7DD8', '#7C5CD6', '#D6517D']

export function modelColor(tier: AutoModelTier): string {
  return MODEL_COLORS[tier] ?? MODEL_COLORS[1]
}

// ---- the compact label ----

/** "Haiku·baixo": the model and the effort it ran with, short enough never to be cut. */
export function shortLabel(name: string, effort: string | undefined): string {
  return effort === undefined || effort === '' ? name : `${name}·${effort}`
}

// ---- /automodelo teste ----

export const TEST_PROMPTS: readonly string[] = [
  'quantos arquivos tem nesta pasta?',
  'translate this paragraph into Spanish, please',
  'refatore a função de login para separar a validação e adicionar testes',
  'build me a complete sales system with inventory, login and reports',
  'revise a segurança do deploy em produção',
  'sim, pode continuar',
]

/** One row of the test table: the request, the model and effort it would get, and how sure. */
export function testRow(text: string, model: string, effort: string | undefined, confidence: number, where: string): string {
  const shown = text.length > 44 ? `${text.slice(0, 43)}…` : text

  return `${shown} → ${shortLabel(model, effort)} · ${Math.round(confidence * 100)}%${where === '' ? '' : ` · ${where}`}`
}

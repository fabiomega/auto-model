import type { EngineInterface, Register } from 'claude-code'

import type {
  AutoModelApplied,
  AutoModelBandMeasured,
  AutoModelMeter,
  AutoModelBand,
  AutoModelView,
  AutoModelDay,
  AutoModelDecision,
  AutoModelPreview,
  AutoModelSettings,
  AutoModelStats,
  AutoModelTier,
} from '../types'
import {
  CACHE_READ,
  CACHE_TTL_MS,
  CACHE_WRITE,
  CLASS_LABELS,
  OUTPUT,
  DEFAULT_SETTINGS,
  EMPTY_STATS,
  MODEL_IDS,
  MODEL_NAMES,
  addTurn,
  applySetting,
  bigNumeral,
  capTier,
  clampTier,
  contextOf,
  decide,
  describeSettings,
  effortName,
  effortShort,
  escalationRate,
  explain,
  fmtCompact,
  fmtInt,
  fmtNumber,
  fmtPercent,
  friendlyWhy,
  isContinuation,
  isFrustrated,
  learn,
  padEnd,
  padStart,
  readForce,
  savingsPercent,
  scorePrompt,
  textWidth,
  tierOfLabel,
  tierOfModel,
  tierOfScore,
  tokensSaved,
  translateCommandOutput,
  weighted,
} from './logic'
import { applyUsage, fmtPct, weekKeyOf } from './round5'
import {
  NO_ATTACHMENTS,
  addPace,
  addShare,
  ageText,
  attachmentSig,
  attachmentsOf,
  hasAny,
  isMeaningfulChange,
  keepWarned,
  measuredLine,
  measuredOf,
  newWarnings,
  projectionMinutes,
  projectionText,
  readingOf,
  resetsBetween,
  routerParts,
  sameReading,
  sessionResetText,
  shareText,
  signOf,
  toneOf,
  weekResetText,
  windowText,
  worstWindow,
} from './round8'
import type { Attachments, DraftShot, Measured } from './round8'
import {
  LONG_TEXT,
  accuracyText,
  bucketOf,
  failText,
  forecastLines,
  forecastOf,
  noteTime,
  previewExtra,
  previewWarning,
  pushDuration,
  rangeOf,
  tookText,
  upsertRatio,
  warningTone,
} from './round9'
import type { DurSample, RatioSample, TimeCal } from './round9'
import {
  CLEAN_TO_DECAY,
  MODEL_COLORS,
  TEST_PROMPTS,
  STRATEGIES,
  bumpDay,
  combineFloor,
  modelColor,
  noteOutcome,
  previousWeek,
  shiftStep,
  shiftThresholds,
  shortLabel,
  shouldHold,
  strategyText,
  summarizeWeek,
  testRow,
  weekSummaryText,
} from './round6'
import type { ProjectLearn } from './round6'
import type { Effort, Usage } from './logic'
import {
  EFFORT_LADDER,
  EMPTY_SLIP,
  HELP,
  addDay,
  budgetRatio,
  calibrate,
  dayKey,
  effortAtStep,
  effortStepOf,
  exportCsv,
  exportMarkdown,
  levelOfScore,
  markLast,
  mergeBias,
  monthOf,
  noteCall,
  profileKey,
  proofChart,
  proofOf,
  pushSample,
  refine,
  slipReason,
} from './round2'
import type { Calibration, Profiles, Sample, Slip } from './round2'
import {
  addRouterUse,
  cacheGet,
  cachePut,
  contextSig,
  correctLast,
  jaccard,
  keyOf,
  mergeRoutes,
  parseRoute,
  pushExample,
  routeDecide,
  routerPrompt,
  similar,
} from './router'
import type { Example, Route, RouteCache, RouterContext } from './router'
import { C, isGrid } from './theme'
import { premiumPane } from './panel'
import type { Els } from './panel'

const PANE = 'auto-model'
const TITLE = 'Auto Model'
// Whether the pane opens by itself when a conversation starts; the footer click and the close mark set it.
const PANE_AUTO_KEY = 'paneAuto'
// Whether the pane is on screen, so the band's button can say Mostrar or Ocultar.
const PANE_UP = { plugin: 'auto-model', key: 'paneUp' } as const

/** Opens the pane unless it is on screen already or the person hid it. */
async function ensurePane($: EngineInterface) {
  if ((await $.store.get(PANE_AUTO_KEY)) === false) return
  if ((await $.ui.panes()).some(p => p.id === PANE && p.isPlaced)) {
    await $.state.set(PANE_UP, true)
    return
  }
  const opened = await $.ui.open({ id: PANE, title: TITLE })
  await $.state.set(PANE_UP, opened.isPlaced)
}

/** The footer label's click: shows the pane when it is not on screen, hides it when it is. */
async function togglePane($: EngineInterface) {
  // The engine's list is the truth (a pane behind another tab counts as hidden); the mod's own record when it gives none.
  let isUp = (await $.state.get(PANE_UP)).value ?? false
  try {
    isUp = (await $.ui.panes()).some(p => p.id === PANE && p.isPlaced && p.isShown)
  } catch {
    // keep the mod's record
  }
  if (isUp) {
    await $.store.set(PANE_AUTO_KEY, false)
    await $.ui.close({ id: PANE })
    await $.state.set(PANE_UP, false)
    return
  }
  await $.store.set(PANE_AUTO_KEY, true)
  const opened = await $.ui.open({ id: PANE, title: TITLE })
  await $.state.set(PANE_UP, opened.isPlaced)
}

const GOLD = C.accent
const HAIR = C.hair
const MUTED = C.muted
const MAIN = C.text
const GOOD = C.good
const WARN = C.warn
// Each usage window takes its own colour: green up to 70%, gold up to 90%, red above.
const USAGE_TONE = { good: C.good, accent: C.warn, bad: C.bad } as const

const SETTINGS = { plugin: 'auto-model', key: 'settings' } as const
const STATS = { plugin: 'auto-model', key: 'stats' } as const
const DECISIONS = { plugin: 'auto-model', key: 'decisions' } as const
const BAND = { plugin: 'auto-model', key: 'band' } as const
const USAGE = { plugin: 'auto-model', key: 'usage' } as const
const USAGE_KEY = 'usage'
const DAYS = { plugin: 'auto-model', key: 'days' } as const
const PREVIEW = { plugin: 'auto-model', key: 'preview' } as const
const NEXT = { plugin: 'auto-model', key: 'next' } as const
const PROFILE = { plugin: 'auto-model', key: 'profile' } as const
const APPLIED = { plugin: 'auto-model', key: 'applied' } as const
const AUTOFLOOR = { plugin: 'auto-model', key: 'autoFloor' } as const
const UI = { plugin: 'auto-model', key: 'ui' } as const
const SUMMARY = { plugin: 'auto-model', key: 'summary' } as const

const SETTINGS_KEY = 'settings'
const STATS_KEY = 'stats'
const BIAS_KEY = 'bias'
const DECISIONS_KEY = 'decisions'
const DAYS_KEY = 'days'
const SAMPLES_KEY = 'samples'
const CALIBRATION_KEY = 'calibration'
const PROFILES_KEY = 'profiles'
const WARNED_KEY = 'budgetWarned'
const ROUTER_CACHE_KEY = 'routerCache'
const EXAMPLES_KEY = 'examples'
const LEARN_KEY = 'learn'
const WEEK_SEEN_KEY = 'weekSeen'
const SUMMARY_KEY = 'weekSummary'

const VERSION = '0.8.3'
// 0.8.3: the band's button shows or hides the pane, as the footer label does.
// 0.8.2: the pane opens by itself in the desktop app too, and on the first request when it did not fit at the start.
// 0.8.1: the pane opens by itself, the footer label shows and hides it, and the status line is gone.
// 0.8.0: how long requests take, what they cost, and the measured usage moves, for estimates.
const DURATIONS_KEY = 'durations'
const TIMECAL_KEY = 'timeCal'
const RATIOS_KEY = 'usageRatios'
// /automodelo prever blocks no send, so the router may take longer there.
const ROUTER_PREVER_MS = 8000
// How long a /model or /effort the mod itself queued counts as the mod's own.
const OWN_COMMAND_MS = 120_000

const CLASSIFY_MS = 4000
// The router's hard limit before a send, and the looser one while previewing a draft.
const ROUTER_SEND_MS = 2000
const ROUTER_PREVIEW_MS = 6000
// Wait this long after the last keystroke before reading the draft.
const PREVIEW_DEBOUNCE_MS = 700
// A paste this big is read at once, without waiting for the pause.
const BIG_PASTE = 800
const MIN_DRAFT = 12
// After an answer the app updates its limits a little later: read them again then.
const USAGE_REREAD_MS = [4000, 12000] as const
// After the router fails, the free rules decide alone for this long.
const ROUTER_PAUSE_MS = 60_000

// Whose typed or sent words choose a model; everything else keeps the last one.
const DECIDING_ORIGINS = new Set(['composer', 'bridge', 'sdk', 'plugin'])
// Layers where the mod itself chose, so their outcome teaches it something.
const LEARNING_LAYERS = new Set(['roteador', 'regras', 'haiku', 'cache'])

type Pending = AutoModelDecision & {
  text: string
  groups: string[]
  effortPick?: string
  /** The step on the effort ladder the request asked for, kept for escalations and corrections. */
  effortStep?: number
  key?: string
  /** The send decided otherwise than the preview showed: why, in one line. */
  changed?: string
  /** 0.8.0: which similar requests this one is compared with, and the time estimated before sending. */
  bucket?: string
  estimate?: { lo: number; hi: number }
}

/** One model call that reads a request; undefined when it failed or ran out of time. */
type Ask = (prompt: { text: string; cache?: true }[], ms: number) => Promise<{ route: Route; usage: Usage } | undefined>

type Routed = { route: Route; isCached: boolean; usage?: Usage }

type Turn = {
  turnId: string
  tier: AutoModelTier
  isEscalated: boolean
  /** Moved up in the middle of this turn because the model was struggling. */
  isSlipped: boolean
  isForced: boolean
  text: string
  groups: string[]
  layer: string
  score: number
  slip: Slip
  why?: string
  /** The request's meaning key and the router's summary, for the examples it leaves. */
  key?: string
  summary?: string
  effortPick?: string
  effortStep?: number
  /** What the status line was told about this turn, to keep it truthful. */
  decision?: AutoModelDecision
  /** The effort this turn was sent with, and the session's own setting it saw. */
  effort?: Effort | number
  sessionEffort?: Effort | number
  changed?: string
  bucket?: string
  estimate?: { lo: number; hi: number }
  /** When the turn started on the clock, for its duration when the engine reports none. */
  startedAt?: number
}

/** What of the meter survives a restart: the last measured reading and what was learned from the readings. */
function persistMeter(m: AutoModelMeter): Partial<AutoModelMeter> {
  return { latest: m.latest, pace: m.pace, share: m.share, warned: m.warned, resetSeen: m.resetSeen }
}

/** The usage lines under the main one, for the resumo: when each window resets, the pace and each model's share. */
function usageExtras(meter: AutoModelMeter | null, now: number): string[] {
  const m = meter?.latest ?? null
  if (meter === null || m === null) return []
  const out: string[] = []
  const sr = sessionResetText(m.sessionResetsAt, now)
  const wr = weekResetText(m.weekResetsAt, now)
  if (sr !== undefined || wr !== undefined) {
    out.push(`⏳ ${[sr === undefined ? '' : `Sessão reinicia ${sr}`, wr === undefined ? '' : `Semana reinicia ${wr}`].filter(Boolean).join(' · ')}`)
  }
  const projection = projectionText(projectionMinutes(meter.pace, m, now))
  if (projection !== undefined) out.push(projection)
  const share = shareText(meter.share)
  if (share !== undefined) out.push(share)

  return out
}

function asSettings(saved: unknown): AutoModelSettings {
  if (saved === undefined || saved === null || typeof saved !== 'object') return DEFAULT_SETTINGS
  const held = saved as Partial<AutoModelSettings>
  const s = { ...DEFAULT_SETTINGS, ...held }
  // Settings saved before 0.6.0 hold the old defaults (usage off, picker sync on): move them once.
  const moved = (held.v ?? 0) < 6 ? { ...s, isUsageOn: true, isSyncOn: false, v: 6 } : s

  return Array.isArray(moved.criticals) ? moved : { ...moved, criticals: DEFAULT_SETTINGS.criticals }
}

function budgetText(s: AutoModelSettings, days: Readonly<Record<string, AutoModelDay>>, today: string): string {
  if (s.opusBudget === null) {
    return 'Sem orçamento para o Opus. Defina com /automodelo orcamento opus <porcentagem>, por exemplo 30.'
  }
  const month = monthOf(days, today)
  const ratio = budgetRatio(s, month) ?? 0

  return [
    `Orçamento do Opus: ${fmtNumber(s.opusBudget)}% do custo estimado do mês.`,
    `Usado neste mês: ${fmtPercent(month.share)} do custo foi para Opus/Fable, ou seja ${fmtPercent(Math.min(ratio, 9.99))} do orçamento.`,
    ratio >= 1
      ? 'Esgotado: o Opus só entra com !opus até o mês virar.'
      : ratio >= 0.6
        ? 'Perto do limite: a barra para escolher o Opus está mais alta.'
        : 'Dentro do orçamento.',
    'Valores estimados.',
  ].join('\n')
}

export const register: Register = on => {
  // Per-process facts about the conversation; a reload only forgets the cache estimate.
  let pending: Pending | undefined
  let current: Turn | undefined
  let lastTier: AutoModelTier | undefined
  let lastCtx = 0
  let lastEndAt: number | undefined
  let bias: Record<string, number> = {}
  let cwd = ''
  let profiles: Profiles = {}
  let samples: Sample[] = []
  let calibration: Calibration | undefined
  let budgetWarned = ''
  let previewKey = ''
  const classified = new Map<string, AutoModelTier>()
  // Picker sync: what the person's own effort setting is (the baseline the
  // mod lowers from), what the mod last wrote, and whether /effort exists.
  let baseEffort: Effort | number | undefined
  let syncedEffort: Effort | number | undefined
  let hasEffortCommand = false
  // What the engine last told the mod, what the mod last sent, and what it queued for the picker.
  let lastSeenEffort: Effort | number | undefined
  let lastSent: { model: string; effort?: string | number; at: number } | undefined
  let lastAppliedKey = ''
  const queued: { command: string; args: string; at: number }[] = []
  const ownCommands = new Map<string, number>()
  // Whether the last /automodelo got its pane on screen, and where the usage line's numbers came from.
  let lastPaneOpen: { isPlaced: boolean | undefined; at: number } | undefined
  let usageProbe: { windows: string[]; at: number } | undefined

  // The effort for a model at a step of the ladder: what the history learned,
  // and the person's own effort as a ceiling only when they asked for that.
  const settleEffort = (s: AutoModelSettings, tier: AutoModelTier, step: number): Effort => {
    const effort = effortAtStep(tier, step, calibration)
    if (s.effortMode === 'respeitar' && typeof baseEffort === 'string') {
      const cap = EFFORT_LADDER.indexOf(baseEffort)
      if (cap >= 0 && EFFORT_LADDER.indexOf(effort) > cap) return EFFORT_LADDER[cap] ?? effort
    }

    return effort
  }

  // The semantic router: its cache, the person's examples, and what the conversation is doing.
  let routeCache: RouteCache = {}
  let examples: Example[] = []
  let lastResumo: string | undefined
  let isBuilding = false
  let turnsDone = 0
  let routerDownUntil = 0
  // The live preview: the pending read of the draft, and what was last read.
  let draftTimer: { cancel: () => void } | undefined
  let draftKey = ''
  // What each project taught the mod, how many build-style turns ran in a row, and the last request's words.
  let learnMap: Record<string, ProjectLearn> = {}
  let buildStreak = 0
  let lastKeyTokens: string[] = []
  // The draft as last read, what the preview last showed, and the pending re-reads of the limits.
  let draftShot: DraftShot | undefined
  let previewShown: { tier: AutoModelTier; effort?: string } | undefined
  let usageTimers: { cancel: () => void }[] = []
  // The model of the last answered request, which the week's measured moves are counted to.
  let usageTier: AutoModelTier | undefined
  // 0.8.0: the history estimates stand on, and the router's last failure for the diagnostic.
  let durations: DurSample[] = []
  let timeCal: TimeCal = { hit: 0, total: 0 }
  let ratios: RatioSample[] = []
  // The request whose measured usage move is still settling: its id, tokens and the reading before it.
  let ratioPending: { id: string; units: number; from: { session: number; week: number } } | undefined
  let routerFailure: { at: number; where: string; reason: string } | undefined
  const noteRouterFail = (at: number, where: string, reason: string) => {
    routerFailure = { at, where, reason }
  }

  // The floor of this project: the person's own, or the one its misses earned.
  const floorNow = (): AutoModelTier | undefined =>
    combineFloor(profiles[profileKey(cwd)], learnMap[profileKey(cwd)]?.floor)
  // The thresholds between models, moved by the mode.
  const thresholdsFor = (s: AutoModelSettings): number[] =>
    shiftThresholds(calibration?.thresholds ?? [2.5, 5.5, 9], s.strategy)

  // The mode moves the effort one step where that is safe.
  const strategize = (
    s: AutoModelSettings,
    tier: AutoModelTier,
    effort: string | undefined,
    reason: string,
    detail: string[],
  ): { effort: string | undefined; detail: string[] } => {
    if (s.strategy === 'equilibrado' || effort === undefined) return { effort, detail }
    const step = effortStepOf(effort)
    if (step === undefined) return { effort, detail }
    const isSensitive = /crític|sensível|segurança/.test(reason)
    const to = shiftStep(step, s.strategy, isSensitive)
    if (to === step) return { effort, detail }
    const moved = effortAtStep(tier, to, calibration)

    return { effort: moved, detail: [...detail, `modo ${s.strategy}: esforço ${effortName(effort)} -> ${effortName(moved)}`] }
  }

  // The last step of every decision: no stepping down in the middle of a long task, then the mode's effort.
  const finalize = (
    s: AutoModelSettings,
    decision: AutoModelDecision,
    effort: string | undefined,
    text: string,
    isCont: boolean,
    isFresh = false,
  ): { decision: AutoModelDecision; effort: string | undefined } => {
    let d = decision
    let e = effort
    const isRelated = jaccard(keyOf(text).split(' ').filter(Boolean), lastKeyTokens) >= 0.15
    const isOpen = d.layer === 'roteador' || d.layer === 'regras' || d.layer === 'haiku' || d.layer === 'cache'
    if (
      !isFresh &&
      isOpen &&
      lastTier !== undefined &&
      shouldHold({ buildStreak, previous: lastTier, tier: d.tier, isContinuation: isCont, isRelated })
    ) {
      const kept = capTier(lastTier, s)
      if (kept > d.tier) {
        e = effortAtStep(kept, effortStepOf(e) ?? 1, calibration)
        d = {
          ...d,
          tier: kept,
          reason: 'tarefa longa em andamento',
          layer: 'continuação',
          detail: [...d.detail, `tarefa longa em andamento (${buildStreak} pedidos de construção seguidos): não desce de ${MODEL_NAMES[kept]}`],
        }
      }
    }
    const learned = learnMap[profileKey(cwd)]?.floor
    if (!isFresh && learned !== undefined && d.tier === learned && (profiles[profileKey(cwd)] ?? -1) < learned) {
      d = { ...d, detail: [...d.detail, `aprendizado deste projeto: ${MODEL_NAMES[learned]} é o piso, porque o modelo abaixo errou várias vezes aqui`] }
    }
    const st = strategize(s, d.tier, e, d.reason, d.detail)

    return { decision: { ...d, detail: st.detail, ...(st.effort === undefined ? {} : { effort: st.effort }) }, effort: st.effort }
  }

  // A miss or a hit on a model, for what this project learns; the caller saves the map.
  const learnNote = (tier: AutoModelTier, bad: boolean): AutoModelTier | null => {
    const key = profileKey(cwd)
    const next = noteOutcome(learnMap[key], tier, bad)
    learnMap = { ...learnMap, [key]: next }

    return next.floor ?? null
  }

  const routerContext = (): RouterContext => ({
    lastResumo,
    lastTier,
    isBuilding,
    model: lastTier === undefined ? 'o da sessão' : MODEL_NAMES[lastTier],
    turns: turnsDone,
  })

  // The cache key of a request: its meaning plus what it carries attached, so adding or removing
  // an attachment is a different request.
  const routeKeyOf = (text: string, att: Attachments): string => {
    const sig = attachmentSig(att)

    return sig === '' ? keyOf(text) : `${keyOf(text)} |${sig}`
  }

  // Reads a request by meaning: the cache first, then short Haiku calls. A long text is read as a
  // digest (routerParts), in up to three parts read side by side; the most demanding part decides.
  const routeFor = async (text: string, att: Attachments, ask: Ask, now: number, ms: number, ignorePause = false): Promise<Routed | undefined> => {
    const key = routeKeyOf(text, att)
    const sig = contextSig(key, lastTier, isBuilding)
    const hit = cacheGet(routeCache, key, sig, now)
    if (hit !== undefined) return { route: hit, isCached: true }
    // 0.8.0: /automodelo prever tries the router even while it rests after a failure on a send.
    if (now < routerDownUntil && !ignorePause) return undefined
    const parts = routerParts(text, att)
    const shots = similar(examples, keyOf(text))
    const answers = await Promise.all(parts.map(part => ask(routerPrompt(part, routerContext(), shots), ms)))
    const good = answers.filter((a): a is { route: Route; usage: Usage } => a !== undefined)
    const route = good.length === answers.length ? mergeRoutes(good.map(a => a.route)) : undefined
    if (route === undefined) {
      routerDownUntil = now + ROUTER_PAUSE_MS
      return undefined
    }
    routeCache = cachePut(routeCache, key, sig, route, now)
    const usage = good.reduce<Usage | undefined>((sum, a) => {
      if (sum === undefined) return a.usage
      return {
        input_tokens: sum.input_tokens + a.usage.input_tokens,
        output_tokens: sum.output_tokens + a.usage.output_tokens,
        cache_read_input_tokens: sum.cache_read_input_tokens + a.usage.cache_read_input_tokens,
        cache_creation_input_tokens: sum.cache_creation_input_tokens + a.usage.cache_creation_input_tokens,
      }
    }, undefined)

    return { route, isCached: false, ...(usage === undefined ? {} : { usage }) }
  }

  // The same decision for the preview and the send: one function, the same state.
  const decideRouted = (
    routed: Routed,
    text: string,
    s: AutoModelSettings,
    now: number,
    days: Readonly<Record<string, AutoModelDay>>,
    isFresh = false,
  ) => {
    const r = routeDecide({
      route: routed.route,
      isCached: routed.isCached,
      text,
      settings: s,
      // A fresh reading answers "where would this go in a new conversation": no previous model, no cache to keep.
      previous: isFresh ? undefined : lastTier,
      ctx: isFresh ? 0 : lastCtx,
      isCacheWarm: !isFresh && lastEndAt !== undefined && now - lastEndAt < CACHE_TTL_MS,
      at: now,
      thresholds: thresholdsFor(s),
      floor: floorNow(),
      budget: budgetRatio(s, monthOf(days, dayKey(now))),
      baseEffort,
      calibration,
    })
    const done = finalize(s, r.decision, r.effort, text, routed.route.continuacao === true || isContinuation(text), isFresh)

    return { ...r, decision: done.decision, ...(done.effort === undefined ? {} : { effort: done.effort }) }
  }


  /** What the shared decision needs from the hook that calls it: the model calls and the last applied pair. */
  type DecideIo = {
    ask: Ask
    classify: (text: string) => Promise<AutoModelTier | undefined>
    applied: AutoModelApplied | null
  }
  type FullInput = {
    /** What the rules read: the prompt as typed, with a model picked in the band as a prefix. */
    typed: string
    /** What the router and the rest read: the prompt without a forcing prefix. */
    text: string
    att: Attachments
    s: AutoModelSettings
    now: number
    days: Readonly<Record<string, AutoModelDay>>
    picked: AutoModelTier | null
    ratio: number | undefined
    ms: number
    useRouter: boolean
    /** 0.8.0: read even while the router rests after a failure (the prever command). */
    ignorePause?: boolean
  }
  type Full = {
    kept: AutoModelDecision
    groups: string[]
    pick: string | undefined
    step: number | undefined
    score: number
    got: Routed | undefined
    routerFailed: boolean
  }

  // THE decision, for the send and for the live preview alike: the special cases (forced,
  // escalated, continued), then the router, or the free rules with the classifier when the router
  // cannot answer, then the floors, budget, cache and long-task holds, then the effort. The preview
  // calling this same function is what makes "what it shows is what runs" true.
  const decideFull = async (i: FullInput, io: DecideIo): Promise<Full> => {
    const { s, now } = i
    const hasAttachments = hasAny(i.att)
    const thresholds = thresholdsFor(s)
    const base = {
      text: i.typed,
      hasAttachments,
      settings: s,
      bias: mergeBias(bias, calibration?.groupShift),
      previous: lastTier,
      ctx: lastCtx,
      isCacheWarm: lastEndAt !== undefined && now - lastEndAt < CACHE_TTL_MS,
      at: now,
      thresholds,
    }
    let made = decide(base)
    const isSpecial = made.layer === 'forçado' || made.layer === 'escalada' || made.layer === 'continuação'
    let routed: ReturnType<typeof decideRouted> | undefined
    let got: Routed | undefined
    let routerFailed = false
    if (i.useRouter && !isSpecial && i.picked === null && s.isRouterOn) {
      got = await routeFor(i.text, i.att, io.ask, now, i.ms, i.ignorePause === true).catch(() => undefined)
      if (got !== undefined) routed = decideRouted(got, i.text, s, now, i.days)
      else routerFailed = true
    }

    let kept: AutoModelDecision
    let groups: string[]
    let pick: string | undefined
    let step: number | undefined
    if (routed !== undefined) {
      kept = routed.decision
      groups = []
      pick = routed.effort
      step = routed.step
    } else {
      if (made.needsClassifier) {
        let label: AutoModelTier | undefined = classified.get(i.text)
        if (label === undefined) {
          label = await io.classify(i.text).catch(() => undefined)
          if (label !== undefined) {
            if (classified.size > 200) classified.clear()
            classified.set(i.text, label)
          }
        }
        if (label !== undefined) made = decide({ ...base, classified: label })
      }
      if (i.picked !== null) {
        made = {
          ...made,
          reason: `escolhido na faixa (${MODEL_NAMES[i.picked]})`,
          detail: [...made.detail.slice(0, -1), `você escolheu ${MODEL_NAMES[i.picked]} na faixa, só para este pedido`],
        }
      }
      if (routerFailed) {
        made = { ...made, detail: [...made.detail, 'o roteador não respondeu a tempo: decidiram as regras de reserva'] }
      }
      const refined = refine(made, {
        score: made.score,
        label: made.label,
        text: i.text,
        settings: s,
        thresholds,
        floor: floorNow(),
        budget: i.ratio,
        baseEffort,
        calibration,
      })
      const { needsClassifier: _n, groups: matched, ...rest } = made
      groups = matched
      pick = refined.effort
      step = refined.step
      kept = {
        ...rest,
        tier: refined.tier,
        reason: refined.reason,
        confidence: refined.confidence ?? rest.confidence,
        detail: [...rest.detail, ...refined.detail],
        ...(typeof pick === 'string' ? { effort: pick } : {}),
        ...(refined.effortWhy === undefined ? {} : { effortWhy: refined.effortWhy }),
      }
      const done = finalize(s, kept, typeof pick === 'string' ? pick : undefined, i.text, isContinuation(i.text))
      kept = done.decision
      pick = done.effort ?? pick
    }
    if (pick === undefined) {
      // Forced, continued, kept for the cache or escalated: no reading decided the
      // effort, so it follows the last one when the model stays and the size of the request otherwise.
      const was = io.applied
      const sameModel = was !== null && was.tier === kept.tier && was.effort !== undefined
      const wasStep = effortStepOf(was?.effort)
      let at = levelOfScore(made.score)
      let why = 'o esforço segue o tamanho do pedido'
      if ((kept.layer === 'continuação' || kept.layer === 'cache') && sameModel && wasStep !== undefined) {
        at = wasStep
        why = 'o modelo continua o mesmo, então o esforço também'
      } else if (kept.layer === 'escalada' && wasStep !== undefined) {
        at = Math.min(3, wasStep + 1)
        why = 'a resposta anterior não serviu: um nível de esforço acima'
      } else if (kept.layer === 'forçado') {
        why = 'o modelo foi escolhido por você; o esforço segue o tamanho do pedido'
      }
      const settled = settleEffort(s, kept.tier, at)
      pick = settled
      step = at
      kept = { ...kept, effort: settled, effortWhy: why }
    }

    return { kept, groups, pick, step, score: made.score, got, routerFailed }
  }

  // ---- the usage meter: measured readings only ----

  const EMPTY_METER_V7: AutoModelMeter = { latest: null, start: null, last: null, pace: [], share: null, warned: [], resetSeen: [] }

  /** What the band and the pane show for the last request, from the reading before it to the latest. */
  const bandOf = (meter: AutoModelMeter, now: number): AutoModelBandMeasured | null => {
    const m = meter.latest
    if (m === null) return null
    const minutes = projectionMinutes(meter.pace, m, now)

    return {
      from: meter.start === null ? null : readingOf(meter.start),
      to: readingOf(m),
      at: m.at,
      ...(m.sessionResetsAt === undefined ? {} : { sessionResetsAt: m.sessionResetsAt }),
      ...(m.weekResetsAt === undefined ? {} : { weekResetsAt: m.weekResetsAt }),
      ...(minutes === undefined ? {} : { projection: minutes }),
    }
  }

  /**
   * Takes one measured reading into the meter: resets announced, warnings
   * raised (each window, threshold and period once), the pace, and the week's
   * move counted to the model of the last answered request. Pure: the caller
   * saves the meter and shows the toasts.
   */
  const takeReading = (meter: AutoModelMeter, m: Measured, isUsageOn: boolean): { meter: AutoModelMeter; toasts: string[] } => {
    const toasts: string[] = []
    const prev = meter.latest
    let resetSeen = meter.resetSeen
    for (const kind of resetsBetween(prev, m)) {
      const key = `${kind}:${(kind === 'session' ? m.sessionResetsAt : m.weekResetsAt) ?? m.at}`
      if (resetSeen.includes(key)) continue
      resetSeen = [...resetSeen, key].slice(-20)
      if (isUsageOn) toasts.push(kind === 'session' ? '🔄 Sessão reiniciada: 100% livre' : '🔄 Semana reiniciada: 100% livre')
    }
    let warned = keepWarned(meter.warned, m)
    if (isUsageOn) {
      for (const w of newWarnings(m, warned)) {
        warned = [...warned, w.key]
        toasts.push(w.text)
      }
    }
    const period = m.weekResetsAt ?? 'semana'
    const weekMove = prev !== null && (prev.weekResetsAt ?? 'semana') === period ? m.week - prev.week : 0
    const share = usageTier === undefined ? meter.share : addShare(meter.share, period, usageTier, weekMove)
    const next: AutoModelMeter = { ...meter, latest: m, pace: addPace(meter.pace, m), warned, resetSeen, share }

    return { meter: { ...next, last: bandOf(next, m.at) }, toasts }
  }

  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    await $.command.register({
      name: 'automodelo',
      description: 'Auto Model: escolhe o modelo mais barato que dá conta de cada pedido',
      argumentHint: '[ajuda|ligar|desligar|porque|modo|perfil|orcamento|uso|config|diagnostico|exportar|zerar]',
    })
    try {
      hasEffortCommand = (await $.command.list()).some(c => c.name === 'effort')
    } catch {
      hasEffortCommand = false
    }
    try {
      const s = asSettings(await $.store.get(SETTINGS_KEY))
      await $.state.set(SETTINGS, s)
      const stats = await $.store.get(STATS_KEY)
      if (stats !== undefined && stats !== null && typeof stats === 'object') {
        await $.state.set(STATS, { ...EMPTY_STATS, ...(stats as Partial<AutoModelStats>) })
      }
      const list = await $.store.get(DECISIONS_KEY)
      if (Array.isArray(list)) await $.state.set(DECISIONS, list as AutoModelDecision[])
      const learned = await $.store.get(BIAS_KEY)
      if (learned !== undefined && learned !== null && typeof learned === 'object') {
        bias = { ...(learned as Record<string, number>) }
      }
      const days = await $.store.get(DAYS_KEY)
      if (days !== undefined && days !== null && typeof days === 'object') {
        await $.state.set(DAYS, days as Record<string, AutoModelDay>)
      }
      const kept = await $.store.get(SAMPLES_KEY)
      if (Array.isArray(kept)) samples = kept as Sample[]
      const cal = await $.store.get(CALIBRATION_KEY)
      if (cal !== undefined && cal !== null && typeof cal === 'object') calibration = cal as Calibration
      const prof = await $.store.get(PROFILES_KEY)
      if (prof !== undefined && prof !== null && typeof prof === 'object') profiles = prof as Profiles
      await $.state.set(PROFILE, profiles[profileKey(cwd)] ?? null)
      const warned = await $.store.get(WARNED_KEY)
      if (typeof warned === 'string') budgetWarned = warned
      // The meter keeps its last measured reading across restarts, shown with its age until a new one comes.
      const meter = await $.store.get(USAGE_KEY)
      if (meter !== undefined && meter !== null && typeof meter === 'object' && 'latest' in (meter as object)) {
        const kept = { ...EMPTY_METER_V7, ...(meter as Partial<AutoModelMeter>), start: null, last: null }
        await $.state.set(USAGE, kept)
      }
      const cached = await $.store.get(ROUTER_CACHE_KEY)
      if (cached !== undefined && cached !== null && typeof cached === 'object') routeCache = cached as RouteCache
      const shots = await $.store.get(EXAMPLES_KEY)
      if (Array.isArray(shots)) examples = shots as Example[]
      const timed = await $.store.get(DURATIONS_KEY)
      if (Array.isArray(timed)) durations = timed as DurSample[]
      const hits = await $.store.get(TIMECAL_KEY)
      if (hits !== undefined && hits !== null && typeof hits === 'object') timeCal = { hit: 0, total: 0, ...(hits as Partial<TimeCal>) }
      const moved = await $.store.get(RATIOS_KEY)
      if (Array.isArray(moved)) ratios = moved as RatioSample[]
      const taught = await $.store.get(LEARN_KEY)
      if (taught !== undefined && taught !== null && typeof taught === 'object') learnMap = taught as Record<string, ProjectLearn>
      await $.state.set(AUTOFLOOR, learnMap[profileKey(cwd)]?.floor ?? null)
      // Old defaults move to the new ones once (usage on, picker sync off).
      await $.store.set(SETTINGS_KEY, s)
      const lastWeek = await $.store.get(SUMMARY_KEY)
      if (typeof lastWeek === 'string') await $.state.set(SUMMARY, lastWeek)
      // Once a week, the week that ended: economy, switches, "errou" and use.
      const now = await $.clock.now()
      const thisWeek = weekKeyOf(now)
      const seen = await $.store.get(WEEK_SEEN_KEY)
      if (seen !== thisWeek) {
        await $.store.set(WEEK_SEEN_KEY, thisWeek)
        const held = (await $.state.get(DAYS)).value ?? {}
        const week = summarizeWeek(held, previousWeek(thisWeek), s.weekTokens)
        if (typeof seen === 'string' && week.turns > 0) {
          const text = weekSummaryText(week)
          await $.store.set(SUMMARY_KEY, text)
          await $.state.set(SUMMARY, text)
          $.ui.toast(text)
        }
      }
      // The pane opens by itself, unless the person hid it last time.
      // The desktop app runs the engine as an SDK host, where isInteractive is false: no gate on it.
      $.clock.after(0, () => {
        void ensurePane($).catch(() => undefined)
      })
    } catch {
      // The mod still works; only the start-of-session extras were skipped.
    }

    return next(e)
  })

  // Closing the pane by its mark keeps it closed in the next conversations too.
  on('ui.close', async ($, e, next) => {
    const result = await next(e)
    if (e.id === PANE) await $.state.set(PANE_UP, false)
    if (e.id === PANE && e.origin.kind === 'person') await $.store.set(PANE_AUTO_KEY, false)

    return result
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      lastTier = undefined
      lastCtx = 0
      lastEndAt = undefined
      pending = undefined
      current = undefined
      lastResumo = undefined
      isBuilding = false
      turnsDone = 0
      try {
        await $.state.set(BAND, null)
        await $.state.set(PREVIEW, null)
        await $.state.set(APPLIED, null)
        lastAppliedKey = ''
      } catch {
        // nothing to hide
      }
    }

    return next(e)
  })

  on('command.run', { command: 'automodelo' }, async ($, e) => {
    const words = e.args.trim().split(/\s+/).filter(Boolean)
    const head = (words[0] ?? '').toLowerCase()
    const s = (await $.state.get(SETTINGS)).value ?? DEFAULT_SETTINGS
    const save = async (changed: AutoModelSettings) => {
      await $.state.set(SETTINGS, changed)
      await $.store.set(SETTINGS_KEY, changed)
    }

    if (head === '') {
      // Wait a moment for the app to say whether the pane fit; past that, answer anyway.
      const opened = $.ui
        .open({ id: PANE, title: TITLE })
        .then(r => r?.isPlaced)
        .catch(() => false as boolean | undefined)
      const isPlaced = await Promise.race([opened, $.clock.sleep(1200).then(() => undefined)])
      lastPaneOpen = { isPlaced, at: await $.clock.now() }
      if (isPlaced === false) {
        return {
          text: 'O painel do Auto Model não coube nesta janela. Amplie a janela do Claude e rode /automodelo de novo, ou veja o resumo aqui com /automodelo resumo.',
        }
      }
      return { text: `Painel do Auto Model aberto (versão ${VERSION}). Todos os comandos: /automodelo ajuda` }
    }
    if (head === 'ajuda' || head === 'help') return { text: `Auto Model ${VERSION}\n\n${HELP}` }
    if (head === 'resumo' || head === 'summary') {
      const now = await $.clock.now()
      const stats = (await $.state.get(STATS)).value ?? EMPTY_STATS
      const list = (await $.state.get(DECISIONS)).value ?? []
      const meter = (await $.state.get(USAGE)).value ?? null
      const total = stats.byTier.reduce((a, b) => a + b, 0)
      const share = stats.byTier
        .map((n, i) => (n === 0 ? '' : `${MODEL_NAMES[i as AutoModelTier]} ${Math.round((n / Math.max(1, total)) * 100)}%`))
        .filter(Boolean)
      const lines = [
        `Auto Model ${VERSION} · ${s.isOn ? 'ligado' : 'desligado'} · modo ${s.strategy}`,
        `Economia: ${savingsPercent(stats)}% contra usar sempre o Opus (estimativa, ${stats.turns} pedidos)`,
        `Uso: ${measuredLine(meter?.latest ?? null, meter?.last?.from ?? null, now, false)}`,
        ...usageExtras(meter, now),
        `Por modelo: ${share.length === 0 ? 'ainda sem pedidos' : share.join(' · ')}`,
        'Últimas decisões:',
        ...(list.length === 0
          ? ['- nenhuma ainda']
          : list
              .slice(-3)
              .reverse()
              .map(d => `- ${MODEL_NAMES[d.tier]}${d.effort === undefined ? '' : ` · ${effortName(d.effort)}`} · ${d.summary ?? d.reason} · ${fmtPercent(d.confidence)}`)),
      ]
      return { text: lines.join('\n') }
    }
    if (head === 'ligar' || head === 'on') {
      const changed = { ...s, isOn: true }
      await save(changed)
      return { text: 'Auto Model ligado: cada pedido vai para o modelo mais barato que dá conta.' }
    }
    if (head === 'desligar' || head === 'off') {
      const changed = { ...s, isOn: false }
      await save(changed)
      return { text: 'Auto Model desligado: o modelo que você escolheu vale para tudo.' }
    }
    if (head === 'porque' || head === 'porquê' || head === 'why') {
      const list = (await $.state.get(DECISIONS)).value ?? []
      const isDetailed = /^detalh|^details?$|^tudo$/.test((words[1] ?? '').toLowerCase())
      const text = explain(list[list.length - 1], isDetailed)
      const extra =
        isDetailed && calibration !== undefined
          ? `\nCalibração ativa com ${calibration.samples} pedidos: limites ${calibration.thresholds.map(fmtNumber).join(' / ')}.`
          : ''
      return { text: text + extra }
    }
    if (head === 'modo' || head === 'mode') {
      const value = (words[1] ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      if ((STRATEGIES as readonly string[]).includes(value)) {
        const changed = { ...s, strategy: value as AutoModelSettings['strategy'] }
        await save(changed)

        return { text: strategyText(changed.strategy) }
      }
      // The old spelling still works: it only decides whether each choice is explained.
      if (value === 'silencioso' || value === 'explicativo') {
        const changed = { ...s, mode: value as AutoModelSettings['mode'] }
        await save(changed)
        return {
          text:
            value === 'silencioso'
              ? 'Explicações desligadas: a barra mostra só o modelo.'
              : 'Explicações ligadas: a barra mostra o modelo e o porquê, e cada resposta ganha uma frase curta.',
        }
      }
      return { text: `${strategyText(s.strategy)}\nUse /automodelo modo economia, equilibrado ou qualidade.` }
    }
    if (head === 'explicar' || head === 'explain') {
      const value = (words[1] ?? '').toLowerCase()
      if (['ligar', 'on', 'sim', 'ligado'].includes(value) || ['desligar', 'off', 'nao', 'não', 'desligado'].includes(value)) {
        const isOn = ['ligar', 'on', 'sim', 'ligado'].includes(value)
        const changed = { ...s, mode: (isOn ? 'explicativo' : 'silencioso') as AutoModelSettings['mode'] }
        await save(changed)

        return {
          text: isOn
            ? 'Explicações ligadas: cada resposta ganha uma frase curta sobre a escolha do modelo.'
            : 'Explicações desligadas: só o modelo e o esforço aparecem.',
        }
      }
      return { text: `Explicações: ${s.mode === 'explicativo' ? 'ligadas' : 'desligadas'}. Use /automodelo explicar ligar ou /automodelo explicar desligar.` }
    }
    if (head === 'prever' || head === 'preview') {
      const asked = e.args.trim().replace(/^\S+\s*/, '')
      if (asked === '') {
        return { text: 'Use /automodelo prever <texto>: mostra o modelo e o esforço que esse pedido receberia, sem enviar nada.' }
      }
      const now = await $.clock.now()
      const days = (await $.state.get(DAYS)).value ?? {}
      // 0.8.0: nothing waits on this command, so the router gets longer, and why it failed is kept for the diagnostic.
      const ask: Ask = async (prompt, ms) => {
        const call = $.model
          .complete({ model: 'haiku', prompt, effort: 'low', maxTokens: 220, timeoutMs: ms })
          .then(r => {
            if (r !== undefined && r !== null && r.isAnswered) return r
            noteRouterFail(now, 'prever', failText(r))
            return undefined
          })
          .catch(() => {
            noteRouterFail(now, 'prever', 'a chamada ao modelo falhou')
            return undefined
          })
        const res = await Promise.race([call, $.clock.sleep(ms).then(() => 'timeout' as const)])
        if (res === 'timeout') {
          noteRouterFail(now, 'prever', `tempo esgotado (${Math.round(ms / 1000)} s)`)
          return undefined
        }
        if (res === undefined) return undefined
        const route = parseRoute(res.text)
        if (route === undefined) noteRouterFail(now, 'prever', 'resposta fora do formato esperado')

        return route === undefined ? undefined : { route, usage: res.usage }
      }
      const classify = async (t: string): Promise<AutoModelTier | undefined> => {
        const answer = await Promise.race([
          $.model.classify(t.slice(0, 4000), CLASS_LABELS, { model: 'haiku' }),
          $.clock.sleep(CLASSIFY_MS).then(() => undefined),
        ])

        return tierOfLabel(answer)
      }
      const att = attachmentsOf(asked)
      const full = await decideFull(
        {
          typed: asked,
          text: readForce(asked)?.text ?? asked,
          att,
          s,
          now,
          days,
          picked: null,
          ratio: budgetRatio(s, monthOf(days, dayKey(now))),
          ms: ROUTER_PREVER_MS,
          useRouter: true,
          ignorePause: true,
        },
        { ask, classify, applied: (await $.state.get(APPLIED)).value ?? null },
      )
      if (full.got !== undefined && !full.got.isCached) {
        const held = (await $.state.get(STATS)).value ?? EMPTY_STATS
        const stats = addRouterUse({ ...EMPTY_STATS, ...held }, full.got.usage, s.prices)
        await $.state.set(STATS, stats)
        await $.store.set(STATS_KEY, stats)
        await $.store.set(ROUTER_CACHE_KEY, routeCache)
      }
      const d = full.kept
      const effort = typeof full.pick === 'string' ? effortName(full.pick) : undefined
      // 0.8.0: tokens, the two usage windows (before → after) and the time, from the person's own history.
      const pickText = typeof full.pick === 'string' ? full.pick : undefined
      const forecast = forecastOf(
        durations,
        ratios,
        bucketOf(d.tier, pickText, full.score, hasAny(att), asked.length > LONG_TEXT),
        (await $.state.get(USAGE)).value?.latest ?? null,
        now,
      )
      const failNote = full.routerFailed && routerFailure !== undefined && routerFailure.at === now ? `: ${routerFailure.reason}` : ''
      const lines = [
        `Previsão do Auto Model ${VERSION} · nada foi enviado`,
        `● ${MODEL_NAMES[d.tier]}${effort === undefined ? '' : ` · esforço ${effort}`} · confiança ${fmtPercent(d.confidence)}`,
        `  Motivo: ${d.summary ?? d.reason}${full.routerFailed ? ` (regras de reserva: o roteador não respondeu${failNote})` : full.got?.isCached === true ? ' (veio do cache, sem custo)' : ''}`,
        ...(d.effortWhy === undefined ? [] : [`  Esforço: ${d.effortWhy}`]),
        ...(hasAny(att) ? [`  Anexos considerados: ${attachmentSig(att)}`] : []),
        ...(asked.length > 2500 ? ['  Texto longo: lido como resumo que mantém todos os pedidos, inclusive os do meio.'] : []),
        ...forecastLines(forecast),
      ]
      return { text: lines.join('\n') }
    }
    if (head === 'teste' || head === 'test') {
      const now = await $.clock.now()
      const days = (await $.state.get(DAYS)).value ?? {}
      const ask: Ask = async (prompt, ms) => {
        const call = $.model
          .complete({ model: 'haiku', prompt, effort: 'low', maxTokens: 220, timeoutMs: ms })
          .then(r => (r !== undefined && r !== null && r.isAnswered ? r : undefined))
          .catch(() => undefined)
        const res = await Promise.race([call, $.clock.sleep(ms).then(() => undefined)])
        if (res === undefined) return undefined
        const route = parseRoute(res.text)

        return route === undefined ? undefined : { route, usage: res.usage }
      }
      // Each sample is read as the first request of a new conversation; when this conversation would
      // send it elsewhere (a model to keep, a warm cache), a second note says so.
      const byRules = (text: string, isFresh: boolean) => {
        const isCont = !isFresh && isContinuation(text)
        const made = decide({
          text,
          hasAttachments: false,
          settings: s,
          bias: mergeBias(bias, calibration?.groupShift),
          previous: isFresh ? undefined : lastTier,
          ctx: isFresh ? 0 : lastCtx,
          isCacheWarm: false,
          at: now,
          thresholds: thresholdsFor(s),
        })
        const refined = refine(made, {
          score: made.score,
          text,
          settings: s,
          thresholds: thresholdsFor(s),
          floor: floorNow(),
          budget: undefined,
          baseEffort,
          calibration,
        })
        const done = finalize(s, { ...made, tier: refined.tier, reason: refined.reason }, refined.effort, text, isCont, isFresh)

        return { decision: done.decision, effort: done.effort, confidence: made.confidence, where: isCont ? 'continuação' : 'regras' }
      }
      const inThisChat = (fresh: AutoModelTier, here: { tier: AutoModelTier; reason: string }) =>
        here.tier === fresh ? '' : ` (nesta conversa: ${MODEL_NAMES[here.tier]}, ${here.reason})`
      const rows = await Promise.all(
        TEST_PROMPTS.map(async text => {
          if (!s.isRouterOn) {
            const fresh = byRules(text, true)
            const here = byRules(text, false)

            return (
              testRow(text, MODEL_NAMES[fresh.decision.tier], effortShort(fresh.effort) || undefined, fresh.confidence, fresh.where) +
              inThisChat(fresh.decision.tier, here.decision)
            )
          }
          const got = await routeFor(text, NO_ATTACHMENTS, ask, now, ROUTER_PREVIEW_MS).catch(() => undefined)
          if (got === undefined) {
            const fresh = byRules(text, true)

            return testRow(text, MODEL_NAMES[fresh.decision.tier], effortShort(fresh.effort) || undefined, fresh.confidence, 'regras de reserva')
          }
          const fresh = decideRouted(got, text, s, now, days, true).decision
          const here = decideRouted(got, text, s, now, days).decision

          return (
            testRow(text, MODEL_NAMES[fresh.tier], effortShort(fresh.effort) || undefined, fresh.confidence, got.isCached ? 'cache' : 'roteador') +
            inThisChat(fresh.tier, here)
          )
        }),
      )
      await $.store.set(ROUTER_CACHE_KEY, routeCache)

      return {
        text: [
          `Teste do Auto Model ${VERSION} (modo ${s.strategy}) — nada foi enviado. Cada pedido é lido como o primeiro de uma conversa nova:`,
          ...rows.map(r => `- ${r}`),
        ].join('\n'),
      }
    }
    if (head === 'perfil' || head === 'profile') {
      const key = profileKey(cwd)
      const value = (words[1] ?? '').toLowerCase()
      const where = cwd === '' ? 'este projeto' : cwd
      if (value === '') {
        const held = profiles[key]
        return {
          text:
            held === undefined
              ? `Sem perfil para ${where}: o Auto Model escolhe livremente. Defina com /automodelo perfil <haiku|sonnet|opus|auto>.`
              : `Perfil de ${where}: mínimo ${MODEL_NAMES[held]}. Limpe com /automodelo perfil limpar.`,
        }
      }
      if (value === 'limpar' || value === 'auto' || value === 'automatico') {
        const { [key]: _gone, ...rest } = profiles
        profiles = rest
        await $.store.set(PROFILES_KEY, profiles)
        await $.state.set(PROFILE, null)
        return { text: `Perfil de ${where} removido: o Auto Model escolhe livremente.` }
      }
      const tier = tierOfModel(value)
      if (tier === undefined) return { text: 'Use /automodelo perfil haiku, sonnet, opus, auto ou limpar.' }
      profiles = { ...profiles, [key]: tier }
      await $.store.set(PROFILES_KEY, profiles)
      await $.state.set(PROFILE, tier)
      const capped = capTier(tier, s)
      return {
        text:
          `Perfil de ${where}: mínimo ${MODEL_NAMES[tier]}. Pedidos deste projeto nunca vão abaixo dele.` +
          (capped < tier ? ` Atenção: o teto atual (${MODEL_NAMES[s.ceiling]}) vale mais que o perfil.` : ''),
      }
    }
    if (head === 'orcamento' || head === 'orçamento' || head === 'budget') {
      const days = (await $.state.get(DAYS)).value ?? {}
      const today = dayKey(await $.clock.now())
      const value = (words[1] ?? '').toLowerCase()
      if (value === '') return { text: budgetText(s, days, today) }
      if (value === 'limpar' || value === 'remover') {
        await save({ ...s, opusBudget: null })
        return { text: 'Orçamento do Opus removido: sem limite mensal.' }
      }
      if (value === 'opus' || value === 'fable') {
        const n = Number((words[2] ?? '').replace('%', '').replace(',', '.'))
        if (!Number.isFinite(n) || n <= 0 || n > 100) {
          return { text: 'Use /automodelo orcamento opus <porcentagem de 1 a 100>, por exemplo /automodelo orcamento opus 30.' }
        }
        const changed = { ...s, opusBudget: n }
        await save(changed)
        return {
          text: `Orçamento do Opus: no máximo ${fmtNumber(n)}% do custo estimado do mês vai para Opus e Fable. Perto do limite a barra sobe; esgotado, o Opus só entra com !opus.\n\n${budgetText(changed, days, today)}`,
        }
      }
      return { text: 'Use /automodelo orcamento, /automodelo orcamento opus <porcentagem> ou /automodelo orcamento limpar.' }
    }
    if (head === 'uso') {
      const change = applyUsage(s, words.slice(1))
      if ('error' in change) return { text: change.error }
      await save(change.settings)
      return { text: change.text }
    }
    // 0.8.0: the time each answer took, in the band.
    if (head === 'tempo' || head === 'time') {
      const value = (words[1] ?? '').toLowerCase()
      const isOn = ['ligar', 'on', 'sim', 'ligado'].includes(value)
      const isOff = ['desligar', 'off', 'nao', 'não', 'desligado'].includes(value)
      if (!isOn && !isOff) {
        return { text: `Tempo de cada resposta: ${s.isTimeOn !== false ? 'ligado' : 'desligado'}. Use /automodelo tempo ligar ou /automodelo tempo desligar.` }
      }
      await save({ ...s, isTimeOn: isOn })

      return {
        text: isOn
          ? 'Tempo ligado: a faixa mostra quanto cada resposta levou (e o estimado, quando houver histórico).'
          : 'Tempo desligado: a faixa não mostra mais quanto cada resposta levou.',
      }
    }
    if ((head === 'config' || head === 'configurar') && (words[1] ?? '').toLowerCase() === 'previsaoextra') {
      const value = (words[2] ?? '').toLowerCase()
      const isOn = ['ligar', 'on', 'sim', 'ligado'].includes(value)
      const isOff = ['desligar', 'off', 'nao', 'não', 'desligado'].includes(value)
      if (!isOn && !isOff) return { text: 'Use /automodelo config previsaoextra ligar ou desligar.' }
      await save({ ...s, isPreviewExtraOn: isOn })

      return {
        text: isOn
          ? 'Previsão extra ligada: a prévia mostra também o tempo e a parte da sessão estimados.'
          : 'Previsão extra desligada: a prévia mostra só o modelo e o esforço.',
      }
    }
    if ((head === 'config' || head === 'configurar') && words.length === 1) {
      return {
        text: [
          describeSettings(s),
          `Tempo de cada resposta: ${s.isTimeOn !== false ? 'ligado' : 'desligado'} · /automodelo tempo ligar|desligar`,
          `Previsão extra na prévia (tempo e sessão): ${s.isPreviewExtraOn !== false ? 'ligada' : 'desligada'} · /automodelo config previsaoextra ligar|desligar`,
        ].join('\n'),
      }
    }
    if (head === 'config' || head === 'configurar') {
      if (words.length === 1) return { text: describeSettings(s) }
      const change = applySetting(s, words.slice(1))
      if ('error' in change) return { text: change.error }
      await save(change.settings)
      return { text: change.text }
    }
    if (head === 'diagnostico' || head === 'diag' || head === 'diagnostic') {
      const now = await $.clock.now()
      const shown = await $.session.model().catch(() => undefined)
      const shownTier = tierOfModel(shown)
      const applied = (await $.state.get(APPLIED)).value ?? null
      const list = (await $.state.get(DECISIONS)).value ?? []
      const last = list[list.length - 1]
      const ago = (at: number) => {
        const sec = Math.max(0, Math.round((now - at) / 1000))
        return sec < 90 ? `há ${sec} s` : `há ${Math.round(sec / 60)} min`
      }
      const lines = [
        `Diagnóstico do Auto Model (versão ${VERSION})`,
        '',
        '1) O que o motor informa agora',
        `- Modelo da conversa: ${shown === undefined ? 'não consegui ler' : `${shownTier === undefined ? shown : MODEL_NAMES[shownTier]} (${shown})`}`,
        `- Esforço da conversa: ${lastSeenEffort === undefined ? 'ainda não informado (aparece depois do primeiro pedido)' : (effortName(lastSeenEffort) ?? String(lastSeenEffort))}`,
        '',
        '2) O que o Auto Model decidiu e aplicou',
        last === undefined
          ? '- Ainda não houve decisão nesta conversa.'
          : `- Última decisão: ${MODEL_NAMES[last.tier]}${last.effort === undefined ? '' : ` · esforço ${effortName(last.effort)}`} · ${last.reason}`,
        applied === null
          ? '- Aplicado no último pedido: nada ainda.'
          : `- Aplicado no último pedido: ${MODEL_NAMES[applied.tier]}${applied.effort === undefined ? '' : ` · esforço ${effortName(applied.effort)}`}`,
        lastSent === undefined
          ? '- Enviado ao motor: nada ainda.'
          : `- Enviado ao motor ${ago(lastSent.at)}: ${lastSent.model}${lastSent.effort === undefined ? '' : ` · esforço ${effortName(lastSent.effort)}`}`,
        '',
        '3) Sincronização do seletor do app',
        `- Sincronizar: ${s.isSyncOn ? 'ligado' : 'desligado'} · comando /effort ${hasEffortCommand ? 'existe' : 'não existe'} nesta versão`,
        queued.length === 0
          ? '- Nenhum comando foi enfileirado ainda.'
          : `- Comandos enfileirados por ele: ${queued.map(q => `/${q.command} ${q.args} (${ago(q.at)})`).join(' · ')}`,
        `- Rótulo do rodapé (modelo·esforço): ${s.isLabelOn ? 'ligado' : 'desligado'} · esforço: ${s.effortMode === 'automatico' ? 'automático' : 'respeitando o seu padrão'}`,
        '',
        '4) Painel',
        lastPaneOpen === undefined
          ? '- O painel ainda não foi aberto nesta sessão.'
          : `- Última abertura ${ago(lastPaneOpen.at)}: ${lastPaneOpen.isPlaced === true ? 'apareceu na tela' : lastPaneOpen.isPlaced === false ? 'não coube na janela' : 'o app não respondeu a tempo'}`,
        '',
        '5) Uso (sessão e semana)',
        `- Medidor: ${s.isUsageOn ? 'ligado' : 'desligado'}`,
        '- Só números medidos: o Auto Model nunca mostra uma porcentagem inventada.',
        usageProbe === undefined
          ? '- Ainda não leu os limites (acontece no início do próximo pedido).'
          : usageProbe.windows.includes('five_hour') && usageProbe.windows.includes('seven_day')
            ? `- Última consulta ${ago(usageProbe.at)}: o app informou ${usageProbe.windows.join(', ')}.`
            : `- Última consulta ${ago(usageProbe.at)}: o app ${usageProbe.windows.length === 0 ? 'não informou nenhum limite' : `informou só ${usageProbe.windows.join(', ')}`}; fica valendo a última leitura medida.`,
        await (async () => {
          const held = (await $.state.get(USAGE)).value ?? null
          if (held === null || held.latest === null) return '- Nenhuma leitura medida guardada ainda.'
          return `- Última leitura medida ${ago(held.latest.at)}: sessão ${fmtPct(held.latest.session)}%, semana ${fmtPct(held.latest.week)}%. Depois de cada resposta o mod lê de novo após 4 s e 12 s, porque o app atualiza os limites com um pouco de atraso.`
        })(),
        '',
        '6) Roteador',
        `- Roteador: ${s.isRouterOn ? 'ligado' : 'desligado'} · espera até ${ROUTER_SEND_MS / 1000} s antes de enviar e ${ROUTER_PREVER_MS / 1000} s no /automodelo prever`,
        routerFailure === undefined
          ? '- Nenhuma falha registrada nesta sessão.'
          : `- Roteador: última falha ${ago(routerFailure.at)} (${routerFailure.where}) · motivo: ${routerFailure.reason}`,
        '',
        'Compare com o seletor do rodapé do app; se ele ainda mostrar outro modelo, o seletor do app não acompanha mods.',
      ]
      return { text: lines.join('\n') }
    }
    if (head === 'exportar' || head === 'export') {
      const now = await $.clock.now()
      const date = dayKey(now)
      const days = (await $.state.get(DAYS)).value ?? {}
      const base = (cwd === '' ? '.' : cwd.replace(/\\/g, '/').replace(/\/+$/, '')) + '/automodelo-relatorios'
      const md = `${base}/automodelo-${date}.md`
      const csv = `${base}/automodelo-${date}.csv`
      const proof = proofOf(days, date, now, s.dailyBaseline)
      await $.fs.write(md, exportMarkdown({ date, proof, samples, days, settings: s, calibration }))
      await $.fs.write(csv, exportCsv(samples, days, s.weekTokens))
      return {
        text: `Relatório salvo:\n${md}\n${csv}\nO .csv abre no Excel. PDF não dá para gerar de dentro de um mod; abra o .md e imprima em PDF se precisar.`,
      }
    }
    if (head === 'zerar' || head === 'reset') {
      await $.state.set(STATS, EMPTY_STATS)
      await $.state.set(DECISIONS, [])
      await $.state.set(DAYS, {})
      await $.store.set(STATS_KEY, EMPTY_STATS)
      await $.store.set(DECISIONS_KEY, [])
      await $.store.set(DAYS_KEY, {})
      return { text: 'Estatísticas do Auto Model zeradas. O que ele aprendeu com você continua.' }
    }

    return { text: `Comando não reconhecido.\n\n${HELP}` }
  }).catch(() => ({ text: 'O Auto Model não conseguiu responder agora. Tente de novo.' }))

  // The choice is made once per prompt, before its turn starts, and holds for
  // the whole turn so the prompt cache is never broken in the middle of one.
  on('prompt.submit', async ($, e, next) => {
    // A pane that did not fit at the start opens on the first request: one the person's prompt is behind is always placed.
    void ensurePane($).catch(() => undefined)
    const s = (await $.state.get(SETTINGS)).value ?? DEFAULT_SETTINGS
    const isOwn = e.origin.kind === 'plugin' && e.origin.name === 'auto-model'
    const isDeciding =
      e.command === undefined && e.isMeta === undefined && e.turnId === undefined && DECIDING_ORIGINS.has(e.origin.kind)
    const force = e.command === undefined ? readForce(e.text) : undefined
    const passOn = force !== undefined && force.text.trim() !== '' ? { ...e, text: force.text } : e

    if (isDeciding) {
      // A new prompt puts the band and the live preview away.
      if (!isOwn) await $.state.set(BAND, null)
      previewKey = ''
      await $.state.set(PREVIEW, null)
    }

    // The mod's own resubmission ("Esse modelo errou") was decided when it was pressed.
    if (isOwn) return next(e)

    // "Não funcionou" on the next prompt marks the turn before as a miss.
    if (isDeciding && force === undefined && lastTier !== undefined && isFrustrated(e.text)) {
      samples = markLast(samples, 'frustracao')
      await $.store.set(SAMPLES_KEY, samples)
      examples = correctLast(examples, capTier(clampTier(lastTier + 1), s), 'subiu')
      await $.store.set(EXAMPLES_KEY, examples)
      const floor = learnNote(lastTier, true)
      await $.store.set(LEARN_KEY, learnMap)
      await $.state.set(AUTOFLOOR, floor)
    }

    // A model picked in the band for this one prompt.
    const picked = isDeciding && force === undefined ? ((await $.state.get(NEXT)).value ?? null) : null
    if (picked !== null) await $.state.set(NEXT, null)

    if (!isDeciding || (!s.isOn && force === undefined && picked === null)) return next(passOn)

    const now = await $.clock.now()
    const hasAttachments = (e.attachments?.length ?? 0) > 0
    const isCacheWarm = lastEndAt !== undefined && now - lastEndAt < CACHE_TTL_MS
    const thresholds = thresholdsFor(s)
    const base = {
      text: picked !== null ? `!${MODEL_NAMES[picked].toLowerCase()} ${e.text}` : e.text,
      hasAttachments,
      settings: s,
      bias: mergeBias(bias, calibration?.groupShift),
      previous: lastTier,
      ctx: lastCtx,
      isCacheWarm,
      at: now,
      thresholds,
    }
    // A send cancels any reading of the draft still waiting.
    draftTimer?.cancel()
    draftTimer = undefined
    draftKey = ''

    const att = attachmentsOf(e.text, e.attachments)
    if (force !== undefined) {
      const made = decide(base)
      const guessed = tierOfScore(scorePrompt(force.text, { hasAttachments }, bias).score, s, thresholds)
      bias = learn(bias, made.groups, force.tier, guessed)
      await $.store.set(BIAS_KEY, bias)
      // What the person chose by hand is what was right for this request.
      if (force.text.trim() !== '' && picked === null) {
        examples = pushExample(examples, {
          key: keyOf(force.text),
          text: force.text.slice(0, 300),
          resumo: '',
          tier: force.tier,
          outcome: 'forçado',
          at: now,
        })
        await $.store.set(EXAMPLES_KEY, examples)
      }
    }

    const days = (await $.state.get(DAYS)).value ?? {}
    const today = dayKey(now)
    const ratio = budgetRatio(s, monthOf(days, today))
    if (ratio !== undefined && ratio >= 0.8 && budgetWarned !== today.slice(0, 7)) {
      budgetWarned = today.slice(0, 7)
      await $.store.set(WARNED_KEY, budgetWarned)
      $.ui.toast(ratio >= 1 ? 'Orçamento do Opus esgotado neste mês' : 'Orçamento do Opus em 80%')
    }

    // Same call and limit as before; 0.8.0 only keeps why it failed, for /automodelo diagnostico.
    const ask: Ask = async (prompt, ms) => {
      const call = $.model
        .complete({ model: 'haiku', prompt, effort: 'low', maxTokens: 220, timeoutMs: ms })
        .then(r => {
          if (r !== undefined && r !== null && r.isAnswered) return r
          noteRouterFail(now, 'envio', failText(r))
          return undefined
        })
        .catch(() => {
          noteRouterFail(now, 'envio', 'a chamada ao modelo falhou')
          return undefined
        })
      const res = await Promise.race([call, $.clock.sleep(ms).then(() => 'timeout' as const)])
      if (res === 'timeout') {
        noteRouterFail(now, 'envio', `tempo esgotado (${Math.round(ms / 1000)} s)`)
        return undefined
      }
      if (res === undefined) return undefined
      const route = parseRoute(res.text)
      if (route === undefined) noteRouterFail(now, 'envio', 'resposta fora do formato esperado')

      return route === undefined ? undefined : { route, usage: res.usage }
    }
    const classify = async (text: string): Promise<AutoModelTier | undefined> => {
      const answer = await Promise.race([
        $.model.classify(text.slice(0, 4000), CLASS_LABELS, { model: 'haiku' }),
        $.clock.sleep(CLASSIFY_MS).then(() => undefined),
      ])

      return tierOfLabel(answer)
    }
    const full = await decideFull(
      { typed: base.text, text: passOn.text, att, s, now, days, picked, ratio, ms: ROUTER_SEND_MS, useRouter: true },
      { ask, classify, applied: (await $.state.get(APPLIED)).value ?? null },
    )
    if (full.got !== undefined) {
      const held = (await $.state.get(STATS)).value ?? EMPTY_STATS
      const stats = addRouterUse({ ...EMPTY_STATS, ...held }, full.got.usage, s.prices)
      await $.state.set(STATS, stats)
      await $.store.set(STATS_KEY, stats)
      if (!full.got.isCached) await $.store.set(ROUTER_CACHE_KEY, routeCache)
    }
    const kept = full.kept
    const groups = full.groups
    const pick = full.pick
    const step = full.step
    // What the preview promised and what the send decided: when they differ, the band says why.
    const shownBefore = previewShown
    previewShown = undefined
    draftShot = undefined
    const isDifferent =
      shownBefore !== undefined &&
      (shownBefore.tier !== kept.tier || (shownBefore.effort !== undefined && typeof pick === 'string' && shownBefore.effort !== pick))
    const changed =
      isDifferent && shownBefore !== undefined && picked === null && force === undefined
        ? `mudou de ${MODEL_NAMES[shownBefore.tier]}${shownBefore.effort === undefined ? '' : ` ${effortName(shownBefore.effort)}`} para ${MODEL_NAMES[kept.tier]}${typeof pick === 'string' ? ` ${effortName(pick)}` : ''}: ${kept.reason}`
        : undefined
    // 0.8.0: which similar requests this one is compared with, and how long they took.
    const bucket = bucketOf(kept.tier, typeof pick === 'string' ? pick : undefined, full.score, hasAny(att), passOn.text.length > LONG_TEXT)
    const timeRange = rangeOf(durations, bucket, 'ms')
    pending = {
      ...kept,
      text: passOn.text,
      groups,
      key: routeKeyOf(passOn.text, att),
      bucket,
      ...(timeRange === undefined ? {} : { estimate: { lo: timeRange.lo, hi: timeRange.hi } }),
      ...(changed === undefined ? {} : { changed }),
      ...(pick === undefined ? {} : { effortPick: pick }),
      ...(step === undefined ? {} : { effortStep: step }),
    }
    await $.state.set(APPLIED, { tier: kept.tier, ...(typeof pick === 'string' ? { effort: pick } : {}) })
    const list = [...((await $.state.get(DECISIONS)).value ?? []), kept].slice(-10)
    await $.state.set(DECISIONS, list)
    await $.store.set(DECISIONS_KEY, list)

    const result = await next(passOn)
    if (result.drop !== undefined) pending = undefined

    return result
  }).catch(($, e, next) => next(e))

  // Live preview: the draft is read once the person pauses, through decideFull, the very function
  // the send uses, so what it shows is what runs. Attachments the composer writes into the draft
  // ("[Image #1]", "[Pasted text #2 +40 lines]") count; a long draft is read as a digest that keeps
  // every request wherever it sits; a big paste is read at once; a model picked in the band freezes it.
  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    const s = (await $.state.get(SETTINGS)).value ?? DEFAULT_SETTINGS
    const text = box.text.trim()
    const att = attachmentsOf(text)

    const show = async (preview: AutoModelPreview | null) => {
      const key =
        preview === null
          ? ''
          : `${preview.tier}:${preview.effort ?? ''}:${preview.reason}:${preview.confidence ?? ''}:${preview.isAnalyzing === true ? 1 : 0}:${preview.isFallback === true ? 1 : 0}:${preview.extra ?? ''}:${preview.warn ?? ''}`
      if (key === previewKey) return
      previewKey = key
      previewShown = preview === null || preview.isAnalyzing === true ? undefined : { tier: preview.tier, ...(preview.effort === undefined ? {} : { effort: preview.effort }) }
      await $.state.set(PREVIEW, preview)
    }
    const stopReading = () => {
      draftTimer?.cancel()
      draftTimer = undefined
      draftKey = ''
    }

    if (!s.isOn || (text === '' && !hasAny(att)) || text.startsWith('/')) {
      stopReading()
      draftShot = undefined
      // An emptied draft lets go of a model picked for it.
      if (text === '' && ((await $.state.get(NEXT)).value ?? null) !== null) await $.state.set(NEXT, null)
      await show(null)
      return box
    }
    // A model picked in the band: the preview stops reading this draft until it is sent or emptied.
    if (((await $.state.get(NEXT)).value ?? null) !== null) {
      stopReading()
      return box
    }
    const force = readForce(text)
    if (force !== undefined) {
      stopReading()
      await show({ tier: force.tier, reason: 'forçado pelo prefixo', confidence: 1 })
      return box
    }

    const shot: DraftShot = { text, sig: attachmentSig(att) }
    const shown = (await $.state.get(PREVIEW)).value ?? null
    // A change that cannot move the decision keeps the reading on screen.
    if (shown !== null && shown.isAnalyzing !== true && !isMeaningfulChange(draftShot, shot)) return box

    const now = await $.clock.now()
    const useRouter = s.isRouterOn && (text.length >= MIN_DRAFT || hasAny(att))
    const key = routeKeyOf(text, att)
    const isHit = useRouter && cacheGet(routeCache, key, contextSig(key, lastTier, isBuilding), now) !== undefined
    const isBigPaste = e.inputText.length >= BIG_PASTE
    draftKey = key
    draftShot = shot
    if (!isHit && useRouter) await show({ tier: shown?.tier ?? lastTier ?? 1, reason: '', isAnalyzing: true })
    draftTimer?.cancel()
    draftTimer = undefined
    {
      const read = async () => {
        if (draftKey !== key) return
        const at = await $.clock.now()
        const ask: Ask = async (prompt, ms) => {
          const call = $.model
            .complete({ model: 'haiku', prompt, effort: 'low', maxTokens: 220, timeoutMs: ms })
            .then(r => (r !== undefined && r !== null && r.isAnswered ? r : undefined))
            .catch(() => undefined)
          const res = await Promise.race([call, $.clock.sleep(ms).then(() => undefined)])
          if (res === undefined) return undefined
          const route = parseRoute(res.text)

          return route === undefined ? undefined : { route, usage: res.usage }
        }
        // A draft too short for the router is guessed by the free rules alone: no model call per keystroke.
        const classify = async (t: string): Promise<AutoModelTier | undefined> => {
          if (!useRouter) return undefined
          const answer = await Promise.race([
            $.model.classify(t.slice(0, 4000), CLASS_LABELS, { model: 'haiku' }),
            $.clock.sleep(CLASSIFY_MS).then(() => undefined),
          ])

          return tierOfLabel(answer)
        }
        const days = (await $.state.get(DAYS)).value ?? {}
        const full = await decideFull(
          {
            typed: text,
            text,
            att,
            s,
            now: at,
            days,
            picked: null,
            ratio: budgetRatio(s, monthOf(days, dayKey(at))),
            ms: ROUTER_PREVIEW_MS,
            useRouter,
          },
          { ask, classify, applied: (await $.state.get(APPLIED)).value ?? null },
        ).catch(() => undefined)
        if (full?.got !== undefined && !full.got.isCached) {
          const held = (await $.state.get(STATS)).value ?? EMPTY_STATS
          const stats = addRouterUse({ ...EMPTY_STATS, ...held }, full.got.usage, s.prices)
          await $.state.set(STATS, stats)
          await $.store.set(STATS_KEY, stats)
          await $.store.set(ROUTER_CACHE_KEY, routeCache)
        }
        // The person kept typing: a newer reading is on its way.
        if (draftKey !== key) return
        draftTimer = undefined
        if (full === undefined) {
          await show({ tier: shown?.tier ?? lastTier ?? 1, reason: 'não foi possível ler agora', isFallback: true })
          return
        }
        const d = full.kept
        const isRules = useRouter && full.routerFailed
        // 0.8.0: the time and session share similar requests took, and a warning before a window passes 90%.
        const latest = (await $.state.get(USAGE)).value?.latest ?? null
        const forecast = forecastOf(
          durations,
          ratios,
          bucketOf(d.tier, typeof full.pick === 'string' ? full.pick : undefined, full.score, hasAny(att), text.length > LONG_TEXT),
          latest,
          at,
        )
        const extra = previewExtra(forecast)
        const warn = previewWarning(forecast)
        await show({
          tier: d.tier,
          reason: isRules ? `${d.reason} (regras: o roteador não respondeu)` : !useRouter && d.layer === 'regras' ? `${d.reason}, provável` : d.reason,
          confidence: d.confidence,
          ...(typeof full.pick === 'string' ? { effort: full.pick } : {}),
          ...(isRules ? { isFallback: true } : {}),
          ...(extra === undefined ? {} : { extra }),
          ...(warn === undefined ? {} : { warn, warnTone: warningTone(forecast) }),
        })
      }
      // A cache hit costs nothing and shows at once; a big paste or a draft the rules judge is read
      // now without holding the keystroke; anything else waits for the pause.
      if (isHit) {
        await read().catch(() => undefined)
      } else if (isBigPaste || !useRouter) {
        void read().catch(() => undefined)
      } else {
        draftTimer = $.clock.after(PREVIEW_DEBOUNCE_MS, () => {
          void read().catch(() => undefined)
        })
      }
    }

    return box
  }).catch(($, e, next) => next(e))

  on('prompt.change', async ($, e, next) => {
    if (e.text.trim() === '') {
      draftTimer?.cancel()
      draftTimer = undefined
      draftKey = ''
      if (previewKey !== '') {
        previewKey = ''
        await $.state.set(PREVIEW, null)
      }
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      // The usage meter takes the windows as this request starts: the "before" of what it moves.
      // Re-reads still pending from the last answer are dropped, so nothing is counted twice.
      for (const t of usageTimers) t.cancel()
      usageTimers = []
      try {
        const live = await $.session.usage()
        const at = await $.clock.now()
        usageProbe = { windows: live.rateLimits.map(w => String(w.kind)), at }
        const settings = (await $.state.get(SETTINGS)).value ?? DEFAULT_SETTINGS
        let meter = (await $.state.get(USAGE)).value ?? EMPTY_METER_V7
        const m = measuredOf(live.rateLimits, at)
        if (m !== null && !sameReading(meter.latest, m)) {
          const took = takeReading(meter, m, settings.isUsageOn)
          meter = took.meter
          for (const t of took.toasts) $.ui.toast(t)
        }
        await $.state.set(USAGE, { ...meter, start: meter.latest })
      } catch {
        // Without the meter the answer is still right; it just has no usage line.
      }
      const base = { turnId: e.turnId, isSlipped: false, slip: EMPTY_SLIP, startedAt: await $.clock.now() }
      if (pending !== undefined) {
        current = {
          ...base,
          tier: pending.tier,
          isEscalated: pending.layer === 'escalada',
          isForced: pending.layer === 'forçado' || pending.layer === 'correção',
          text: pending.text,
          groups: pending.groups,
          layer: pending.layer,
          score: pending.score,
          why: friendlyWhy(pending),
          decision: pending,
          ...(pending.effortPick === undefined ? {} : { effortPick: pending.effortPick }),
          ...(pending.effortStep === undefined ? {} : { effortStep: pending.effortStep }),
          ...(pending.key === undefined ? {} : { key: pending.key }),
          ...(pending.summary === undefined ? {} : { summary: pending.summary }),
          ...(pending.changed === undefined ? {} : { changed: pending.changed }),
          ...(pending.bucket === undefined ? {} : { bucket: pending.bucket }),
          ...(pending.estimate === undefined ? {} : { estimate: pending.estimate }),
        }
      } else if (lastTier !== undefined) {
        // A turn nobody typed (a notification, a continuation) keeps the model.
        current = { ...base, tier: lastTier, isEscalated: false, isForced: false, text: '', groups: [], layer: 'continuação', score: 0 }
      } else {
        current = undefined
      }
      pending = undefined
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined && current !== undefined && ran.deny === undefined) {
      current.slip = noteCall(current.slip, e as unknown as Record<string, unknown>, ran.isError === true)
    }

    return ran
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined || current === undefined || current.turnId !== e.turnId) {
      return yield* next(e)
    }
    const s = (await $.state.get(SETTINGS)).value ?? DEFAULT_SETTINGS
    if (!s.isOn && !current.isForced) {
      return yield* next(e)
    }

    // A cheaper model going round in circles moves up one, for the rest of the turn.
    const slipping = slipReason(current.slip)
    if (slipping !== undefined && !current.isSlipped && !current.isForced) {
      const up = capTier(clampTier(current.tier + 1), s)
      current.isSlipped = true
      if (up > current.tier) {
        const from = current.tier
        current.tier = up
        current.isEscalated = true
        current.effortPick = undefined
        current.decision = undefined
        const note: AutoModelDecision = {
          tier: up,
          reason: `${slipping}, subindo`,
          layer: 'escalada',
          score: 0,
          confidence: 1,
          ctx: lastCtx,
          at: await $.clock.now(),
          detail: [`${MODEL_NAMES[from]} estava patinando (${slipping}): ${MODEL_NAMES[from]} -> ${MODEL_NAMES[up]}`],
        }
        const list = [...((await $.state.get(DECISIONS)).value ?? []), note].slice(-10)
        await $.state.set(DECISIONS, list)
      }
    }

    // The session's effort is the person's own unless it is the one the mod
    // last wrote to the picker: lowering always starts from their setting.
    if (e.effort !== syncedEffort || baseEffort === undefined) baseEffort = e.effort
    current.sessionEffort = e.effort
    lastSeenEffort = e.effort

    const model = MODEL_IDS[current.tier]
    let effort: Effort | number | string | undefined =
      e.effort === undefined ? undefined : (current.effortPick ?? settleEffort(s, current.tier, current.effortStep ?? 1))
    // Asked to respect the person's effort, the first turn only learns it here, so the ceiling is held here too.
    if (s.effortMode === 'respeitar' && typeof baseEffort === 'string' && typeof effort === 'string') {
      const cap = EFFORT_LADDER.indexOf(baseEffort)
      if (cap >= 0 && EFFORT_LADDER.indexOf(effort as Effort) > cap) effort = baseEffort
    }
    current.effort = effort as Effort | number | undefined
    lastSent = { model, ...(effort === undefined ? {} : { effort }), at: await $.clock.now() }

    // What is really sent shows in the footer label, and the status line says the same.
    const appliedKey = `${current.tier}:${effort ?? ''}`
    if (appliedKey !== lastAppliedKey) {
      lastAppliedKey = appliedKey
      await $.state.set(APPLIED, { tier: current.tier, ...(typeof effort === 'string' ? { effort } : {}) })
      const shownDecision = current.decision
      if (shownDecision !== undefined && shownDecision.tier === current.tier && shownDecision.effort !== effort) {
        const { effort: _old, ...bare } = shownDecision
      }
    }
    const asked = effort === undefined ? { ...e, model } : { ...e, model, effort }
    const result = yield* next(asked)
    if (result.usage !== null) lastCtx = contextOf(result.usage)

    return result
  }).catch(async function* ($, e, next) {
    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    const turn = current
    current = undefined
    if (turn === undefined || turn.turnId !== e.turnId) return result
    // 0.8.0: how long the answer took (the engine's own wall clock; the mod's clock when it gives none).
    let took = 0
    try {
      const prevTier = lastTier
      lastTier = turn.tier
      const now = await $.clock.now()
      lastEndAt = now
      turnsDone += 1
      if (turn.text.trim() !== '') {
        lastResumo = turn.summary ?? turn.text.trim().split(/\s+/).slice(0, 6).join(' ')
        isBuilding = Object.keys(turn.slip.edits).length > 0
        buildStreak = isBuilding || (turn.summary !== undefined && /constr|cri|desenvolv|implement/i.test(turn.summary)) ? buildStreak + 1 : 0
        lastKeyTokens = keyOf(turn.text).split(' ').filter(Boolean)
      }
      if (prevTier !== undefined && prevTier !== turn.tier && e.reason !== 'aborted') {
        const days = bumpDay((await $.state.get(DAYS)).value ?? {}, dayKey(now), 'switches')
        await $.state.set(DAYS, days)
        await $.store.set(DAYS_KEY, days)
      }
      const s = (await $.state.get(SETTINGS)).value ?? DEFAULT_SETTINGS
      if (e.usage !== undefined) {
        const usage: Usage = e.usage
        const held = await $.state.get(STATS)
        const stats = addTurn(held.value ?? EMPTY_STATS, turn.tier, usage, s.prices, turn.isEscalated)
        await $.state.set(STATS, stats)
        await $.store.set(STATS_KEY, stats)
        const days = addDay((await $.state.get(DAYS)).value ?? {}, dayKey(now), turn.tier, weighted(usage), s.prices)
        await $.state.set(DAYS, days)
        await $.store.set(DAYS_KEY, days)
      }
      // 0.8.0: the time and tokens of this answer feed the next estimates; the estimate made for it is scored.
      took = typeof e.durationMs === 'number' && e.durationMs > 0 ? e.durationMs : turn.startedAt === undefined ? 0 : Math.max(0, now - turn.startedAt)
      if (e.reason === 'answer' && took > 0 && turn.bucket !== undefined) {
        durations = pushDuration(durations, { b: turn.bucket, ms: took, units: e.usage === undefined ? 0 : weighted(e.usage), at: now })
        await $.store.set(DURATIONS_KEY, durations)
        if (turn.estimate !== undefined) {
          timeCal = noteTime(timeCal, { ...turn.estimate, n: 0 }, took)
          await $.store.set(TIMECAL_KEY, timeCal)
        }
      }
      if (e.reason === 'answer' && LEARNING_LAYERS.has(turn.layer)) {
        samples = pushSample(samples, {
          id: turn.turnId,
          at: now,
          tier: turn.tier,
          score: turn.score,
          groups: turn.groups,
          outcome: turn.isSlipped ? 'escalado' : 'ok',
          ...(typeof turn.effort === 'string' ? { effort: turn.effort } : {}),
        })
        await $.store.set(SAMPLES_KEY, samples)
        const floor = learnNote(turn.tier, turn.isSlipped)
        await $.store.set(LEARN_KEY, learnMap)
        await $.state.set(AUTOFLOOR, floor)
        if (turn.key !== undefined && turn.key !== '') {
          examples = pushExample(examples, {
            key: turn.key,
            text: turn.text.slice(0, 300),
            resumo: turn.summary ?? '',
            tier: turn.tier,
            outcome: turn.isSlipped ? 'subiu' : 'ok',
            at: now,
          })
          await $.store.set(EXAMPLES_KEY, examples)
        }
        const cal = calibrate(samples, calibration)
        if (cal !== undefined) {
          calibration = cal
          await $.store.set(CALIBRATION_KEY, cal)
        }
      }
    } catch {
      // Stats that could not be saved are skipped; the turn itself is fine.
    }

    try {
      const s = (await $.state.get(SETTINGS)).value ?? DEFAULT_SETTINGS
      const isAnswered = e.reason === 'answer'

      // The usage meter, measured readings only. The app updates its limits a little after the
      // answer, so the windows are read now and again after a few seconds; the band follows.
      let bandUsage: AutoModelBandMeasured | undefined
      usageTier = turn.tier
      try {
        const live = await $.session.usage()
        const at = await $.clock.now()
        usageProbe = { windows: live.rateLimits.map(w => String(w.kind)), at }
        let meter = (await $.state.get(USAGE)).value ?? EMPTY_METER_V7
        const m = measuredOf(live.rateLimits, at)
        if (m !== null && !sameReading(meter.latest, m)) {
          const took = takeReading(meter, m, s.isUsageOn)
          meter = took.meter
          for (const t of took.toasts) $.ui.toast(t)
        } else {
          meter = { ...meter, last: bandOf(meter, at) }
        }
        await $.state.set(USAGE, meter)
        await $.store.set(USAGE_KEY, persistMeter(meter))
        bandUsage = meter.last ?? undefined
        // 0.8.0: how much this answer moved each window, measured, against its tokens: the
        // ratio prever uses to turn a token estimate into percent. Re-reads below refine it.
        if (e.reason === 'answer' && e.usage !== undefined && meter.start !== null) {
          ratioPending = { id: turn.turnId, units: weighted(e.usage), from: { session: meter.start.session, week: meter.start.week } }
          if (meter.latest !== null) {
            ratios = upsertRatio(ratios, {
              id: ratioPending.id,
              units: ratioPending.units,
              ds: meter.latest.session - ratioPending.from.session,
              dw: meter.latest.week - ratioPending.from.week,
            })
            await $.store.set(RATIOS_KEY, ratios)
          }
        } else {
          ratioPending = undefined
        }
      } catch {
        // The meter is a convenience; the answer and its band go on without it.
      }
      const reread = async () => {
        const live = await $.session.usage()
        const at = await $.clock.now()
        const m = measuredOf(live.rateLimits, at)
        usageProbe = { windows: live.rateLimits.map(w => String(w.kind)), at }
        if (m === null) return
        const held = (await $.state.get(USAGE)).value ?? EMPTY_METER_V7
        if (sameReading(held.latest, m)) return
        const settings = (await $.state.get(SETTINGS)).value ?? DEFAULT_SETTINGS
        const took = takeReading(held, m, settings.isUsageOn)
        await $.state.set(USAGE, took.meter)
        await $.store.set(USAGE_KEY, persistMeter(took.meter))
        for (const t of took.toasts) $.ui.toast(t)
        const band = (await $.state.get(BAND)).value ?? null
        if (band !== null && took.meter.last !== null) await $.state.set(BAND, { ...band, usage: took.meter.last })
        if (ratioPending !== undefined && ratioPending.id === turn.turnId) {
          ratios = upsertRatio(ratios, {
            id: ratioPending.id,
            units: ratioPending.units,
            ds: m.session - ratioPending.from.session,
            dw: m.week - ratioPending.from.week,
          })
          await $.store.set(RATIOS_KEY, ratios)
        }
      }
      for (const t of usageTimers) t.cancel()
      usageTimers = USAGE_REREAD_MS.map(ms =>
        $.clock.after(ms, () => {
          void reread().catch(() => undefined)
        }),
      )

      // Offer "Esse modelo errou" under a turn the mod chose by itself.
      if (isAnswered && s.isOn && !turn.isForced && turn.text.trim() !== '') {
        const band: AutoModelBand = {
          tier: turn.tier,
          text: turn.text,
          groups: turn.groups,
          ...(turn.why === undefined ? {} : { why: turn.why }),
          ...(turn.effortStep === undefined ? {} : { step: turn.effortStep }),
          ...(typeof turn.effort === 'string' ? { effort: turn.effort } : {}),
          ...(bandUsage === undefined ? {} : { usage: bandUsage }),
          ...(turn.changed === undefined ? {} : { changed: turn.changed }),
          ...(took > 0 ? { took } : {}),
          ...(turn.estimate === undefined ? {} : { estimate: turn.estimate }),
        }
        await $.state.set(BAND, band)
      }

      // The footer label keeps saying what the last turn really ran with.
      if (e.reason !== 'aborted') {
        const key = `${turn.tier}:${typeof turn.effort === 'string' ? turn.effort : ''}`
        if (key !== lastAppliedKey) {
          lastAppliedKey = key
          await $.state.set(APPLIED, { tier: turn.tier, ...(typeof turn.effort === 'string' ? { effort: turn.effort } : {}) })
        }
      }

      // Make the picker show what really ran. /model and /effort run only once
      // the session is idle, so they are queued from a timer, outside this hook.
      if (e.reason !== 'aborted' && s.isOn && s.isSyncOn) {
        const shown = await $.session.model()
        const isModelOff = tierOfModel(shown) !== turn.tier
        const wanted = turn.effort
        const isEffortOff = hasEffortCommand && typeof wanted === 'string' && wanted !== turn.sessionEffort
        if (isModelOff || isEffortOff) {
          const model = MODEL_IDS[turn.tier]
          const at = await $.clock.now()
          const note = (command: string, args: string) => {
            ownCommands.set(`${command} ${args}`, at)
            queued.push({ command, args, at })
            while (queued.length > 6) queued.shift()
          }
          if (isModelOff) note('model', model)
          if (isEffortOff && typeof wanted === 'string') note('effort', wanted)
          $.clock.after(0, () => {
            if (isModelOff) {
              void $.command.run({ command: 'model', args: model }).catch(() => undefined)
            }
            if (isEffortOff && typeof wanted === 'string') {
              syncedEffort = wanted
              void $.command.run({ command: 'effort', args: wanted }).catch(() => undefined)
            }
          })
        }
      }
    } catch {
      // The band and the picker are conveniences; the turn itself is fine.
    }

    return result
  })

  // The footer says what the last request really ran with, true even when the app's own picker lags.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    const s = (await $.state.get(SETTINGS)).value ?? DEFAULT_SETTINGS
    if (!s.isOn) return next(e)
    const applied = s.isLabelOn ? ((await $.state.get(APPLIED)).value ?? null) : null
    const latest = s.isUsageOn && s.isUsageFooterOn ? ((await $.state.get(USAGE)).value?.latest ?? null) : null
    if (applied === null && latest === null) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const isTerm = e.surface === 'terminal'
    const others = e.props.modes
    const toggle = () => void togglePane($).catch(() => undefined)
    const worst = latest === null ? undefined : worstWindow(readingOf(latest))
    const usageText =
      worst === undefined
        ? undefined
        : isTerm
          ? `${worst.name} ${fmtPct(worst.pct)}% ${signOf(worst.pct, true)}`
          : `${signOf(worst.pct, false)} ${worst.name} ${fmtPct(worst.pct)}%`
    if (applied === null) {
      return (
        <Box flexDirection="row">
          {others.length > 0 && <Text dimColor>{`${others.join(' & ')} & `}</Text>}
          <Button key="auto-model-rodape" plain onPress={toggle}>
            <Text color={USAGE_TONE[toneOf(worst?.pct ?? 0)]}>{usageText ?? ''}</Text>
          </Button>
        </Box>
      )
    }
    const label = shortLabel(MODEL_NAMES[applied.tier], effortName(applied.effort))

    return (
      <Box flexDirection="row">
        {others.length > 0 && <Text dimColor>{`${others.join(' & ')} & `}</Text>}
        <Button key="auto-model-rodape" plain onPress={toggle}>
          <Text color={modelColor(applied.tier)} weight="semibold">
            {label}
          </Text>
          {usageText !== undefined && worst !== undefined && <Text color={USAGE_TONE[toneOf(worst.pct)]}>{` ${usageText}`}</Text>}
        </Button>
      </Box>
    )
  }).catch(($, e, next) => next(e))

  // The built-in /model and /effort answer in English. The ones the mod ran itself draw nothing
  // (the footer and the band already say it); the person's own are translated.
  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    const command = e.props.command
    if ((command !== 'model' && command !== 'effort') || e.props.isErrored) return next(e)
    const now = await $.clock.now()
    const at = ownCommands.get(`${command} ${e.props.args.trim()}`)
    const byMod = at !== undefined && now - at < OWN_COMMAND_MS
    if (byMod) {
      const { Box } = $.ui.resolve(e)

      return <Box />
    }
    const text = translateCommandOutput(command, e.props.text, false)
    if (text === undefined) return next(e)

    return next({ ...e, props: { ...e.props, text } })
  }).catch(($, e, next) => next(e))

  // 0.8.0: the prever answer drawn as a tree, so the dot on the decision line takes the model's colour.
  on('ui.render', { component: 'CommandOutput', props: { command: 'automodelo' } }, async ($, e, next) => {
    const args = e.props.args.trim().toLowerCase()
    if (e.props.isErrored || !(args.startsWith('prever') || args.startsWith('preview'))) return next(e)
    const lines = e.props.text.replace(/^auto-model:\s*/, '').split('\n')
    if (!(lines[0] ?? '').startsWith('Previsão do Auto Model')) return next(e)
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        {lines.map((text, i) => {
          if (text.startsWith('● ')) {
            const rest = text.slice(2)
            const tier = MODEL_NAMES.findIndex(name => rest.startsWith(name))
            return (
              <Box key={`l${i}`} flexDirection="row">
                <Text color={tier < 0 ? MUTED : modelColor(tier as AutoModelTier)}>●</Text>
                <Text weight="semibold">{` ${rest}`}</Text>
              </Box>
            )
          }
          return (
            <Text key={`l${i}`} color={i === 0 ? MUTED : undefined}>
              {text === '' ? ' ' : text}
            </Text>
          )
        })}
      </Box>
    )
  }).catch(($, e, next) => next(e))

  // The line echoing a /model or /effort the mod ran itself is noise too: it draws nothing.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.props.isExpanded) return next(e)
    const m = /^\/(model|effort)\s+(\S+)\s*$/.exec(e.props.text.trim())
    if (m === null) return next(e)
    const origin = e.props.origin
    const now = await $.clock.now()
    const at = ownCommands.get(`${m[1]} ${m[2]}`)
    const byMod = (origin.kind === 'plugin' && origin.name === 'auto-model') || (at !== undefined && now - at < OWN_COMMAND_MS)
    if (!byMod) return next(e)
    const { Box } = $.ui.resolve(e)

    return <Box />
  }).catch(($, e, next) => next(e))

  // The app pushes a reading when a window moves a whole point: the band and the pane follow it.
  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    if (!e.changed.includes('rateLimits')) return result
    const at = await $.clock.now()
    const m = measuredOf(e.rateLimits, at)
    usageProbe = { windows: e.rateLimits.map(w => String(w.kind)), at }
    if (m === null) return result
    const held = (await $.state.get(USAGE)).value ?? EMPTY_METER_V7
    if (sameReading(held.latest, m)) return result
    const settings = (await $.state.get(SETTINGS)).value ?? DEFAULT_SETTINGS
    const took = takeReading(held, m, settings.isUsageOn)
    await $.state.set(USAGE, took.meter)
    await $.store.set(USAGE_KEY, persistMeter(took.meter))
    for (const t of took.toasts) $.ui.toast(t)
    const band = (await $.state.get(BAND)).value ?? null
    if (band !== null && took.meter.last !== null) await $.state.set(BAND, { ...band, usage: took.meter.last })

    return result
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.props.isWorking || e.props.view.agentId !== undefined) return next(e)
    const s = (await $.state.get(SETTINGS)).value ?? DEFAULT_SETTINGS
    const band = (await $.state.get(BAND)).value ?? null
    const preview = (await $.state.get(PREVIEW)).value ?? null
    const picked = (await $.state.get(NEXT)).value ?? null
    if (!s.isOn || (band === null && preview === null && picked === null)) return next(e)
    const isPaneUp = (await $.state.get(PANE_UP)).value ?? false
    const { Box, Button, Text } = $.ui.resolve(e)

    // The choice for the next prompt: automatic, or one model picked here.
    const cycle = async () => {
      const held = (await $.state.get(NEXT)).value ?? null
      const settings = (await $.state.get(SETTINGS)).value ?? DEFAULT_SETTINGS
      const top = capTier(3, settings)
      const after: AutoModelTier | null = held === null ? 0 : held >= Math.min(2, top) ? null : clampTier(held + 1)
      await $.state.set(NEXT, after)
    }

    if (preview !== null || picked !== null) {
      const shownTier = picked !== null ? picked : preview === null ? 1 : preview.tier
      const line =
        picked !== null
          ? `Próximo pedido → ${MODEL_NAMES[picked]} (escolhido por você)`
          : preview === null
            ? ''
            : preview.isAnalyzing === true
              ? 'Próximo pedido · analisando…'
              : `Próximo pedido → ${MODEL_NAMES[preview.tier]}${preview.effort === undefined ? '' : ` · esforço ${effortName(preview.effort)}`}${preview.reason !== '' ? ` · ${preview.reason}` : ''}${preview.confidence === undefined ? '' : ` · ${fmtPercent(preview.confidence)}`}`
      const nextLabel = picked !== null && picked >= Math.min(2, capTier(3, s)) ? 'Voltar ao automático' : 'Trocar modelo'
      // 0.8.0: the estimates and the 90% warning ride on the preview line, when there is history for them.
      const isReading = picked === null && preview !== null && preview.isAnalyzing !== true
      const extra = isReading && s.isPreviewExtraOn !== false && preview?.extra !== undefined ? ` · ${preview.extra}` : ''
      const warn = isReading && preview?.warn !== undefined ? preview.warn : undefined

      return (
        <Box flexDirection="row" gap={1}>
          <Text color={picked !== null || preview?.isAnalyzing !== true ? modelColor(shownTier) : MUTED} wrap="truncate-end">
            {`${line}${extra}`}
          </Text>
          {warn !== undefined && (
            <Text color={preview?.warnTone === 'bad' ? C.bad : C.warn} wrap="truncate-end">
              {`· ${warn}`}
            </Text>
          )}
          <Button key="auto-model-escolher" label={nextLabel} onPress={cycle} />
        </Box>
      )
    }

    if (band === null) return next(e)
    const up = capTier(clampTier(band.tier + 1), s)
    const canGoUp = up > band.tier

    const wrong = async () => {
      const held = (await $.state.get(BAND)).value ?? null
      if (held === null) return
      await $.state.set(BAND, null)
      const settings = (await $.state.get(SETTINGS)).value ?? DEFAULT_SETTINGS
      const higher = capTier(clampTier(held.tier + 1), settings)
      if (higher <= held.tier) {
        $.ui.toast(`O ${MODEL_NAMES[held.tier]} já é o mais alto permitido. Mude o teto com /automodelo config teto.`)
        return
      }
      bias = learn(bias, held.groups, higher, held.tier)
      await $.store.set(BIAS_KEY, bias)
      samples = markLast(samples, 'errou')
      await $.store.set(SAMPLES_KEY, samples)
      const miss = learnNote(held.tier, true)
      await $.store.set(LEARN_KEY, learnMap)
      await $.state.set(AUTOFLOOR, miss)
      const countedDays = bumpDay((await $.state.get(DAYS)).value ?? {}, dayKey(await $.clock.now()), 'errou')
      await $.state.set(DAYS, countedDays)
      await $.store.set(DAYS_KEY, countedDays)
      examples = correctLast(examples, higher, 'errou')
      await $.store.set(EXAMPLES_KEY, examples)
      const effort = settleEffort(settings, higher, held.step ?? 1)
      const made: AutoModelDecision = {
        tier: higher,
        reason: 'correção, um nível acima',
        layer: 'correção',
        score: 0,
        confidence: 1,
        ctx: lastCtx,
        at: await $.clock.now(),
        detail: [`você marcou que o ${MODEL_NAMES[held.tier]} errou: refeito no ${MODEL_NAMES[higher]}`],
        effort,
        effortWhy: 'o mesmo esforço do pedido, agora num modelo acima',
      }
      // Held for the resubmitted prompt's turn, which starts once the session is idle.
      pending = { ...made, text: held.text, groups: held.groups, effortPick: effort, effortStep: held.step ?? 1 }
      const list = [...((await $.state.get(DECISIONS)).value ?? []), made].slice(-10)
      await $.state.set(DECISIONS, list)
      await $.store.set(DECISIONS_KEY, list)
      await $.prompt.submit({ text: held.text, asUser: true })
    }

    const effort = effortName(band.effort)
    const why = s.mode === 'explicativo' && band.why !== undefined ? band.why : ''
    const color = modelColor(band.tier)
    const isTerm = e.surface === 'terminal'
    const now = await $.clock.now()
    const meter = (await $.state.get(USAGE)).value ?? null
    const u = band.usage ?? meter?.last ?? (meter !== null && meter.latest !== null ? bandOf(meter, now) : null)
    const age = u === null ? '' : now - u.at > 60_000 ? `medido ${ageText(u.at, now)}` : 'medido'
    const projection = u === null ? undefined : projectionText(u.projection)

    return (
      <Box flexDirection="column" borderStyle="round" borderColor={C.hair} paddingX={1}>
        <Box flexDirection="row" gap={1}>
          <Text color={color} weight="semibold">
            {`● ${MODEL_NAMES[band.tier]}${effort === undefined ? '' : ` · esforço ${effort}`}`}
          </Text>
          {why !== '' && (
            <Text color={MUTED} wrap="truncate-end">
              {why}
            </Text>
          )}
        </Box>
        {s.isUsageOn && u === null && (
          <Text color={MUTED} wrap="truncate-end">
            Uso: sem leitura agora
          </Text>
        )}
        {s.isUsageOn && u !== null && (
          <Box flexDirection="row" gap={1}>
            <Text color={USAGE_TONE[toneOf(u.to.session)]} wrap="truncate-end">
              {windowText('Sessão', u.to.session, u.from?.session, isTerm)}
            </Text>
            <Text color={MUTED}>·</Text>
            <Text color={USAGE_TONE[toneOf(u.to.week)]} wrap="truncate-end">
              {windowText('Semana', u.to.week, u.from?.week, isTerm)}
            </Text>
            <Text color={MUTED} wrap="truncate-end">
              {`· ${age}`}
            </Text>
          </Box>
        )}
        {s.isUsageOn && projection !== undefined && (
          <Text color={C.warn} wrap="truncate-end">
            {projection}
          </Text>
        )}
        {s.isTimeOn !== false && band.took !== undefined && (
          <Text color={MUTED} wrap="truncate-end">
            {tookText(band.took, band.estimate)}
          </Text>
        )}
        {band.changed !== undefined && (
          <Text color={MUTED} wrap="truncate-end">
            {band.changed}
          </Text>
        )}
        <Box flexDirection="row" gap={1}>
          {canGoUp && (
            <Button key="auto-model-errou" label={`Esse modelo errou · refazer no ${MODEL_NAMES[up]}`} onPress={wrong} />
          )}
          <Button key="auto-model-painel" label={isPaneUp ? 'Ocultar painel' : 'Mostrar painel'} onPress={() => void togglePane($).catch(() => undefined)} />
          <Button key="auto-model-ocultar" label="Ocultar" onPress={() => $.state.set(BAND, null)} />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const cols = Math.max(20, e.props.bodyColumns)
    const s = (await $.state.get(SETTINGS)).value ?? DEFAULT_SETTINGS
    const stats = (await $.state.get(STATS)).value ?? EMPTY_STATS
    const list = (await $.state.get(DECISIONS)).value ?? []
    const days = (await $.state.get(DAYS)).value ?? {}
    const profile = (await $.state.get(PROFILE)).value ?? null
    const meterNow = (await $.state.get(USAGE)).value ?? null
    const lastUsage = meterNow?.last ?? null
    const now = await $.clock.now()
    const today = dayKey(now)

    if (!isGrid(e.surface)) {
      const els = $.ui.resolve(e) as unknown as Els
      const held = async (change: (held: AutoModelSettings) => AutoModelSettings) => {
        const now = (await $.state.get(SETTINGS)).value ?? DEFAULT_SETTINGS
        const changed = change(now)
        await $.state.set(SETTINGS, changed)
        await $.store.set(SETTINGS_KEY, changed)
      }
      const flip = async (field: 'details' | 'advanced') => {
        const v = (await $.state.get(UI)).value ?? { details: false, advanced: false }
        await $.state.set(UI, { ...v, [field]: !v[field] })
      }

      return premiumPane(els, {
        cols,
        now,
        version: VERSION,
        s,
        stats,
        list,
        days,
        applied: (await $.state.get(APPLIED)).value ?? null,
        meter: (await $.state.get(USAGE)).value ?? null,
        profile,
        autoFloor: (await $.state.get(AUTOFLOOR)).value ?? null,
        view: (await $.state.get(UI)).value ?? { details: false, advanced: false },
        summary: (await $.state.get(SUMMARY)).value ?? null,
        proof: proofOf(days, today, now, s.dailyBaseline),
        ratio: budgetRatio(s, monthOf(days, today)),
        isCalibrated: calibration !== undefined,
        ...((t: string | undefined) => (t === undefined ? {} : { timeAccuracy: t }))(accuracyText(timeCal)),
        actions: {
          setOn: (isOn: boolean) => held(x => ({ ...x, isOn })),
          toggleUsage: () => held(x => ({ ...x, isUsageOn: !x.isUsageOn })),
          cycleStrategy: () =>
            held(x => ({ ...x, strategy: STRATEGIES[(STRATEGIES.indexOf(x.strategy) + 1) % STRATEGIES.length] ?? 'equilibrado' })),
          cycleCeiling: () =>
            held(x => {
              const top = x.ceiling >= 3 ? 0 : x.ceiling + 1
              return { ...x, ceiling: top as AutoModelTier, isFableOn: top === 3 ? true : x.isFableOn }
            }),
          toggleExplain: () => held(x => ({ ...x, mode: x.mode === 'explicativo' ? 'silencioso' : 'explicativo' })),
          toggleSync: () => held(x => ({ ...x, isSyncOn: !x.isSyncOn })),
          toggleDetails: () => flip('details'),
          toggleAdvanced: () => flip('advanced'),
        },
      })
    }

    const rule = (width: number) => (
      <Box flexDirection="row">
        <Text color={GOLD}>{'━'.repeat(Math.min(width, cols))}</Text>
        <Text color={HAIR}>{'─'.repeat(Math.max(0, cols - width))}</Text>
      </Box>
    )
    const section = (label: string) => (
      <Box flexDirection="row" marginTop={1}>
        <Text color={MUTED}>{label} </Text>
        <Text color={HAIR}>{'─'.repeat(Math.max(0, cols - textWidth(label) - 1))}</Text>
      </Box>
    )

    const setUsage = async (isUsageOn: boolean) => {
      const held = (await $.state.get(SETTINGS)).value ?? DEFAULT_SETTINGS
      const changed = { ...held, isUsageOn }
      await $.state.set(SETTINGS, changed)
      await $.store.set(SETTINGS_KEY, changed)
    }
    const setOn = async (isOn: boolean) => {
      const held = (await $.state.get(SETTINGS)).value ?? DEFAULT_SETTINGS
      const changed = { ...held, isOn }
      await $.state.set(SETTINGS, changed)
      await $.store.set(SETTINGS_KEY, changed)
    }
    const heading = 'AUTO MODEL'
    const state = s.isOn ? 'ligado' : 'desligado'
    const toggle = s.isOn ? (
      <Button key="toggle" label="Desligar" onPress={() => setOn(false)} />
    ) : (
      <Button key="toggle" label="Ligar" variant="primary" onPress={() => setOn(true)} />
    )
    const grid = isGrid(e.surface)

    const perRow = cols >= 3 * 22 + 2 ? 3 : cols >= 2 * 22 + 1 ? 2 : 1
    const tileWidth = Math.floor((cols - (perRow - 1)) / perRow)
    const inner = Math.max(4, tileWidth - 4)
    const tiles = [
      { key: 'save', label: 'ECONOMIA ESTIMADA (%)', value: `${savingsPercent(stats)}%`, note: 'contra usar sempre o Opus' },
      { key: 'tokens', label: 'TOKENS ECONOMIZADOS', value: fmtCompact(tokensSaved(stats, s.prices)), note: 'equivalente Opus' },
      {
        key: 'esc',
        label: 'SUBIU DE MODELO',
        value: `${escalationRate(stats)}%`,
        note: 'quanto menor, mais certeira',
      },
    ]
    const tileRows: (typeof tiles)[] = []
    for (let i = 0; i < tiles.length; i += perRow) tileRows.push(tiles.slice(i, i + perRow))
    const tileView = (tile: (typeof tiles)[number]) => {
      const big = bigNumeral(tile.value)
      const fits = grid && big !== undefined && textWidth(big[0]) <= inner

      return (
        <Box key={`tile-${tile.key}`} flexDirection="column" borderStyle="round" borderColor={HAIR} paddingX={1} width={tileWidth}>
          <Text color={MUTED} wrap="truncate-end">
            {tile.label}
          </Text>
          {fits && big !== undefined ? (
            <Box flexDirection="column">
              <Text color={MAIN}>{big[0]}</Text>
              <Text color={MAIN}>{big[1]}</Text>
              <Text color={MAIN}>{big[2]}</Text>
            </Box>
          ) : (
            <Box flexDirection="column">
              {grid && <Text> </Text>}
              <Text size="title" weight="bold" tabular color={MAIN} wrap="truncate-end">
                {tile.value}
              </Text>
              {grid && <Text> </Text>}
            </Box>
          )}
          <Text color={MUTED} wrap="truncate-end">
            {tile.note}
          </Text>
        </Box>
      )
    }

    const labelWidth = 9
    const countWidth = 7
    const barRoom = Math.max(3, cols - labelWidth - countWidth)
    const most = Math.max(1, ...stats.byTier)
    const tierColors = [GOOD, GOLD, WARN, MAIN]
    const bars = MODEL_NAMES.map((name, i) => {
      const count = stats.byTier[i] ?? 0
      const len = count === 0 ? 0 : Math.max(1, Math.round((count / most) * barRoom))

      return (
        <Box key={`bar-${name}`} flexDirection="row">
          <Text mono color={count === 0 ? MUTED : MAIN}>{padEnd(name, labelWidth)}</Text>
          <Text mono color={tierColors[i] ?? MAIN}>{'█'.repeat(len)}</Text>
          <Text mono>{' '.repeat(barRoom - len)}</Text>
          <Text mono color={count === 0 ? MUTED : MAIN}>{padStart(String(count), countWidth)}</Text>
        </Box>
      )
    })

    // Proof of savings: 14 days, two cells a day, real (solid) over always-Opus (light).
    const proof = proofOf(days, today, now, s.dailyBaseline)
    const chart = proofChart(proof)
    const chartWidth = proof.days.length * 2
    const showChart = cols >= chartWidth
    const chartRows = chart.actual.map((a, r) => {
      // Runs of one color, so a row is a handful of texts, not one per cell.
      const runs: { isReal: boolean; text: string }[] = []
      const cells = [...a]
      for (let i = 0; i < cells.length; i += 1) {
        const isReal = cells[i] !== ' '
        const ch = isReal ? (cells[i] ?? ' ') : (chart.opus[r]?.[i] ?? ' ')
        const last = runs[runs.length - 1]
        if (last !== undefined && last.isReal === isReal) last.text += ch
        else runs.push({ isReal, text: ch })
      }

      return (
        <Box key={`chart-${r}`} flexDirection="row">
          {runs.map(run => (
            <Text mono color={run.isReal ? GOOD : MUTED}>
              {run.text}
            </Text>
          ))}
        </Box>
      )
    })
    const dayLabels = proof.days.map(d => d.key.slice(8, 10)).join('')

    const recent = [...list].reverse()
    const layerWidth = cols >= 50 ? 13 : 0
    const showEffort = cols >= 50
    const nameWidth = showEffort ? 13 : 8
    const pctWidth = 5
    const reasonRoom = Math.max(4, cols - nameWidth - pctWidth - layerWidth)
    const rows = recent.map((d, i) => (
      <Box key={`d-${i}`} flexDirection="row">
        <Text mono color={i === 0 ? GOLD : MAIN}>{padEnd(showEffort && d.effort !== undefined ? `${MODEL_NAMES[d.tier]} ${effortShort(d.effort)}` : MODEL_NAMES[d.tier], nameWidth)}</Text>
        <Text mono color={MAIN} wrap="truncate-end">{padEnd(d.reason, reasonRoom)}</Text>
        <Text mono color={MUTED}>{padStart(fmtPercent(d.confidence), pctWidth)}</Text>
        {layerWidth > 0 && <Text mono color={MUTED}>{padStart(d.layer, layerWidth)}</Text>}
      </Box>
    ))

    const month = monthOf(days, today)
    const ratio = budgetRatio(s, month)
    const routerCost = stats.routerCost ?? 0
    const net = stats.opusCost > 0 ? Math.max(0, Math.round(((stats.opusCost - stats.actualCost - routerCost) / stats.opusCost) * 100)) : 0
    const routerLine = !s.isRouterOn
      ? 'Roteador desligado: só as regras grátis decidem.'
      : `Custo da análise: ${fmtInt(routerCost)} (${stats.routerCalls ?? 0} análises, ${stats.routerHits ?? 0} reaproveitadas do cache) · economia líquida ${net}%`

    return (
      <Box flexDirection="column" width={cols}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold color={MAIN}>
            {heading}
          </Text>
          <Box flexDirection="row" gap={1}>
            <Text color={s.isOn ? GOOD : WARN}>{state}</Text>
            {toggle}
            <Button
              key="usage-toggle"
              label={s.isUsageOn ? 'Uso: ligado' : 'Uso: desligado'}
              onPress={() => setUsage(!s.isUsageOn)}
            />
          </Box>
        </Box>
        {rule(textWidth(heading))}
        {s.isUsageOn && (
          <Text color={USAGE_TONE[toneOf(meterNow?.latest === null || meterNow?.latest === undefined ? 0 : worstWindow(readingOf(meterNow.latest)).pct)]} wrap="truncate-end">
            {`Uso: ${measuredLine(meterNow?.latest ?? null, lastUsage?.from ?? null, now, true)}`}
          </Text>
        )}
        <Box flexDirection="column" marginTop={1}>
          {tileRows.map((rowTiles, r) => (
            <Box key={`tiles-${r}`} flexDirection="row" gap={1}>
              {rowTiles.map(tileView)}
            </Box>
          ))}
        </Box>
        {section('PROVA DE ECONOMIA')}
        {showChart ? (
          <Box flexDirection="column">
            {chartRows}
            <Text mono color={MUTED}>
              {dayLabels}
            </Text>
            <Text color={MUTED} wrap="truncate-end">
              █ real · ░ se fosse sempre Opus · últimos 14 dias
            </Text>
          </Box>
        ) : (
          <Text color={MUTED}>Alargue o painel para ver o gráfico de 14 dias.</Text>
        )}
        <Text color={MUTED} wrap="wrap">
          {routerLine}
        </Text>
        <Text color={MAIN} wrap="wrap">
          {proof.opus > 0
            ? `Economia total ${proof.savedPercent}% · cerca de ${fmtNumber(proof.planDays)} dias de plano (estimativa, base de um dia ${fmtInt(proof.baseline)})`
            : 'Ainda sem dados: a prova de economia aparece depois do primeiro pedido respondido.'}
        </Text>
        {section('DISTRIBUIÇÃO POR MODELO')}
        {bars}
        {ratio !== undefined && section('ORÇAMENTO DO OPUS')}
        {ratio !== undefined && (
          <Text color={ratio >= 0.8 ? WARN : MAIN} wrap="wrap">
            {`${fmtPercent(Math.min(ratio, 9.99))} do orçamento usado (limite ${fmtNumber(s.opusBudget ?? 0)}% do mês para Opus/Fable)`}
          </Text>
        )}
        {section('ÚLTIMAS DECISÕES')}
        {rows.length === 0 ? (
          <Text color={MUTED}>Nenhuma decisão ainda. Envie um pedido e ela aparece aqui.</Text>
        ) : (
          rows
        )}
        <Box marginTop={1}>
          <Text color={MUTED} wrap="wrap">
            {`Valores estimados vs. usar sempre o Opus · teto ${MODEL_NAMES[s.ceiling]} · modo ${s.strategy}${profile === null ? '' : ` · perfil do projeto: ${MODEL_NAMES[profile]}`}${calibration === undefined ? '' : ' · calibrado'} · /automodelo ajuda`}
          </Text>
        </Box>
      </Box>
    )
  })
}

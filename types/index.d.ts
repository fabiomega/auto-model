export type AutoModelTier = 0 | 1 | 2 | 3

export type AutoModelLayer =
  | 'roteador'
  | 'regras'
  | 'haiku'
  | 'forçado'
  | 'continuação'
  | 'escalada'
  | 'cache'
  | 'correção'

export type AutoModelDecision = {
  tier: AutoModelTier
  reason: string
  layer: AutoModelLayer
  score: number
  confidence: number
  ctx: number
  at: number
  detail: string[]
  /** The Haiku classifier's label, when layer 1 decided. */
  label?: string
  /** The effort the turn was sent with, when the mod set one. */
  effort?: string
  /** Why this effort, in a plain sentence, when the mod chose it. */
  effortWhy?: string
  /** The router's few words on what the task is, when the router read it. */
  summary?: string
  /** True when the router's reading came from the semantic cache, at no cost. */
  isCached?: boolean
}

export type AutoModelSettings = {
  isOn: boolean
  ceiling: AutoModelTier
  isFableOn: boolean
  prices: [number, number, number, number]
  isSyncOn: boolean
  /** 'explicativo' says why in the status line and the band; 'silencioso' shows the model alone. */
  mode: 'explicativo' | 'silencioso'
  /** Max share (percent) of the month's estimated cost that may go to Opus and Fable; null for none. */
  opusBudget: number | null
  /** Words that never go to the cheapest model. */
  criticals: string[]
  /** The cost of a typical day for "dias de plano"; 0 works it out from history. */
  dailyBaseline: number
  /** The semantic router reads each request; off, the free rules decide alone. */
  isRouterOn: boolean
  /** 'automatico': the task's own demand sets the effort; 'respeitar': the person's effort is the ceiling. */
  effortMode: 'automatico' | 'respeitar'
  /** Show "Rodando: modelo · esforço" in the prompt footer. */
  isLabelOn: boolean
  /** Show the usage percentages (sessão and semana) under the answer and in the pane. Off by default. */
  isUsageOn: boolean
  /** The budget, in weighted tokens, of the five-hour window: the estimate when the official reading is not there. */
  sessionTokens: number
  /** The budget, in weighted tokens, of the seven-day window: the estimate when the official reading is not there. */
  weekTokens: number
  /** 'economia' goes up a model later and spends less effort; 'qualidade' the reverse; 'equilibrado' is the default. */
  strategy: 'economia' | 'equilibrado' | 'qualidade'
  /** Show the worst usage window ("🟡 Sessão 78%") beside the model label in the footer. */
  isUsageFooterOn: boolean
  /** The settings version these were saved under, so an old default can be moved to the new one once. */
  v: number
  /** 0.8.0: show how long each answer took in the band ("⏱ levou 1 min 42 s"). Absent means on. */
  isTimeOn?: boolean
  /** 0.8.0: append the time and session estimates to the live preview line. Absent means on. */
  isPreviewExtraOn?: boolean
}

/** Percent used of each window. */
export type UsageReading = { session: number; week: number }

/** The usage a request moved, from the reading before it to the reading after it. */
export type AutoModelBandUsage = {
  source: 'medido' | 'estimado'
  from: UsageReading
  to: UsageReading
  /** For an estimate: how much of the session move was the request itself and how much the history resent. */
  split?: { request: number; history: number }
}

/** The usage meter's own state: where each window stood when the request started, and the estimate. */
export type AutoModelUsageState = {
  start: { official: UsageReading | null; est: UsageReading } | null
  est: UsageReading
  sessionStart: number
  weekKey: string
  last: (AutoModelBandUsage & { to: UsageReading }) | null
  /** When each official window resets, as the session reported it. */
  resets?: { session?: string; week?: string }
  /** Thresholds already warned in a period, e.g. "session-80-<start>". */
  warned: string[]
}

/** One measured reading of both windows, as the app reported it, with when each resets. */
export type AutoModelMeasured = {
  session: number
  week: number
  /** When it was read, in $.clock.now() milliseconds. */
  at: number
  sessionResetsAt?: string
  weekResetsAt?: string
}

/** The usage a request moved, only from measured readings: before it (when there was one) and the latest after it. */
export type AutoModelBandMeasured = {
  from: UsageReading | null
  to: UsageReading
  /** When the latest reading was taken. */
  at: number
  sessionResetsAt?: string
  weekResetsAt?: string
  /** Minutes until the session runs out at this pace, when that comes before its reset. */
  projection?: number
}

/** The measured-only usage meter (0.7.0). */
export type AutoModelMeter = {
  /** The latest measured reading; kept across restarts so it can be shown with its age. */
  latest: AutoModelMeasured | null
  /** The reading when the current or last request started. */
  start: AutoModelMeasured | null
  /** What the last answered request moved. */
  last: AutoModelBandMeasured | null
  /** Recent session readings, for the projection. */
  pace: { at: number; pct: number }[]
  /** Points of the weekly limit each model took, for the week that resets at `period`. */
  share: { period: string; pct: [number, number, number, number] } | null
  /** Warnings already raised, one key per window, threshold and period. */
  warned: string[]
  /** Resets already announced, one key per window and reset time. */
  resetSeen: string[]
}

/** What the last request was really sent with. */
export type AutoModelApplied = { tier: AutoModelTier; effort?: string }

export type AutoModelDay = {
  actual: number
  opus: number
  top: number
  turns: number
  /** Weighted tokens the day's requests used, for the usage share in the export. */
  units?: number
  /** Times the model changed from one request to the next. */
  switches?: number
  /** Times the person pressed "Esse modelo errou". */
  errou?: number
}

/** What the pane has open: the details of the decisions and the advanced numbers. */
export type AutoModelView = { details: boolean; advanced: boolean }

export type AutoModelPreview = {
  tier: AutoModelTier
  reason: string
  /** 0 to 1, when known. */
  confidence?: number
  /** The effort the next request would be sent with, when known. */
  effort?: string
  /** The router is still reading the draft. */
  isAnalyzing?: boolean
  /** The router failed and the free rules decided the preview. */
  isFallback?: boolean
  /** 0.8.0: "≈2 min · ~1% da sessão", from history, when there is one. */
  extra?: string
  /** 0.8.0: "pode passar de 90% da sessão", when the request may take a window past 90%. */
  warn?: string
  warnTone?: 'accent' | 'bad'
}

export type AutoModelBand = {
  tier: AutoModelTier
  text: string
  groups: string[]
  /** One short sentence on why, shown in the explaining mode. */
  why?: string
  /** The step on the effort ladder the request asked for, kept for a correction. */
  step?: number
  /** The effort the answer was sent with, shown beside the model. */
  effort?: string
  /** How much of each usage window the answer moved, measured, when the meter is on. */
  usage?: AutoModelBandMeasured
  /** When the send decided otherwise than the preview showed: one line saying why. */
  changed?: string
  /** 0.8.0: how long the answer took, in ms. */
  took?: number
  /** 0.8.0: the time range estimated before the request was sent, in ms, when there was one. */
  estimate?: { lo: number; hi: number }
}

export type AutoModelStats = {
  turns: number
  escalations: number
  actualCost: number
  opusCost: number
  byTier: [number, number, number, number]
  /** Router readings that called the model, and those served by the cache. */
  routerCalls: number
  routerHits: number
  /** What the router's own calls cost, on the same relative scale as the rest. */
  routerCost: number
}

declare module 'claude-code' {
  interface PluginState {
    'auto-model': {
      settings: AutoModelSettings
      stats: AutoModelStats
      decisions: AutoModelDecision[]
      band: AutoModelBand | null
      days: Record<string, AutoModelDay>
      preview: AutoModelPreview | null
      next: AutoModelTier | null
      profile: AutoModelTier | null
      applied: AutoModelApplied | null
      usage: AutoModelMeter | null
      /** The floor this project earned by itself, when it has one. */
      autoFloor: AutoModelTier | null
      ui: AutoModelView
      /** The last weekly summary, in a sentence. */
      summary: string | null
      /** Whether the pane is on screen, for the band's Mostrar/Ocultar button. */
      paneUp: boolean
    }
  }
}

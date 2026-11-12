import type { AutoModelDecision, AutoModelSettings, AutoModelStats, AutoModelTier } from '../types'
import {
  MODEL_NAMES,
  REASONS,
  SMALL_CONTEXT,
  capTier,
  fmtInt,
  fmtNumber,
  switchWorth,
  tierOfScore,
  weighted,
} from './logic'
import type { Effort, Usage } from './logic'
import { effortAtStep, effortWhyOf, refine } from './round2'
import type { Calibration } from './round2'

// ---- what the router answers ----

/** The router's reading of a request: what it demands, not which words it used. */
export type Route = {
  raciocinio: number
  construcao: number
  passos: number
  ambiguidade: number
  risco: number
  continuacao: boolean
  resumo: string
  confianca: number
}

const DIMENSIONS = ['raciocinio', 'construcao', 'passos', 'ambiguidade', 'risco'] as const

const DIMENSION_NAMES: Record<(typeof DIMENSIONS)[number], string> = {
  raciocinio: 'raciocínio',
  construcao: 'construção',
  passos: 'passos',
  ambiguidade: 'ambiguidade',
  risco: 'risco',
}

function score03(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : v
  if (typeof n !== 'number' || !Number.isFinite(n)) return undefined

  return Math.max(0, Math.min(3, Math.round(n)))
}

/**
 * One reading from the readings of a long text's parts: the highest demand of
 * each dimension (the part with the hardest request sets it), the summary of
 * the most demanding part, the lowest confidence, and a continuation only when
 * every part reads as one.
 */
export function mergeRoutes(routes: readonly Route[]): Route | undefined {
  const first = routes[0]
  if (first === undefined) return undefined
  let top = first
  for (const r of routes) if (needOf(r) > needOf(top)) top = r
  const max = (k: (typeof DIMENSIONS)[number]) => Math.max(...routes.map(r => r[k]))

  return {
    raciocinio: max('raciocinio'),
    construcao: max('construcao'),
    passos: max('passos'),
    ambiguidade: max('ambiguidade'),
    risco: max('risco'),
    continuacao: routes.every(r => r.continuacao),
    resumo: top.resumo,
    confianca: Math.min(...routes.map(r => r.confianca)),
  }
}

/** Reads the router's reply; anything that is not the JSON asked for is undefined. */
export function parseRoute(text: string): Route | undefined {
  const found = /\{[\s\S]*\}/.exec(text)
  if (found === null) return undefined
  let raw: unknown
  try {
    raw = JSON.parse(found[0])
  } catch {
    return undefined
  }
  if (raw === null || typeof raw !== 'object') return undefined
  const o = raw as Record<string, unknown>
  const dims: number[] = []
  for (const d of DIMENSIONS) {
    const v = score03(o[d])
    if (v === undefined) return undefined
    dims.push(v)
  }
  const conf = typeof o.confianca === 'number' ? o.confianca : Number(o.confianca)
  const resumo = typeof o.resumo === 'string' ? o.resumo.trim().split(/\s+/).slice(0, 6).join(' ') : ''

  return {
    raciocinio: dims[0] ?? 0,
    construcao: dims[1] ?? 0,
    passos: dims[2] ?? 0,
    ambiguidade: dims[3] ?? 0,
    risco: dims[4] ?? 0,
    continuacao: o.continuacao === true || o.continuacao === 'true',
    resumo: resumo === '' ? 'pedido' : resumo.slice(0, 60),
    confianca: Number.isFinite(conf) ? Math.max(0, Math.min(100, Math.round(conf))) : 50,
  }
}

/**
 * The fixed table from what a request demands to a need on the rules' scale
 * (the thresholds 2,5 / 5,5 / 9 split Haiku, Sonnet, Opus and Fable), so the
 * cheapest model-and-effort, the budget and the calibration all read it alike.
 */
export function needOf(r: Route): number {
  let need = 0.5 + 1.6 * r.raciocinio + 1.4 * r.construcao + 1 * r.passos + 0.4 * r.ambiguidade + 0.5 * r.risco
  // Hard reasoning or a whole system to build never goes below Opus.
  if (r.raciocinio === 3 || r.construcao === 3) need = Math.max(need, 7.6)
  // The hardest thinking, the largest build and a long run together reach Fable.
  if (r.raciocinio === 3 && r.construcao >= 2 && r.passos === 3) need = Math.max(need, 12.5)

  return Math.round(need * 10) / 10
}

/**
 * How hard the task asks the model to think, from what it demands and nothing
 * else: a step on the effort ladder (0 low, 1 medium, 2 high, 3 xhigh). The
 * session's own setting has no part in it. The top step needs hard reasoning.
 */
export function demandStepOf(r: Route): number {
  const demand = 0.9 * r.raciocinio + 0.5 * r.passos + 0.6 * r.ambiguidade + 0.4 * r.risco + 0.3 * r.construcao
  if (demand < 1.8) return 0
  if (demand < 3.6) return 1
  if (demand < 5.8 || r.raciocinio < 3) return 2

  return 3
}

export function describeRoute(r: Route): string {
  return DIMENSIONS.map(d => `${DIMENSION_NAMES[d]} ${r[d]}`).join(' · ')
}

// ---- the normalizer: same meaning, same key ----

const STOPWORDS = new Set([
  'a', 'o', 'as', 'os', 'um', 'uma', 'uns', 'umas', 'de', 'da', 'do', 'das', 'dos', 'em', 'na', 'no', 'nas', 'nos',
  'para', 'pra', 'pro', 'por', 'com', 'e', 'ou', 'que', 'se', 'me', 'mim', 'eu', 'voce', 'vc', 'ele', 'ela', 'isso',
  'isto', 'esse', 'essa', 'este', 'esta', 'aqui', 'ai', 'la', 'ao', 'aos', 'pelo', 'pela', 'favor', 'porfavor', 'pf',
  'pfv', 'ja', 'so', 'mais', 'muito', 'bem', 'tambem', 'agora', 'entao', 'tipo', 'meu', 'minha', 'seu', 'sua',
  'the', 'an', 'of', 'to', 'in', 'on', 'for', 'with', 'and', 'or', 'me', 'my', 'please', 'pls', 'i', 'you', 'it',
  'this', 'that', 'is', 'are', 'be', 'some', 'can', 'could', 'would', 'will', 'just', 'now',
])

// Verbs that all ask for something to be made: one token for all of them.
const MAKE = new Set([
  'crie', 'criar', 'cria', 'crio', 'gere', 'gerar', 'gera', 'monte', 'montar', 'monta', 'faca', 'fazer', 'faz',
  'construa', 'construir', 'constroi', 'desenvolva', 'desenvolver', 'desenvolve', 'implemente', 'implementar',
  'implementa', 'elabore', 'elaborar', 'elabora', 'produza', 'produzir', 'produz', 'prepare', 'preparar', 'prepara',
  'escreva', 'escrever', 'escreve', 'desenhe', 'desenhar', 'programe', 'programar', 'codifique', 'codar', 'bole',
  'preciso', 'precisamos', 'quero', 'queria', 'gostaria', 'necessito', 'build', 'make', 'create', 'generate',
  'develop', 'implement', 'write', 'design', 'code', 'need', 'want', 'produce', 'craft', 'setup',
])

// Verbs that all ask for something to be found out or counted.
const ASK = new Set([
  'quantos', 'quantas', 'quanto', 'quanta', 'conte', 'contar', 'liste', 'listar', 'mostre', 'mostrar', 'diga',
  'dizer', 'informe', 'how', 'many', 'much', 'count', 'list', 'show', 'tell',
])

const FIX = new Set([
  'corrija', 'corrigir', 'conserte', 'consertar', 'arrume', 'arrumar', 'resolva', 'resolver', 'fix', 'repair',
  'solve', 'debug', 'depure', 'depurar',
])

export function stripAccents(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
}

function canonical(word: string): string {
  if (MAKE.has(word)) return '~criar'
  if (ASK.has(word)) return '~consultar'
  if (FIX.has(word)) return '~corrigir'
  // A light plural fold: "painéis"/"painel", "arquivos"/"arquivo".
  if (word.length > 4 && word.endsWith('eis')) return `${word.slice(0, -3)}el`
  if (word.length > 4 && word.endsWith('s')) return word.slice(0, -1)

  return word
}

/** The words that carry meaning, canonical and unique, sorted. */
export function tokensOf(text: string): string[] {
  const words = stripAccents(text)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w !== '' && !STOPWORDS.has(w))
    .map(canonical)

  return [...new Set(words)].sort()
}

export function keyOf(text: string): string {
  return tokensOf(text).join(' ')
}

export function jaccard(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 && b.length === 0) return 1
  const set = new Set(a)
  let both = 0
  for (const w of new Set(b)) if (set.has(w)) both += 1
  const union = set.size + new Set(b).size - both

  return union === 0 ? 0 : both / union
}

// ---- the semantic cache: least recently used, seven days ----

export const CACHE_LIMIT = 200
export const CACHE_TTL = 7 * 24 * 60 * 60 * 1000
/** Below this many meaning words a request leans on the conversation, so its entry is tied to it. */
const SHORT_KEY = 4

export type CacheEntry = { route: Route; at: number; used: number; sig: string }
export type RouteCache = Record<string, CacheEntry>

/** What the conversation looks like, for short requests whose meaning depends on it. */
export function contextSig(key: string, lastTier: AutoModelTier | undefined, isBuilding: boolean): string {
  return key.split(' ').length < SHORT_KEY ? `${lastTier ?? '-'}:${isBuilding ? 1 : 0}` : ''
}

export function cacheGet(cache: RouteCache, key: string, sig: string, now: number): Route | undefined {
  const e = cache[key]
  if (e === undefined || now - e.at > CACHE_TTL || e.sig !== sig) return undefined
  e.used = now

  return e.route
}

export function cachePut(cache: RouteCache, key: string, sig: string, route: Route, now: number): RouteCache {
  const next: RouteCache = { ...cache, [key]: { route, at: now, used: now, sig } }
  const keys = Object.keys(next)
  if (keys.length <= CACHE_LIMIT) return next
  for (const k of keys) if (now - (next[k]?.at ?? 0) > CACHE_TTL) delete next[k]
  const left = Object.keys(next).sort((a, b) => (next[a]?.used ?? 0) - (next[b]?.used ?? 0))
  for (const k of left.slice(0, Math.max(0, left.length - CACHE_LIMIT))) delete next[k]

  return next
}

// ---- the person's own history, as examples ----

export const EXAMPLE_LIMIT = 200

export type Example = {
  key: string
  text: string
  resumo: string
  /** The model that turned out right for it. */
  tier: AutoModelTier
  outcome: 'ok' | 'subiu' | 'errou' | 'forçado'
  at: number
}

export function pushExample(list: readonly Example[], ex: Example): Example[] {
  return [...list.filter(e => e.key !== ex.key), ex].slice(-EXAMPLE_LIMIT)
}

/** The newest example learns that a higher model was the right one. */
export function correctLast(list: readonly Example[], tier: AutoModelTier, outcome: Example['outcome']): Example[] {
  const last = list[list.length - 1]
  if (last === undefined || tier <= last.tier) return [...list]

  return [...list.slice(0, -1), { ...last, tier, outcome }]
}

export function similar(list: readonly Example[], key: string, count = 3): Example[] {
  const tokens = key.split(' ').filter(Boolean)

  return list
    .filter(e => e.key !== key)
    .map(e => ({ e, sim: jaccard(tokens, e.key.split(' ').filter(Boolean)) }))
    .filter(x => x.sim >= 0.2)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, count)
    .map(x => x.e)
}

// ---- the router's prompt ----

/** Fixed, so the prompt cache can keep it; everything that changes comes after it. */
export const RUBRIC = `Você é o roteador de modelos de um assistente (Claude Code) que programa, cria arquivos, pesquisa e cuida de tarefas de trabalho. Leia o pedido e avalie O QUE ELE EXIGE, não as palavras usadas. Verbos diferentes com o mesmo sentido ("crie", "gere", "monte", "faça", "construa", "preciso de", "build", "make") pedem a mesma coisa e recebem as mesmas notas.

Dê notas inteiras de 0 a 3:
- raciocinio: 0 resposta direta ou consulta de um dado; 1 explicar ou analisar algo simples; 2 análise com várias partes ou decisões de projeto; 3 problema difícil (arquitetura, algoritmo, depuração sutil, matemática, estratégia complexa).
- construcao: 0 nada a criar; 1 texto curto, comando ou ajuste pequeno; 2 um arquivo, script, página, painel ou documento completo; 3 sistema ou aplicativo com várias partes ou muitos arquivos.
- passos: 0 uma ação; 1 poucas ações; 2 várias ferramentas, arquivos ou fontes; 3 trabalho longo com muitas etapas.
- ambiguidade: 0 claro; 1 um pouco aberto; 2 vago; 3 muito vago, exige adivinhar a intenção.
- risco: 0 nenhum; 1 baixo; 2 mexe em dados reais, dinheiro, senhas, segurança, produção ou algo difícil de desfazer; 3 crítico.
- continuacao: true só se o pedido apenas continua a tarefa anterior do contexto ("agora adicione X", "faça o mesmo para Y"); senão false.
- resumo: até 6 palavras em português dizendo qual é a tarefa.
- confianca: de 0 a 100, o quanto você tem certeza das notas.

Responda só com um objeto JSON, sem nenhum texto antes ou depois, neste formato:
{"raciocinio":0,"construcao":0,"passos":0,"ambiguidade":0,"risco":0,"continuacao":false,"resumo":"...","confianca":90}`

export type RouterContext = {
  lastResumo: string | undefined
  lastTier: AutoModelTier | undefined
  isBuilding: boolean
  model: string
  turns: number
}

export function contextLine(c: RouterContext): string {
  const parts = [
    c.lastResumo === undefined || c.lastTier === undefined
      ? 'Ainda não houve tarefa nesta conversa.'
      : `Tarefa anterior: "${c.lastResumo}" (feita com ${MODEL_NAMES[c.lastTier]}).`,
    c.isBuilding ? 'Os últimos pedidos criaram ou editaram arquivos.' : 'Os últimos pedidos não editaram arquivos.',
    `Pedidos nesta conversa: ${c.turns}.`,
    `Modelo atual: ${c.model}.`,
  ]

  return parts.join(' ')
}

export function routerPrompt(text: string, c: RouterContext, examples: readonly Example[]): { text: string; cache?: true }[] {
  const shots =
    examples.length === 0
      ? ''
      : `\n\nPedidos parecidos desta mesma pessoa e o modelo que deu certo (use como referência, não copie):\n${examples
          .map(e => `- "${e.text.slice(0, 160)}" → ${MODEL_NAMES[e.tier]}${e.outcome === 'ok' ? '' : ` (${e.outcome})`}`)
          .join('\n')}`

  return [
    { text: RUBRIC, cache: true },
    {
      text: `\n\nContexto da conversa: ${contextLine(c)}${shots}\n\nPedido:\n"""\n${text.slice(0, 7000)}\n"""`,
    },
  ]
}

export function routeLine(r: Route, need: number, isCached: boolean): string {
  return `roteador: ${describeRoute(r)} → necessidade ${fmtNumber(need)}${r.continuacao ? ' · continua a tarefa anterior' : ''} · ${isCached ? 'veio do cache (sem custo)' : 'análise nova'}`
}

// ---- from the router's reading to a model and an effort ----

export type RouteDecideInput = {
  route: Route
  isCached: boolean
  text: string
  settings: AutoModelSettings
  previous: AutoModelTier | undefined
  ctx: number
  isCacheWarm: boolean
  at: number
  thresholds: readonly number[]
  floor: AutoModelTier | undefined
  budget: number | undefined
  baseEffort: Effort | number | undefined
  calibration: Calibration | undefined
}

/**
 * The router says what the request demands; the rest is fixed arithmetic:
 * the cheapest model-and-effort that meets that need, then the project's
 * floor, the Opus budget, a sensitive request's floor, a continued task's
 * model, and whether a cheaper model is worth re-caching the conversation.
 */
export function routeDecide(input: RouteDecideInput): { decision: AutoModelDecision; effort?: string; step?: number } {
  const { route, settings: s } = input
  const need = needOf(route)
  const demandStep = demandStepOf(route)
  const detail = [routeLine(route, need, input.isCached)]
  const base: AutoModelDecision = {
    tier: tierOfScore(need, s, input.thresholds),
    reason: route.resumo,
    layer: 'roteador',
    score: need,
    confidence: route.confianca / 100,
    ctx: input.ctx,
    at: input.at,
    detail,
    summary: route.resumo,
    isCached: input.isCached,
  }
  const refined = refine(base, {
    score: need,
    text: input.text,
    settings: s,
    thresholds: input.thresholds,
    floor: input.floor,
    budget: input.budget,
    baseEffort: input.baseEffort,
    calibration: input.calibration,
    demandStep,
  })
  let tier = refined.tier
  // The router's few words read better than a generic label, unless a rule set the reason.
  let reason = (REASONS as readonly string[]).includes(refined.reason) ? route.resumo : refined.reason
  let effort = refined.effort
  let effortWhy = refined.effortWhy
  let step = refined.step ?? demandStep
  let layer: AutoModelDecision['layer'] = 'roteador'
  // The same task step on another model, when a rule below moves the model.
  const redo = () => {
    effort = effortAtStep(tier, step, input.calibration)
    effortWhy = effortWhyOf(step, 0, 'tarefa', tier)
  }
  detail.push(...refined.detail)
  const isBudgetOut = input.budget !== undefined && input.budget >= 1

  if (route.risco >= 2 && tier < 1) {
    const up = capTier(1, s)
    if (up > tier) {
      tier = up
      reason = 'assunto sensível'
      redo()
      detail.push(`risco ${route.risco}: mínimo Sonnet`)
    }
  }

  const prev = input.previous
  if (route.continuacao && prev !== undefined && tier < prev) {
    const keep = capTier((isBudgetOut ? Math.min(prev, 1) : prev) as AutoModelTier, s)
    if (keep > tier) {
      tier = keep
      reason = 'continua a tarefa anterior'
      redo()
      detail.push(`continuação da tarefa anterior: mantém ${MODEL_NAMES[tier]}`)
    }
  }

  if (prev !== undefined && tier < prev && input.isCacheWarm && input.ctx >= SMALL_CONTEXT) {
    const check = switchWorth(prev, tier, input.ctx, s.prices)
    if (!check.isWorth) {
      detail.push(
        `trocar ${MODEL_NAMES[prev]} -> ${MODEL_NAMES[tier]} recriaria ${fmtInt(input.ctx)} tokens de cache: custo ${fmtInt(check.change)} contra ${fmtInt(check.stay)} ficando`,
      )
      tier = prev
      layer = 'cache'
      reason = `manter ${MODEL_NAMES[prev]} sai mais barato`
      redo()
    } else {
      detail.push(`troca vale a pena mesmo recriando o cache (${fmtInt(check.change)} contra ${fmtInt(check.stay)})`)
    }
  }

  const decision: AutoModelDecision = {
    ...base,
    tier,
    reason,
    layer,
    confidence: refined.confidence ?? base.confidence,
    detail,
    ...(effort === undefined ? {} : { effort }),
    ...(effortWhy === undefined ? {} : { effortWhy }),
  }

  return effort === undefined ? { decision, step } : { decision, effort, step }
}

/** Counts one reading: a model call and what it cost, or one served by the cache. */
export function addRouterUse(
  stats: AutoModelStats,
  usage: Usage | undefined,
  prices: readonly number[],
): AutoModelStats {
  if (usage === undefined) return { ...stats, routerHits: (stats.routerHits ?? 0) + 1 }

  return {
    ...stats,
    routerCalls: (stats.routerCalls ?? 0) + 1,
    routerCost: (stats.routerCost ?? 0) + weighted(usage) * (prices[0] ?? 1),
  }
}

import type {
  AutoModelDecision,
  AutoModelLayer,
  AutoModelSettings,
  AutoModelStats,
  AutoModelTier,
} from '../types'

// ---- the four models, cheapest first ----

export const MODEL_IDS: readonly [string, string, string, string] = [
  'claude-haiku-5-5',
  'claude-sonnet-5-5',
  'claude-opus-5-5',
  'claude-fable-5-1',
]

export const MODEL_NAMES: readonly [string, string, string, string] = ['Haiku', 'Sonnet', 'Opus', 'Fable']

export const OPUS: AutoModelTier = 2

export const DEFAULT_SETTINGS: AutoModelSettings = {
  isOn: true,
  ceiling: OPUS,
  isFableOn: true,
  // Relative input price per million tokens; approximations, changeable.
  prices: [1, 3, 5, 15],
  isSyncOn: false,
  mode: 'explicativo',
  opusBudget: null,
  criticals: [
    'producao', 'produção', 'deploy', 'financeiro', 'contrato', 'pagamento', 'senha', 'segurança',
    'migration', 'banco de dados', 'production', 'payment', 'security',
  ],
  dailyBaseline: 0,
  isRouterOn: true,
  effortMode: 'automatico',
  isLabelOn: true,
  isUsageOn: true,
  isUsageFooterOn: true,
  sessionTokens: 5_000_000,
  weekTokens: 40_000_000,
  strategy: 'equilibrado',
  v: 6,
}

export const EMPTY_STATS: AutoModelStats = {
  turns: 0,
  escalations: 0,
  actualCost: 0,
  opusCost: 0,
  byTier: [0, 0, 0, 0],
  routerCalls: 0,
  routerHits: 0,
  routerCost: 0,
}

// Cache write costs about 1.25x input, a cache read about 0.1x, output about 5x.
export const CACHE_WRITE = 1.25
export const CACHE_READ = 0.1
/** How sure a decision is once the Haiku read the request and confirmed it. */
export const HAIKU_CONFIRMED = 0.8
export const OUTPUT = 5

// Below this the conversation is cheap to re-cache, so the model may change freely.
export const SMALL_CONTEXT = 8000
// Past this since the last answer the prompt cache has lapsed anyway.
export const CACHE_TTL_MS = 5 * 60 * 1000

export function clampTier(n: number): AutoModelTier {
  return (n <= 0 ? 0 : n >= 3 ? 3 : Math.round(n)) as AutoModelTier
}

export function tierOfModel(model: string | undefined): AutoModelTier | undefined {
  const m = (model ?? '').toLowerCase()
  if (m.includes('haiku')) return 0
  if (m.includes('sonnet')) return 1
  if (m.includes('opus')) return 2
  if (m.includes('fable')) return 3
  return undefined
}

// ---- reading a prompt ----

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

export type Group = {
  id: string
  label: string
  weight: number
  pattern: RegExp
}

// Matched against the normalized text (lower case, no accents).
export const GROUPS: readonly Group[] = [
  {
    id: 'construir',
    label: 'construir algo',
    weight: 4,
    pattern:
      /\b(constru(a|ir|ia)|crie|criar|cria um|desenvolva|desenvolver|implemente|implementar|fa(ca|zer) um (app|site|sistema|jogo|dashboard|painel|aplicativo|mod|plugin|script|bot)|monte um|build|implement|create (a|an|the)|develop|scaffold|make (a|an) (app|site|game|dashboard|tool))\b/,
  },
  {
    id: 'arquitetura',
    label: 'arquitetura ou refatoração',
    weight: 4,
    pattern:
      /\b(refator\w*|arquitetura|reestrutur\w*|migr(e|ar|acao|ation|ate)|redesenh\w*|design system|refactor\w*|architect\w*|restructur\w*|rewrite|reescrev\w*)\b/,
  },
  {
    id: 'depurar',
    label: 'depurar ou corrigir',
    weight: 2.5,
    pattern:
      /\b(debug\w*|depur\w*|corrij\w*|corrigir|conserte|consertar|bug|erro|falha|quebrou|nao funciona|stack ?trace|exception|fix|broken|crash\w*|error|failing)\b/,
  },
  {
    id: 'planejar',
    label: 'planejar ou analisar',
    weight: 1.5,
    pattern:
      /\b(planej\w*|plano|estrategi\w*|analis\w*|compar\w*|avali\w*|pesquis\w*|investig\w*|plan|strategy|analy[sz]\w*|compare|evaluate|research|investigate|review)\b/,
  },
  {
    id: 'dificil',
    label: 'tarefa difícil',
    weight: 2.5,
    pattern:
      /\b(otimiz\w*|algoritmo|performance|desempenho|seguranca|concorrencia|race condition|prova|demonstr\w*|matematic\w*|optimi[sz]\w*|algorithm|security|concurren\w*|prove|proof|deadlock|memory leak)\b/,
  },
  {
    id: 'pergunta',
    label: 'pergunta direta',
    weight: -2,
    pattern:
      /^(quant[oa]s?|qual|quais|quando|onde|quem|o que e|que horas|how many|how much|what is|what's|which|when|where|who)\b|\b(quant[oa]s|how many)\b/,
  },
  {
    id: 'resumir',
    label: 'listar, resumir ou traduzir',
    weight: -2,
    pattern:
      /\b(liste|listar|resum\w*|traduz\w*|explique rapidamente|rapidinho|em uma frase|list|summari[sz]e|translate|briefly|tl;?dr|in one sentence)\b/,
  },
  {
    id: 'simples',
    label: 'ação simples',
    weight: -1.5,
    pattern:
      /\b(renomei\w*|mova|mover|abra|abrir|mostre|mostrar|apague|delete|rename|move|open|show|print|leia|read)\b/,
  },
]

const SHORT_REPLIES = new Set([
  'sim', 's', 'ss', 'ok', 'okay', 'blz', 'beleza', 'pode', 'pode sim', 'pode seguir', 'pode continuar',
  'continua', 'continue', 'continuar', 'segue', 'siga', 'manda', 'manda ver', 'isso', 'isso mesmo',
  'perfeito', 'otimo', 'valeu', 'obrigado', 'obrigada', 'nao', 'n', 'yes', 'y', 'go', 'go on',
  'keep going', 'go ahead', 'do it', 'sure', 'thanks', 'no', 'faz', 'faca', 'bora', 'vai',
])

const FRUSTRATION =
  /\b(nao funcionou|nao funciona|ainda nao|errado|errou|de novo|nao era isso|nao e isso|piorou|continua dando erro|didn'?t work|doesn'?t work|still broken|wrong|not what i|try again|tente de novo)\b/

const FORCE = /^\s*!(haiku|sonnet|opus|fable)\b\s*/i

export type Force = { tier: AutoModelTier; text: string }

export function readForce(text: string): Force | undefined {
  const found = FORCE.exec(text)
  if (found === null) return undefined
  const tier = tierOfModel(found[1]) ?? OPUS

  return { tier, text: text.slice(found[0].length) }
}

export function isContinuation(text: string): boolean {
  const clean = normalize(text).replace(/[.!?,;:]+/g, ' ').trim().replace(/\s+/g, ' ')
  if (clean === '') return true
  if (SHORT_REPLIES.has(clean)) return true
  const words = clean.split(' ')
  if (words.length > 3) return false

  return !GROUPS.some(g => g.weight > 0 && g.pattern.test(clean))
}

export function isFrustrated(text: string): boolean {
  return FRUSTRATION.test(normalize(text))
}

export type Features = {
  hasAttachments: boolean
}

export type Scored = {
  score: number
  confidence: number
  groups: string[]
  detail: string[]
}

export const THRESHOLDS: readonly [number, number, number] = [2.5, 5.5, 9]

export function scorePrompt(
  text: string,
  features: Features,
  bias: Readonly<Record<string, number>> = {},
  thresholds: readonly number[] = THRESHOLDS,
): Scored {
  const clean = normalize(text)
  const words = clean.split(/\s+/).filter(Boolean).length
  const detail: string[] = []
  let score = 3

  if (words < 8) {
    score -= 1
    detail.push(`pedido curto (${words} palavras): -1`)
  } else if (words > 300) {
    score += 3
    detail.push(`pedido muito longo (${words} palavras): +3`)
  } else if (words > 120) {
    score += 2
    detail.push(`pedido longo (${words} palavras): +2`)
  } else if (words > 40) {
    score += 1
    detail.push(`pedido médio (${words} palavras): +1`)
  }

  const groups: string[] = []
  for (const g of GROUPS) {
    if (!g.pattern.test(clean)) continue
    groups.push(g.id)
    const extra = bias[g.id] ?? 0
    score += g.weight + extra
    detail.push(
      `${g.label}: ${fmtSigned(g.weight)}${extra === 0 ? '' : ` (aprendido ${fmtSigned(extra)})`}`,
    )
  }

  const fences = (text.match(/```/g) ?? []).length
  if (fences >= 2) {
    score += 1.5
    detail.push('bloco de código: +1,5')
  }
  const files = (text.match(/(^|\s)@\S+|[\w-]+\/[\w./-]+\.\w+|\b[\w-]+\.(ts|tsx|js|jsx|py|go|rs|java|cs|md|json|ya?ml|sql|html|css)\b/g) ?? [])
    .length
  if (files > 0) {
    const add = Math.min(2, files * 0.5)
    score += add
    detail.push(`${files} arquivo(s) citado(s): ${fmtSigned(add)}`)
  }
  if (features.hasAttachments) {
    score += 1
    detail.push('anexo: +1')
  }
  const numbered = (text.match(/^\s*(\d+[.)]|[-*])\s+/gm) ?? []).length
  if (numbered >= 3 || /\b(depois|em seguida|por fim|and then|after that|finally|passo a passo|step by step)\b/.test(clean)) {
    score += 1
    detail.push('várias etapas: +1')
  }

  // How sure the rules are: far from a threshold, and backed by a keyword.
  const distance = Math.min(...thresholds.map(t => Math.abs(score - t)))
  let confidence = Math.min(1, distance / 1.5)
  if (groups.length === 0 && words >= 8) confidence = Math.min(confidence, 0.3)

  return { score, confidence, groups, detail }
}

export function tierOfScore(
  score: number,
  s: AutoModelSettings,
  th: readonly number[] = THRESHOLDS,
): AutoModelTier {
  const [t0 = 2.5, t1 = 5.5, t2 = 9] = th
  let tier: AutoModelTier = score < t0 ? 0 : score < t1 ? 1 : score < t2 ? 2 : 3
  if (tier === 3 && !s.isFableOn) tier = 2

  return capTier(tier, s)
}

export function capTier(tier: AutoModelTier, s: AutoModelSettings): AutoModelTier {
  const ceiling = s.isFableOn ? s.ceiling : (Math.min(s.ceiling, 2) as AutoModelTier)

  return (Math.min(tier, ceiling) as AutoModelTier)
}

export const CLASS_LABELS = ['simples', 'medio', 'complexo', 'extremo'] as const

export function tierOfLabel(label: string | undefined): AutoModelTier | undefined {
  const i = CLASS_LABELS.indexOf((label ?? '') as (typeof CLASS_LABELS)[number])

  return i < 0 ? undefined : (i as AutoModelTier)
}

// ---- the cache: is a switch worth re-caching the conversation? ----

export type CacheCheck = { isWorth: boolean; stay: number; change: number }

export function switchWorth(
  from: AutoModelTier,
  to: AutoModelTier,
  ctx: number,
  prices: readonly number[],
  steps = 3,
  output = 2000,
): CacheCheck {
  const pFrom = prices[from] ?? 1
  const pTo = prices[to] ?? 1
  const stay = pFrom * (ctx * CACHE_READ * steps + output * OUTPUT)
  const change = pTo * (ctx * CACHE_WRITE + ctx * CACHE_READ * (steps - 1) + output * OUTPUT)

  return { isWorth: change < stay * 0.9, stay, change }
}

// ---- the decision ----

export type DecideInput = {
  text: string
  hasAttachments: boolean
  settings: AutoModelSettings
  bias: Readonly<Record<string, number>>
  previous: AutoModelTier | undefined
  ctx: number
  isCacheWarm: boolean
  classified?: AutoModelTier
  at: number
  thresholds?: readonly number[]
}

export type Decided = AutoModelDecision & { needsClassifier: boolean; groups: string[] }

export const REASONS: readonly [string, string, string, string] = [
  'pergunta simples',
  'tarefa média',
  'tarefa complexa',
  'tarefa extrema',
]

function decision(
  tier: AutoModelTier,
  reason: string,
  layer: AutoModelLayer,
  scored: Scored,
  input: DecideInput,
  extra: string[] = [],
): Decided {
  return {
    tier,
    reason,
    layer,
    score: Math.round(scored.score * 10) / 10,
    confidence: Math.round(scored.confidence * 100) / 100,
    ctx: input.ctx,
    at: input.at,
    detail: [...scored.detail, ...extra],
    needsClassifier: false,
    groups: scored.groups,
  }
}

export function decide(input: DecideInput): Decided {
  const s = input.settings
  const force = readForce(input.text)
  const text = force?.text ?? input.text
  const scored = scorePrompt(text, { hasAttachments: input.hasAttachments }, input.bias, input.thresholds)

  if (force !== undefined) {
    return decision(force.tier, `forçado (!${MODEL_NAMES[force.tier].toLowerCase()})`, 'forçado', scored, input, [
      `você pediu ${MODEL_NAMES[force.tier]} com o prefixo`,
    ])
  }

  if (input.previous !== undefined && isFrustrated(text)) {
    const up = capTier(clampTier(input.previous + 1), s)
    const tier = (Math.max(up, input.previous) as AutoModelTier)
    return decision(tier, 'não funcionou, subindo', 'escalada', scored, input, [
      `sinal de que a resposta anterior não serviu: ${MODEL_NAMES[input.previous]} -> ${MODEL_NAMES[tier]}`,
    ])
  }

  if (input.previous !== undefined && !input.hasAttachments && isContinuation(text)) {
    return decision(input.previous, 'continuação', 'continuação', scored, input, [
      'resposta curta: mantém o modelo anterior para não quebrar o cache',
    ])
  }

  let tier = tierOfScore(scored.score, s, input.thresholds)
  let judged: Scored = scored
  let layer: AutoModelLayer = 'regras'
  let reason = REASONS[tier]
  let label: string | undefined
  const extra: string[] = [`pontuação ${fmtNumber(scored.score)} -> ${MODEL_NAMES[tier]}`]

  if (scored.confidence < 0.5) {
    if (input.classified === undefined) {
      return { ...decision(tier, reason, layer, scored, input, extra), needsClassifier: true }
    }
    let byModel = input.classified
    if (byModel === 3 && !s.isFableOn) byModel = 2
    tier = capTier(byModel, s)
    layer = 'haiku'
    reason = REASONS[tier]
    extra.push(`regras em dúvida (confiança ${fmtPercent(scored.confidence)}): o Haiku classificou como "${CLASS_LABELS[input.classified]}"`)
    label = CLASS_LABELS[input.classified]
    // The rules were unsure, but the Haiku read the request and settled it: that reading is the confidence shown.
    judged = { ...scored, confidence: Math.max(scored.confidence, HAIKU_CONFIRMED) }
  }

  const prev = input.previous
  if (prev !== undefined && tier < prev && input.isCacheWarm && input.ctx >= SMALL_CONTEXT) {
    const check = switchWorth(prev, tier, input.ctx, s.prices)
    if (!check.isWorth) {
      extra.push(
        `trocar ${MODEL_NAMES[prev]} -> ${MODEL_NAMES[tier]} recriaria ${fmtInt(input.ctx)} tokens de cache: custo ${fmtInt(check.change)} contra ${fmtInt(check.stay)} ficando`,
      )
      return decision(prev, `manter ${MODEL_NAMES[prev]} sai mais barato`, 'cache', judged, input, extra)
    }
    extra.push(`troca vale a pena mesmo recriando o cache (${fmtInt(check.change)} contra ${fmtInt(check.stay)})`)
  }

  const made = decision(tier, reason, layer, judged, input, extra)

  return label === undefined ? made : { ...made, label }
}

// ---- learning from the person's own choices ----

export const BIAS_LIMIT = 2
export const BIAS_STEP = 0.5

export function learn(
  bias: Readonly<Record<string, number>>,
  groups: readonly string[],
  chosen: AutoModelTier,
  guessed: AutoModelTier,
): Record<string, number> {
  if (chosen === guessed || groups.length === 0) return { ...bias }
  const step = chosen > guessed ? BIAS_STEP : -BIAS_STEP
  const next: Record<string, number> = { ...bias }
  for (const id of groups) {
    const value = (next[id] ?? 0) + step
    next[id] = Math.max(-BIAS_LIMIT, Math.min(BIAS_LIMIT, value))
  }

  return next
}

// ---- what a turn cost, and what Opus would have cost ----

export type Usage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

export function weighted(u: Usage): number {
  return u.input_tokens + u.cache_creation_input_tokens * CACHE_WRITE + u.cache_read_input_tokens * CACHE_READ + u.output_tokens * OUTPUT
}

export function contextOf(u: Usage): number {
  return u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
}

export function addTurn(
  stats: AutoModelStats,
  tier: AutoModelTier,
  u: Usage,
  prices: readonly number[],
  wasEscalated: boolean,
): AutoModelStats {
  const units = weighted(u)
  const byTier: [number, number, number, number] = [...stats.byTier]
  byTier[tier] += 1

  return {
    ...stats,
    turns: stats.turns + 1,
    escalations: stats.escalations + (wasEscalated ? 1 : 0),
    actualCost: stats.actualCost + units * (prices[tier] ?? 1),
    opusCost: stats.opusCost + units * (prices[OPUS] ?? 5),
    byTier,
  }
}

export function savingsPercent(stats: AutoModelStats): number {
  if (stats.opusCost <= 0) return 0

  return Math.max(0, Math.round((1 - stats.actualCost / stats.opusCost) * 100))
}

export function tokensSaved(stats: AutoModelStats, prices: readonly number[]): number {
  const p = prices[OPUS] ?? 5
  if (p <= 0) return 0

  return Math.max(0, Math.round((stats.opusCost - stats.actualCost) / p))
}

export function escalationRate(stats: AutoModelStats): number {
  if (stats.turns === 0) return 0

  return Math.round((stats.escalations / stats.turns) * 100)
}

// ---- the effort that goes with a tier ----

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export type Effort = (typeof EFFORTS)[number]

export function effortFor(tier: AutoModelTier, current: Effort | number | undefined): Effort | number | undefined {
  if (current === undefined || typeof current === 'number') return current
  const cap: Effort | undefined = tier === 0 ? 'low' : tier === 1 ? 'medium' : undefined
  if (cap === undefined) return current

  return EFFORTS.indexOf(current) > EFFORTS.indexOf(cap) ? cap : current
}

// ---- the config command ----

export function describeSettings(s: AutoModelSettings): string {
  return [
    `Auto Model: ${s.isOn ? 'ligado' : 'desligado'}`,
    `Teto: ${MODEL_NAMES[s.ceiling]}`,
    `Fable: ${s.isFableOn ? 'ligado (só para tarefas extremas)' : 'desligado'}`,
    `Sincronizar o seletor de modelo: ${s.isSyncOn ? 'ligado' : 'desligado'}`,
    `Preços relativos (aproximados, por milhão de tokens de entrada): Haiku ${fmtNumber(s.prices[0])} · Sonnet ${fmtNumber(s.prices[1])} · Opus ${fmtNumber(s.prices[2])} · Fable ${fmtNumber(s.prices[3])}`,
    `Modo: ${s.strategy} (economia, equilibrado ou qualidade)`,
    `Explicar cada escolha: ${s.mode === 'explicativo' ? 'ligado' : 'desligado'}`,
    `Orçamento do Opus: ${s.opusBudget === null ? 'sem limite' : `${fmtNumber(s.opusBudget)}% do mês`}`,
    `Base de um dia de plano: ${s.dailyBaseline > 0 ? fmtNumber(s.dailyBaseline) : 'automática (média do histórico)'}`,
    `Palavras críticas (mínimo Sonnet): ${s.criticals.length === 0 ? 'nenhuma' : s.criticals.join(', ')}`,
    `Roteador inteligente: ${s.isRouterOn ? 'ligado (o Haiku lê o que cada pedido exige)' : 'desligado (só as regras grátis)'}`,
    `Esforço: ${s.effortMode === 'automatico' ? 'automático (cada pedido recebe o esforço que ele exige, sem depender do seu esforço padrão)' : 'respeitar (o seu esforço padrão é o teto)'}`,
    `Rótulo do rodapé (modelo·esforço, como Haiku·baixo): ${s.isLabelOn ? 'ligado' : 'desligado'}`,
    `Uso no rodapé (a janela mais cheia, como 🟡 Sessão 78%): ${s.isUsageFooterOn ? 'ligado' : 'desligado'}`,
    'Mude com: /automodelo config teto <haiku|sonnet|opus|fable> · fable <ligar|desligar> · sincronizar <ligar|desligar> · roteador <ligar|desligar> · esforco <automatico|respeitar> · rotulo <ligar|desligar> · usorodape <ligar|desligar> · preco <modelo> <número> · base <número|auto> · criticos adicionar|remover <palavra>. Todos os comandos: /automodelo ajuda',
  ].join('\n')
}

export type Change = { settings: AutoModelSettings; text: string } | { error: string }

const ON_WORDS = new Set(['ligar', 'ligado', 'on', 'sim'])
const OFF_WORDS = new Set(['desligar', 'desligado', 'off', 'nao'])

export function applySetting(s: AutoModelSettings, words: readonly string[]): Change {
  const what = normalize(words[0] ?? '')
  const value = normalize(words[1] ?? '')

  if (what === 'teto') {
    const tier = tierOfModel(value)
    if (tier === undefined) return { error: 'Use /automodelo config teto haiku, sonnet, opus ou fable.' }
    const fable = tier === 3 ? true : s.isFableOn
    return {
      settings: { ...s, ceiling: tier, isFableOn: fable },
      text: `Teto agora é ${MODEL_NAMES[tier]}: o Auto Model nunca escolhe acima dele (o prefixo !modelo ainda vale).`,
    }
  }
  if (what === 'sincronizar' || what === 'sync') {
    if (ON_WORDS.has(value)) {
      return {
        settings: { ...s, isSyncOn: true },
        text: 'Sincronização ligada: o seletor de modelo e esforço passa a mostrar o que o Auto Model usou.',
      }
    }
    if (OFF_WORDS.has(value)) {
      return {
        settings: { ...s, isSyncOn: false },
        text: 'Sincronização desligada: o Auto Model continua trocando o modelo nos bastidores, sem mexer no seletor.',
      }
    }
    return { error: 'Use /automodelo config sincronizar ligar ou /automodelo config sincronizar desligar.' }
  }
  if (what === 'roteador' || what === 'router') {
    if (ON_WORDS.has(value)) {
      return {
        settings: { ...s, isRouterOn: true },
        text: 'Roteador ligado: cada pedido é lido pelo que ele exige, não pelas palavras. Custa uma análise curta do Haiku, e pedidos repetidos saem do cache sem custo.',
      }
    }
    if (OFF_WORDS.has(value)) {
      return {
        settings: { ...s, isRouterOn: false },
        text: 'Roteador desligado: só as regras grátis por palavras decidem, sem nenhuma chamada extra.',
      }
    }
    return { error: 'Use /automodelo config roteador ligar ou /automodelo config roteador desligar.' }
  }
  if (what === 'esforco') {
    if (value === 'automatico' || value === 'auto') {
      return {
        settings: { ...s, effortMode: 'automatico' },
        text: 'Esforço automático: cada pedido recebe o esforço que ele exige (consulta simples: baixo; trabalho grande: alto). O seu esforço padrão não manda mais na escolha.',
      }
    }
    if (value === 'respeitar' || value === 'respeito') {
      return {
        settings: { ...s, effortMode: 'respeitar' },
        text: 'Esforço respeitando o seu padrão: o Auto Model calcula o esforço de cada pedido, mas nunca passa do esforço que você escolheu.',
      }
    }
    return { error: 'Use /automodelo config esforco automatico ou /automodelo config esforco respeitar.' }
  }
  if (what === 'usorodape' || what === 'uso-rodape' || what === 'usorodapé') {
    if (ON_WORDS.has(value)) {
      return { settings: { ...s, isUsageFooterOn: true }, text: 'Uso no rodapé ligado: ao lado do modelo aparece a janela mais cheia, por exemplo 🟡 Sessão 78%.' }
    }
    if (OFF_WORDS.has(value)) {
      return { settings: { ...s, isUsageFooterOn: false }, text: 'Uso no rodapé desligado: o rodapé mostra só o modelo e o esforço.' }
    }
    return { error: 'Use /automodelo config usorodape ligar ou /automodelo config usorodape desligar.' }
  }
  if (what === 'rotulo') {
    if (ON_WORDS.has(value)) {
      return { settings: { ...s, isLabelOn: true }, text: 'Rótulo ligado: o rodapé mostra o modelo e o esforço usados, por exemplo Haiku·baixo.' }
    }
    if (OFF_WORDS.has(value)) {
      return { settings: { ...s, isLabelOn: false }, text: 'Rótulo desligado: o rodapé não mostra mais o modelo e o esforço usados.' }
    }
    return { error: 'Use /automodelo config rotulo ligar ou /automodelo config rotulo desligar.' }
  }
  if (what === 'fable') {
    if (ON_WORDS.has(value)) {
      return {
        settings: { ...s, isFableOn: true },
        text:
          s.ceiling === 3
            ? 'Fable ligado, só para tarefas extremas.'
            : 'Fable ligado, mas o teto está abaixo dele. Use /automodelo config teto fable para permitir.',
      }
    }
    if (OFF_WORDS.has(value)) {
      return {
        settings: { ...s, isFableOn: false, ceiling: (Math.min(s.ceiling, 2) as AutoModelTier) },
        text: 'Fable desligado: o mais alto que o Auto Model escolhe é o Opus.',
      }
    }
    return { error: 'Use /automodelo config fable ligar ou /automodelo config fable desligar.' }
  }
  if (what === 'preco' || what === 'price') {
    const tier = tierOfModel(value)
    const n = Number((words[2] ?? '').replace(',', '.'))
    if (tier === undefined || !Number.isFinite(n) || n <= 0) {
      return { error: 'Use /automodelo config preco <haiku|sonnet|opus|fable> <número maior que zero>.' }
    }
    const prices: [number, number, number, number] = [...s.prices]
    prices[tier] = n
    return { settings: { ...s, prices }, text: `Preço relativo do ${MODEL_NAMES[tier]} agora é ${fmtNumber(n)}.` }
  }

  if (what === 'base') {
    if (value === 'auto' || value === 'automatico' || value === 'automatica') {
      return { settings: { ...s, dailyBaseline: 0 }, text: 'Base de um dia de plano: automática, pela média do seu histórico.' }
    }
    const n = Number((words[1] ?? '').replace(',', '.'))
    if (!Number.isFinite(n) || n <= 0) return { error: 'Use /automodelo config base <número maior que zero> ou /automodelo config base auto.' }
    return { settings: { ...s, dailyBaseline: n }, text: `Base de um dia de plano agora é ${fmtNumber(n)} (custo relativo estimado).` }
  }
  if (what === 'criticos' || what === 'critico') {
    const word = words.slice(2).join(' ').trim().toLowerCase()
    if (value === '' || value === 'listar') {
      return { error: `Palavras críticas (mínimo Sonnet): ${s.criticals.length === 0 ? 'nenhuma' : s.criticals.join(', ')}` }
    }
    if (word === '') return { error: 'Use /automodelo config criticos adicionar <palavra> ou /automodelo config criticos remover <palavra>.' }
    if (value === 'adicionar' || value === 'add') {
      if (s.criticals.some(w => normalize(w) === normalize(word))) return { error: `"${word}" já está na lista.` }
      return { settings: { ...s, criticals: [...s.criticals, word] }, text: `"${word}" agora é crítica: pedidos com ela vão no mínimo para o Sonnet.` }
    }
    if (value === 'remover' || value === 'remove') {
      const left = s.criticals.filter(w => normalize(w) !== normalize(word))
      if (left.length === s.criticals.length) return { error: `"${word}" não está na lista.` }
      return { settings: { ...s, criticals: left }, text: `"${word}" saiu da lista de palavras críticas.` }
    }
    return { error: 'Use /automodelo config criticos adicionar <palavra> ou /automodelo config criticos remover <palavra>.' }
  }

  return { error: describeSettings(s) }
}

const EFFORT_NAMES: Record<string, string> = {
  low: 'baixo',
  medium: 'médio',
  high: 'alto',
  xhigh: 'muito alto',
  max: 'máximo',
}

export function effortName(effort: string | number | undefined): string | undefined {
  if (effort === undefined) return undefined
  if (typeof effort === 'number') return String(effort)

  return EFFORT_NAMES[effort] ?? effort
}

/** A few letters for tight columns. */
export function effortShort(effort: string | number | undefined): string {
  if (effort === undefined) return ''
  if (typeof effort === 'number') return String(effort)
  const short: Record<string, string> = { low: 'baixo', medium: 'médio', high: 'alto', xhigh: 'm.alto', max: 'máx' }

  return short[effort] ?? effort
}

const EFFORT_BLURBS: Record<string, string> = {
  high: 'implementação completa, com testes e documentação extensivos',
  medium: 'abordagem equilibrada, com implementação e testes padrão',
}

/**
 * The built-in /model and /effort answer in English; this says the same in
 * Portuguese. Undefined for any text it does not know, which stays as it is.
 * `byMod` is true when the Auto Model itself ran the command.
 */
export function translateCommandOutput(command: string, text: string, byMod: boolean): string | undefined {
  const clean = text.trim()
  if (command === 'model') {
    const m = /^Set model to `?([^`]+?)`? for this session only\.?$/.exec(clean)
    if (m === null) return undefined
    const name = m[1] ?? ''

    return byMod
      ? `Auto Model: modelo desta conversa ajustado para ${name}.`
      : `Modelo ajustado para ${name} (só nesta conversa).`
  }
  if (command === 'effort') {
    const m = /^Set effort level to (\w+)(?: \(this session only\))?(?:: (.*))?$/.exec(clean)
    if (m === null) return undefined
    const level = effortName(m[1]) ?? m[1] ?? ''
    if (byMod) return `Auto Model: esforço desta conversa ajustado para ${level}.`
    const blurb = EFFORT_BLURBS[m[1] ?? '']

    return `Esforço ajustado para ${level} (só nesta conversa)${blurb === undefined ? '' : `: ${blurb}`}.`
  }

  return undefined
}

export function fmtPercent(fraction: number): string {
  return `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`
}

/** One plain sentence on why, for people who do not care about scores. */
export function friendlyWhy(d: AutoModelDecision): string {
  const pct = fmtPercent(d.confidence)
  switch (d.layer) {
    case 'roteador':
      return `Confiança ${pct}: o roteador entendeu o pedido como "${d.summary ?? d.reason}"${d.isCached === true ? ' (resposta do cache, sem custo)' : ''}.`
    case 'haiku':
      return `Confiança ${pct}: o Haiku analisou e confirmou "${d.label ?? d.reason}".`
    case 'forçado':
      return `Você escolheu o ${MODEL_NAMES[d.tier]} com o prefixo.`
    case 'continuação':
      return 'Resposta curta: manteve o modelo anterior para não quebrar o cache.'
    case 'escalada':
      return 'A resposta anterior não serviu, então subiu um nível.'
    case 'cache':
      return 'Trocar para um modelo menor recriaria o cache e sairia mais caro.'
    case 'correção':
      return 'Você marcou que o modelo anterior errou, então refez um nível acima.'
    default:
      return `Confiança ${pct}: as regras locais resolveram sozinhas, sem custo.`
  }
}

export function explain(d: AutoModelDecision | undefined, isDetailed = false): string {
  if (d === undefined) return 'Ainda não há decisão nesta sessão. Envie um pedido e pergunte de novo.'
  const effort = effortName(d.effort)
  const head = `${MODEL_NAMES[d.tier]}${effort === undefined ? '' : ` · esforço ${effort}`} · ${d.reason}`

  const effortLine =
    effort === undefined ? [] : [`Esforço: ${effort} · porque ${d.effortWhy ?? 'foi o que sobrou da sua configuração'}`]

  if (!isDetailed) {
    return [head, friendlyWhy(d), ...effortLine, 'Mais detalhes: /automodelo porque detalhes'].join('\n')
  }

  return [
    `Última decisão: ${head}`,
    `Camada: ${d.layer} · ${d.layer === 'roteador' ? 'necessidade' : 'pontuação'} ${fmtNumber(d.score)} · confiança ${fmtPercent(d.confidence)} · contexto ${fmtInt(d.ctx)} tokens`,
    ...effortLine,
    ...d.detail.map(line => `- ${line}`),
    'Para forçar um modelo no próximo pedido, comece com !haiku, !sonnet, !opus ou !fable.',
  ].join('\n')
}

// ---- numbers and text ----

export function fmtInt(n: number): string {
  const whole = Math.round(n)
  const sign = whole < 0 ? '-' : ''

  return sign + String(Math.abs(whole)).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

export function fmtNumber(n: number): string {
  const rounded = Math.round(n * 10) / 10

  return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace('.', ',')
}

function fmtSigned(n: number): string {
  return (n >= 0 ? '+' : '') + fmtNumber(n)
}

export function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `${fmtNumber(n / 1_000_000)}M`
  if (n >= 10_000) return `${Math.round(n / 1000)}k`
  return fmtInt(n)
}

const GLYPHS: Record<string, readonly [string, string, string]> = {
  '0': ['┏━┓', '┃ ┃', '┗━┛'],
  '1': ['╺┓ ', ' ┃ ', '╺┻╸'],
  '2': ['╺━┓', '┏━┛', '┗━╸'],
  '3': ['╺━┓', ' ━┫', '╺━┛'],
  '4': ['╻ ╻', '┗━┫', '  ╹'],
  '5': ['┏━╸', '┗━┓', '╺━┛'],
  '6': ['┏━╸', '┣━┓', '┗━┛'],
  '7': ['╺━┓', '  ┃', '  ╹'],
  '8': ['┏━┓', '┣━┫', '┗━┛'],
  '9': ['┏━┓', '┗━┫', '╺━┛'],
  '.': [' ', ' ', '╹'],
  ',': [' ', ' ', '┛'],
  '%': ['╻ ╻', ' ┏┛', '╹ ╹'],
  k: ['╻  ', '┣┳╸', '╹┗╸'],
  M: ['┏┳┓', '┃┃┃', '╹ ╹'],
}

export function bigNumeral(text: string): [string, string, string] | undefined {
  const rows: [string, string, string] = ['', '', '']
  const chars = [...text]
  for (let i = 0; i < chars.length; i += 1) {
    const glyph = GLYPHS[chars[i] ?? '']
    if (glyph === undefined) return undefined
    const gap = i === chars.length - 1 ? '' : ' '
    rows[0] += glyph[0] + gap
    rows[1] += glyph[1] + gap
    rows[2] += glyph[2] + gap
  }

  return rows
}

export function textWidth(text: string): number {
  return [...text].length
}

export function padEnd(text: string, width: number): string {
  const chars = [...text]
  if (chars.length >= width) return chars.slice(0, Math.max(0, width)).join('')

  return text + ' '.repeat(width - chars.length)
}

export function padStart(text: string, width: number): string {
  const chars = [...text]
  if (chars.length >= width) return chars.slice(0, Math.max(0, width)).join('')

  return ' '.repeat(width - chars.length) + text
}

import type { AutoModelTier, UsageReading } from '../types'
import { fmtPct } from './round5'

// ---- usage: only what the app measured ----

/** One measured reading of the two windows, with when each resets and when it was read. */
export type Measured = {
  session: number
  week: number
  at: number
  sessionResetsAt?: string
  weekResetsAt?: string
}

/** The official windows as `$.session.usage()` or `session.measure` give them. */
export type LimitWindow = { kind: string; percentUsed: number; resetsAt?: string }

/** A reading from the windows, or null unless both windows are there: half a reading is no reading. */
export function measuredOf(windows: readonly LimitWindow[], at: number): Measured | null {
  const session = windows.find(w => w.kind === 'five_hour')
  const week = windows.find(w => w.kind === 'seven_day')
  if (session === undefined || week === undefined) return null
  if (!Number.isFinite(session.percentUsed) || !Number.isFinite(week.percentUsed)) return null

  return {
    session: session.percentUsed,
    week: week.percentUsed,
    at,
    ...(session.resetsAt === undefined ? {} : { sessionResetsAt: session.resetsAt }),
    ...(week.resetsAt === undefined ? {} : { weekResetsAt: week.resetsAt }),
  }
}

export function readingOf(m: Measured): UsageReading {
  return { session: m.session, week: m.week }
}

/** Two readings say the same thing. */
export function sameReading(a: Measured | null, b: Measured | null): boolean {
  if (a === null || b === null) return a === b

  return a.session === b.session && a.week === b.week && a.sessionResetsAt === b.sessionResetsAt && a.weekResetsAt === b.weekResetsAt
}

export type Tone = 'good' | 'accent' | 'bad'

/** Green up to 70%, gold up to 90%, red above: each window judged on its own. */
export function toneOf(pct: number): Tone {
  if (pct > 90) return 'bad'
  if (pct > 70) return 'accent'

  return 'good'
}

const TONE_RANK: Record<Tone, number> = { good: 0, accent: 1, bad: 2 }

/** The semaphore for a window: an emoji where the surface draws them, a short word on the terminal. */
export function signOf(pct: number, isTerminal: boolean): string {
  const tone = toneOf(pct)
  if (isTerminal) return tone === 'bad' ? 'crítico' : tone === 'accent' ? 'atenção' : 'ok'

  return tone === 'bad' ? '🔴' : tone === 'accent' ? '🟡' : '🟢'
}

/** Which window to show when there is room for one: the more severe, then the fuller. */
export function worstWindow(r: UsageReading): { name: 'Sessão' | 'Semana'; pct: number } {
  const ts = TONE_RANK[toneOf(r.session)]
  const tw = TONE_RANK[toneOf(r.week)]
  if (tw > ts || (tw === ts && r.week > r.session)) return { name: 'Semana', pct: r.week }

  return { name: 'Sessão', pct: r.session }
}

const WEEKDAYS = ['dom.', 'seg.', 'ter.', 'qua.', 'qui.', 'sex.', 'sáb.']

/** "em 11 min", "em 2h 05min": how long until the session window resets. */
export function sessionResetText(iso: string | undefined, now: number): string | undefined {
  if (iso === undefined) return undefined
  const ms = Date.parse(iso) - now
  if (!Number.isFinite(ms) || ms <= 0) return undefined
  const min = Math.max(1, Math.round(ms / 60_000))
  if (min < 60) return `em ${min} min`

  return `em ${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}min`
}

/** "sex., 12:00": when the week window resets, in the local time zone. */
export function weekResetText(iso: string | undefined, now: number): string | undefined {
  if (iso === undefined) return undefined
  const at = Date.parse(iso)
  if (!Number.isFinite(at) || at <= now) return undefined
  const d = new Date(at)

  return `${WEEKDAYS[d.getDay()]}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** "há 2 min": how old a reading is. */
export function ageText(at: number, now: number): string {
  const min = Math.floor(Math.max(0, now - at) / 60_000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const hours = Math.floor(min / 60)

  return hours < 48 ? `há ${hours}h` : `há ${Math.floor(hours / 24)} dias`
}

function deltaText(delta: number): string {
  return `${delta > 0 ? '+' : ''}${fmtPct(delta)}%`
}

/** One window for a line: "🟢 Sessão 38% → 39% (+1%)", or without the move when there is no reading before. */
export function windowText(name: string, to: number, from: number | undefined, isTerminal: boolean): string {
  const sign = signOf(to, isTerminal)
  const lead = isTerminal ? `${name} ${sign}` : `${sign} ${name}`
  if (from === undefined) return `${lead} ${fmtPct(to)}%`

  return `${lead} ${fmtPct(from)}% → ${fmtPct(to)}% (${deltaText(to - from)})`
}

/**
 * The usage as a plain line, for the resumo, the terminal and the status: both
 * windows, each with its own sign, and how old the reading is when it is not fresh.
 */
export function measuredLine(
  m: Measured | null,
  from: UsageReading | null,
  now: number,
  isTerminal: boolean,
): string {
  if (m === null) return 'sem leitura agora (o app ainda não informou os limites)'
  const age = now - m.at > 60_000 ? ` · medido ${ageText(m.at, now)}` : ' · medido'

  return `${windowText('Sessão', m.session, from?.session, isTerminal)} · ${windowText('Semana', m.week, from?.week, isTerminal)}${age}`
}

// ---- warnings, resets and the projection, all from measured readings ----

export const THRESHOLDS = [80, 90] as const

/** The period a window's warnings belong to: its reset time, which changes when it resets. */
export function periodOf(kind: 'session' | 'week', m: Measured): string {
  return `${kind}:${(kind === 'session' ? m.sessionResetsAt : m.weekResetsAt) ?? 'sem-reset'}`
}

/** The warnings a new reading raises, each window and each threshold once per period. */
export function newWarnings(m: Measured, warned: readonly string[]): { key: string; text: string }[] {
  const out: { key: string; text: string }[] = []
  for (const kind of ['session', 'week'] as const) {
    const pct = kind === 'session' ? m.session : m.week
    for (const t of THRESHOLDS) {
      if (pct < t) continue
      const key = `${periodOf(kind, m)}:${t}`
      if (warned.includes(key)) continue
      out.push({ key, text: `${t >= 90 ? '🔴' : '🟡'} Limite da ${kind === 'session' ? 'sessão' : 'semana'} em ${fmtPct(pct)}%` })
    }
  }

  return out
}

/** Keeps only the warnings of the periods still running, so a window that reset can warn again. */
export function keepWarned(warned: readonly string[], m: Measured): string[] {
  const alive = [periodOf('session', m), periodOf('week', m)]

  return warned.filter(k => alive.some(p => k.startsWith(`${p}:`)))
}

/** Which windows reset between two readings: the reset time moved on and the use fell. */
export function resetsBetween(before: Measured | null, after: Measured): ('session' | 'week')[] {
  if (before === null) return []
  const out: ('session' | 'week')[] = []
  const fell = (a: number, b: number) => b < a - 0.5 && (b <= 5 || b < a / 2)
  if (fell(before.session, after.session) && before.sessionResetsAt !== after.sessionResetsAt) out.push('session')
  else if (fell(before.session, after.session) && after.session <= 2) out.push('session')
  if (fell(before.week, after.week) && before.weekResetsAt !== after.weekResetsAt) out.push('week')
  else if (fell(before.week, after.week) && after.week <= 2) out.push('week')

  return out
}

/** A few recent session readings: the projection reads the pace from them. */
export type Pace = { at: number; pct: number }[]

/** Adds a reading to the pace, starting over when the window reset. */
export function addPace(pace: Pace, m: Measured): Pace {
  const last = pace[pace.length - 1]
  if (last !== undefined && m.session < last.pct - 0.5) return [{ at: m.at, pct: m.session }]
  if (last !== undefined && last.pct === m.session) return pace

  return [...pace, { at: m.at, pct: m.session }].slice(-24)
}

/**
 * Minutes until the session runs out at the pace of the last hour, only when
 * that comes before the window resets; undefined when it is not worth saying.
 */
export function projectionMinutes(pace: Pace, m: Measured, now: number): number | undefined {
  const recent = pace.filter(p => now - p.at <= 60 * 60_000)
  if (recent.length < 2) return undefined
  const first = recent[0]
  const last = recent[recent.length - 1]
  if (first === undefined || last === undefined) return undefined
  const minutes = (last.at - first.at) / 60_000
  const rise = last.pct - first.pct
  if (minutes < 2 || rise <= 0) return undefined
  const left = (100 - m.session) / (rise / minutes)
  if (!Number.isFinite(left) || left <= 0) return undefined
  const resetAt = m.sessionResetsAt === undefined ? undefined : Date.parse(m.sessionResetsAt)
  if (resetAt !== undefined && Number.isFinite(resetAt) && now + left * 60_000 >= resetAt) return undefined

  return Math.max(1, Math.round(left))
}

export function projectionText(minutes: number | undefined): string | undefined {
  if (minutes === undefined) return undefined
  const shown = minutes < 60 ? `~${minutes} min` : `~${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}min`

  return `Neste ritmo a sessão acaba em ${shown}`
}

/** What each model took of the week, in points of the weekly limit, for the week that resets at `period`. */
export type ModelShare = { period: string; pct: [number, number, number, number] }

/** Adds a measured move of the week to the model that made it, starting over when the week resets. */
export function addShare(share: ModelShare | null, period: string, tier: AutoModelTier, delta: number): ModelShare {
  const base: ModelShare = share !== null && share.period === period ? share : { period, pct: [0, 0, 0, 0] }
  if (!(delta > 0)) return base
  const pct = [...base.pct] as ModelShare['pct']
  pct[tier] = Math.round((pct[tier] + delta) * 10) / 10

  return { period, pct }
}

export function shareText(share: ModelShare | null): string | undefined {
  if (share === null) return undefined
  const names = ['Haiku', 'Sonnet', 'Opus', 'Fable']
  // Opus, Sonnet and Haiku always; Fable only when it took something.
  const parts = [2, 1, 0, 3]
    .filter(i => i < 3 || (share.pct[i] ?? 0) > 0)
    .map(i => `${names[i]} ${fmtPct(share.pct[i] ?? 0)}%`)

  return `Esta semana: ${parts.join(' · ')} (aproximado)`
}

// ---- the draft: attachments, changes that matter, and long texts ----

/** What a draft or a prompt carries besides its words. */
export type Attachments = { images: number; files: number; pasted: number; pastedLines: number; names: string[] }

export const NO_ATTACHMENTS: Attachments = { images: 0, files: 0, pasted: 0, pastedLines: 0, names: [] }

// How the composers write attached things into the draft's text: "[Image #1]",
// "[Image: source: C:\…\17.png]", "[Pasted text #2 +40 lines]", "[File: plano.pdf]".
const IMAGE_MARK = /\[(?:image|imagem|screenshot)\b[^\]]*\]/gi
const PASTED_MARK = /\[pasted text[^\]]*\]/gi
const PASTED_LINES = /\+(\d+)\s*(?:lines?|linhas?)/i
const FILE_MARK = /\[(?:file|arquivo|document|documento|pdf)\b[^\]]*\]/gi
const NAME_IN_MARK = /([\w\-. ]+\.[a-z0-9]{2,5})\]?$/i

function nameIn(mark: string): string | undefined {
  const inner = mark.replace(/^\[|\]$/g, '')
  const m = NAME_IN_MARK.exec(inner.split(/[\\/]/).pop() ?? '')

  return m?.[1]?.trim()
}

/**
 * The attachments a text and a submission carry: the marks the composer put in
 * the text, and the submission's own list where there is one. The higher count
 * of each kind wins, so the draft and the send of the same prompt agree.
 */
export function attachmentsOf(
  text: string,
  list?: readonly { type: string; filename?: string; mediaType?: string }[],
): Attachments {
  const names = new Set<string>()
  const images = text.match(IMAGE_MARK) ?? []
  const files = text.match(FILE_MARK) ?? []
  let pasted = 0
  let pastedLines = 0
  for (const m of text.matchAll(PASTED_MARK)) {
    pasted += 1
    pastedLines += Number(PASTED_LINES.exec(m[0])?.[1] ?? 0) || 0
  }
  for (const mark of [...images, ...files]) {
    const n = nameIn(mark)
    if (n !== undefined) names.add(n)
  }
  let listImages = 0
  let listFiles = 0
  for (const a of list ?? []) {
    if (a.type === 'image') listImages += 1
    else listFiles += 1
    if (a.filename !== undefined) names.add(a.filename)
  }

  return {
    images: Math.max(images.length, listImages),
    files: Math.max(files.length, listFiles),
    pasted,
    pastedLines,
    names: [...names].slice(0, 8),
  }
}

export function hasAny(a: Attachments): boolean {
  return a.images + a.files + a.pasted > 0
}

/** A short signature for the cache key and the change check. */
export function attachmentSig(a: Attachments): string {
  if (!hasAny(a)) return ''

  return `i${a.images}f${a.files}p${a.pasted}l${a.pastedLines}`
}

/** One line the router reads about the attachments. */
export function attachmentLine(a: Attachments): string | undefined {
  if (!hasAny(a)) return undefined
  const parts: string[] = []
  if (a.images > 0) parts.push(`${a.images} imagem(ns)`)
  if (a.files > 0) parts.push(`${a.files} arquivo(s)`)
  if (a.pasted > 0) parts.push(`${a.pasted} texto(s) colado(s)${a.pastedLines > 0 ? ` com ${a.pastedLines} linhas` : ''}`)
  const names = a.names.length > 0 ? ` (${a.names.join(', ')})` : ''

  return `Anexos: ${parts.join(', ')}${names}. Julgue se o pedido manda analisar, extrair ou recriar o que está nos anexos: isso aumenta raciocínio e construção.`
}

// Request and constraint sentences, in Portuguese and English: these are never
// dropped from a long text, wherever they sit in it.
const REQUEST =
  /\?|\b(crie|cria|criar|gere|gera|gerar|monte|faça|faca|fazer|construa|desenvolva|implemente|escreva|reescreva|refatore|corrija|conserte|ajuste|adicione|remova|apague|exclua|troque|mude|altere|atualize|migre|mova|copie|converta|exporte|importe|otimize|documente|integre|conecte|automatize|agende|prepare|planeje|desenhe|projete|programe|valide|depure|investigue|pesquise|busque|encontre|descubra|estime|avalie|salve|migrate|move|copy|convert|export|import|optimize|integrate|connect|automate|schedule|plan|design|implement|debug|investigate|research|find|search|estimate|evaluate|delete|analise|explique|resuma|traduza|liste|compare|revise|verifique|teste|instale|configure|publique|envie|mande|abra|leia|baixe|organize|calcule|preciso|quero|gostaria|pode|poderia|deve|devem|precisa|tem que|tenho que|não pode|nao pode|nunca|sempre|sem\b|apenas|somente|importante|obrigatório|atenção|please|need|want|must|should|make|build|create|write|fix|add|remove|change|update|explain|summarize|translate|list|compare|review|check|test|install|deploy|don't|do not|never|always|only|required)\b/i
const HEADING = /^\s*(#{1,6}\s|[A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9 ]{4,60}:?\s*$|.{2,80}:\s*$)/
const LIST_ITEM = /^\s*([-*•]|\d+[.)])\s+/

/** Splits a text into sentences and list lines, keeping code fences whole. */
export function chunksOf(text: string): string[] {
  const out: string[] = []
  let fence: string[] | undefined
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) {
      if (fence === undefined) {
        fence = [line]
      } else {
        fence.push(line)
        out.push(fence.join('\n'))
        fence = undefined
      }
      continue
    }
    if (fence !== undefined) {
      fence.push(line)
      continue
    }
    const t = line.trim()
    if (t === '') continue
    if (LIST_ITEM.test(t) || HEADING.test(t)) {
      out.push(t)
      continue
    }
    for (const s of t.split(/(?<=[.!?;])\s+(?=\S)/)) if (s.trim() !== '') out.push(s.trim())
  }
  if (fence !== undefined) out.push(fence.join('\n'))

  return out
}

export function isRequest(chunk: string): boolean {
  return REQUEST.test(chunk)
}

/** How many characters differ between two texts: what lies between their common start and end. */
export function changedChars(a: string, b: string): number {
  let start = 0
  const max = Math.min(a.length, b.length)
  while (start < max && a[start] === b[start]) start += 1
  let end = 0
  while (end < max - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end += 1

  return Math.max(a.length - start - end, b.length - start - end)
}

/** The draft as last read, to tell whether a new edit is worth another reading. */
export type DraftShot = { text: string; sig: string }

/**
 * Whether the draft changed in a way that may change the decision: different
 * attachments, a request or constraint sentence added, removed or rewritten
 * (anywhere, the middle included), or enough characters changed: 40, or 2% of
 * a short text. A comma fixed in a long text is not worth a reading; a new
 * request in its middle is.
 */
export function isMeaningfulChange(prev: DraftShot | undefined, next: DraftShot): boolean {
  if (prev === undefined) return true
  if (prev.sig !== next.sig) return true
  if (prev.text === next.text) return false
  // Punctuation, spacing and capitals alone never change what is asked.
  const plain = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  if (plain(prev.text) === plain(next.text)) return false
  const diff = changedChars(prev.text, next.text)
  const limit = Math.max(1, Math.min(40, Math.ceil(next.text.length * 0.02)))
  if (diff >= limit) return true
  const before = new Set(chunksOf(prev.text))
  const after = new Set(chunksOf(next.text))
  for (const c of after) if (!before.has(c) && isRequest(c)) return true
  for (const c of before) if (!after.has(c) && isRequest(c)) return true

  return false
}

/** Above this many characters the router reads a digest instead of the text itself. */
export const LONG_TEXT = 2500
/** How much digest one router call reads. */
export const DIGEST_CAP = 6000
/** At most this many router calls for one very long text. */
export const MAX_PARTS = 3
const EDGE = 600

/**
 * The router's input for a text, as one or more parts.
 *
 * A short text goes whole. A long one is read as a digest, never as just its
 * start and end, because a request can sit anywhere in it:
 * - the first and last ~600 characters, verbatim;
 * - every request, question or constraint sentence, every heading and list
 *   line from the middle, each cut at 300 characters;
 * - each code block as one line naming its language and size;
 * - then the other unique sentences of the middle, in order, while they fit;
 * - exact repeats and what did not fit counted ("12 trechos … omitidos");
 * - a header with the size, the request count and the attachments.
 * When the key sentences alone exceed the cap, they are split into up to three
 * parts, each read by its own call; the caller takes the highest demand of
 * each dimension, so no part's request is lost.
 */
export function routerParts(text: string, att: Attachments): string[] {
  const line = attachmentLine(att)
  if (text.length <= LONG_TEXT) return [line === undefined ? text : `${text}\n\n[${line}]`]

  const head = text.slice(0, EDGE)
  const tail = text.slice(-EDGE)
  const middle = text.slice(EDGE, Math.max(EDGE, text.length - EDGE))
  // Every unique sentence of the middle is a candidate. Requests, constraints, headings, lists and
  // code summaries go first; plain context fills the room left, in its own order; exact repeats and
  // what does not fit are counted, not sent. So a request in the middle is never lost because it
  // missed the keyword list, unless the text is mostly unique filler beyond the cap.
  type Piece = { at: number; text: string; isKey: boolean }
  const seen = new Set<string>()
  const pieces: Piece[] = []
  let repeats = 0
  let code = 0
  chunksOf(middle).forEach((c, at) => {
    if (c.startsWith('```')) {
      code += 1
      const lang = /^```(\S*)/.exec(c)?.[1] ?? ''
      pieces.push({ at, text: `[bloco de código${lang === '' ? '' : ` ${lang}`}: ${c.split('\n').length} linhas]`, isKey: true })
      return
    }
    const plain = c.toLowerCase().replace(/\s+/g, ' ')
    if (seen.has(plain)) {
      repeats += 1
      return
    }
    seen.add(plain)
    pieces.push({ at, text: c.length > 300 ? `${c.slice(0, 300)}…` : c, isKey: isRequest(c) || HEADING.test(c) || LIST_ITEM.test(c) })
  })
  const requests = chunksOf(text).filter(c => !c.startsWith('```') && isRequest(c)).length
  const header = [
    `[Pedido longo resumido: ${text.length} caracteres, ${text.split(/\r?\n/).length} linhas, ${code} bloco(s) de código, ${requests} frase(s) de pedido ou restrição${line === undefined ? '' : `. ${line}`}]`,
    '[Cada pedido listado conta, inclusive os do meio do texto; a tarefa mais exigente define as notas.]',
  ].join('\n')
  const room = DIGEST_CAP - header.length - 2 * EDGE - 200
  const keyPieces = pieces.filter(p => p.isKey)
  const keySize = keyPieces.reduce((n, p) => n + p.text.length + 1, 0)

  if (keySize <= room) {
    // One call: every key sentence, then as much plain context as fits.
    const chosen = new Set(keyPieces.map(p => p.at))
    let used = keySize
    for (const p of pieces) {
      if (p.isKey || used + p.text.length + 1 > room) continue
      chosen.add(p.at)
      used += p.text.length + 1
    }
    const kept = pieces.filter(p => chosen.has(p.at)).map(p => p.text)
    const omitted = pieces.length - kept.length + repeats
    const omittedLine = omitted > 0 ? `[… ${omitted} trecho(s) de contexto omitido(s) ou repetido(s) …]` : ''

    return [[header, `Início:\n${head}`, 'Meio:', ...kept, omittedLine, `Fim:\n${tail}`].filter(Boolean).join('\n')]
  }

  // Too many requests for one call: share the key sentences among up to three parts.
  const kept = keyPieces.map(p => p.text)
  const omitted = pieces.length - keyPieces.length + repeats
  const omittedLine = omitted > 0 ? `[… ${omitted} trecho(s) de contexto omitido(s) ou repetido(s) …]` : ''
  const parts: string[][] = [[]]
  let size = 0
  for (const k of kept) {
    const cur = parts[parts.length - 1]
    if (cur === undefined) break
    if (size + k.length > room && cur.length > 0) {
      if (parts.length >= MAX_PARTS) break
      parts.push([])
      size = 0
    }
    parts[parts.length - 1]?.push(k)
    size += k.length + 1
  }

  return parts.map((p, i) =>
    [
      header,
      `[Parte ${i + 1} de ${parts.length}]`,
      i === 0 ? `Início:\n${head}` : '',
      'Meio (pedidos, restrições, títulos e listas):',
      ...p,
      i === parts.length - 1 ? `${omittedLine}\nFim:\n${tail}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
  )
}

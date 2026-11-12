import { describe, expect, mock, test } from 'claude-code/testing'

import {
  addPace,
  addShare,
  attachmentSig,
  attachmentsOf,
  isMeaningfulChange,
  measuredLine,
  measuredOf,
  newWarnings,
  projectionMinutes,
  resetsBetween,
  routerParts,
  sessionResetText,
  shareText,
  signOf,
  toneOf,
  weekResetText,
  windowText,
  worstWindow,
} from '../hooks/round8'
import type { Measured } from '../hooks/round8'
import { mergeRoutes } from '../hooks/router'
import type { Route } from '../hooks/router'

const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const
// Tuesday 20 October 2026, noon, local time.
const NOW = new Date(2026, 9, 20, 12).getTime()
const SMALL = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

const COUNT: Route = { raciocinio: 0, construcao: 0, passos: 1, ambiguidade: 0, risco: 0, continuacao: false, resumo: 'contar e-mails', confianca: 92 }
const BUILD: Route = { raciocinio: 2, construcao: 3, passos: 2, ambiguidade: 1, risco: 0, continuacao: false, resumo: 'painel com dados ao vivo', confianca: 90 }

function judge(prompt: string): Route {
  const asked = (/Pedido:\n"""\n([\s\S]*?)\n"""/.exec(prompt)?.[1] ?? '').toLowerCase()
  if (/painel|sistema|build|refatore|deploy|migre o banco/.test(asked)) return BUILD

  return COUNT
}

type Window = { kind: string; percentUsed: number; resetsAt?: string }
type OnFn = Parameters<Parameters<typeof test>[1]>[1]

/** An engine whose limit readings come, one per call, from `readings` (the last one repeats). */
function engine(on: OnFn, readings: Window[][] = []) {
  mock.store(on)
  const clock = mock.clock(on, { now: NOW })
  const world = { prompts: [] as string[], models: [] as string[], toasts: [] as string[], usageCalls: 0, clock }
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'automodelo' } }))
  on('command.list', () => ({ value: [] }))
  on('command.run', () => ({ text: '' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => {
    const at = Math.min(world.usageCalls, Math.max(0, readings.length - 1))
    world.usageCalls += 1
    return { value: { startedAt: NOW, context: {}, rateLimits: readings[at] ?? [], cost: undefined } }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    if (e.component === 'SessionMode') return <Text>{e.props.modes.join(' & ')}</Text>
    return <Text>engine</Text>
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', (_, e) => {
    world.toasts.push(String((e as unknown as { text?: string }).text ?? ''))
    return { value: undefined }
  })
  on('model.classify', () => ({ value: 'simples' }))
  on('model.complete', (_, e) => {
    world.prompts.push(e.prompt)
    return { value: { isAnswered: true, text: JSON.stringify(judge(e.prompt)), usage: SMALL } }
  })
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('prompt.edit', (_, e) => {
    const text = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)
    return { text, cursor: e.start + e.inputText.length }
  })
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '', usage: { ...SMALL, model: 'x' } }))
  on('turn.step', async function* (_, e) {
    world.models.push(e.model)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { ...SMALL, model: e.model } }
  })

  return world
}

async function turn($: any, text: string, turnId: string) {
  const sent = await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: sent.text, turnId })
  for await (const _ of $.turn.step({ turnId, index: 0, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1 })) {
    // drain
  }
  await $.turn.complete({ turnId, answer: '', durationMs: 10, isAborted: false, reason: 'answer', usage: { ...SMALL, model: 'x' } })
}

const run = ($: any, args: string) => $.command.run({ command: 'automodelo', args, ...RUN })

const BAND = {
  plugin: 'auto-model',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 140, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const
const MODE = { plugin: 'auto-model', component: 'SessionMode', requestId: 'session-mode', props: { modes: [] as string[] } } as const

async function find($: any, mount: Record<string, unknown>, pattern: RegExp, surface: 'terminal' | 'desktop' = 'desktop') {
  const ui = await $.ui.mount({ ...mount, surface })
  const found = await ui.find({ type: 'Text', text: pattern })
  await ui.unmount()

  return found?.text as string | undefined
}

const w = (session: number, week: number, extra: { s?: string; w?: string } = {}): Window[] => [
  { kind: 'five_hour', percentUsed: session, ...(extra.s === undefined ? {} : { resetsAt: extra.s }) },
  { kind: 'seven_day', percentUsed: week, ...(extra.w === undefined ? {} : { resetsAt: extra.w }) },
]

const reading = (session: number, week: number, at = NOW, extra: Partial<Measured> = {}): Measured => ({ session, week, at, ...extra })

describe('uso: só números medidos', () => {
  test('uma leitura só vale com as duas janelas; sem leitura não aparece número', () => {
    expect(measuredOf([{ kind: 'five_hour', percentUsed: 30 }], NOW)).toBe(null)
    expect(measuredOf(w(30, 10), NOW)?.session).toBe(30)
    expect(measuredLine(null, null, NOW, false)).toBe('sem leitura agora (o app ainda não informou os limites)')
    expect(measuredLine(reading(38, 5, NOW - 3 * 60_000), null, NOW, false)).toContain('medido há 3 min')
  })

  test('a releitura depois da resposta substitui a leitura atrasada na faixa', async ($, on) => {
    // Before the request, right after it (the app has not caught up), then 4 s later.
    const world = engine(on, [w(38, 5), w(38, 5), w(39, 6)])
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await turn($, 'quantos arquivos tem nesta pasta?', 't1')
    expect(await find($, BAND, /Sessão 38% → 38% \(0%\)/)).toBeDefined()
    await world.clock.advance(4000)
    await world.clock.settle()
    expect(await find($, BAND, /🟢 Sessão 38% → 39% \(\+1%\)/)).toBeDefined()
    expect(await find($, BAND, /🟢 Semana 5% → 6% \(\+1%\)/)).toBeDefined()
  })

  test('sem leitura oficial, a faixa diz que não há leitura', async ($, on) => {
    engine(on, [[]])
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await turn($, 'quantos arquivos tem nesta pasta?', 't1')
    expect(await find($, BAND, /Uso: sem leitura agora/)).toBeDefined()
    expect(await find($, BAND, /estimado/)).toBeUndefined()
  })
})

describe('cores e sinais por janela', () => {
  test('cada janela tem a sua cor: verde até 70, dourado até 90, vermelho acima', () => {
    expect(toneOf(70)).toBe('good')
    expect(toneOf(70.1)).toBe('accent')
    expect(toneOf(90)).toBe('accent')
    expect(toneOf(90.1)).toBe('bad')
    expect(signOf(60, false)).toBe('🟢')
    expect(signOf(78, false)).toBe('🟡')
    expect(signOf(95, false)).toBe('🔴')
    expect(signOf(95, true)).toBe('crítico')
    expect(windowText('Sessão', 60, undefined, false)).toBe('🟢 Sessão 60%')
    expect(windowText('Semana', 8, 7, false)).toBe('🟢 Semana 7% → 8% (+1%)')
  })

  test('sessão em 78% e semana em 8%: a faixa pinta cada uma com o seu sinal', async ($, on) => {
    engine(on, [w(77, 8), w(78, 8)])
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await turn($, 'quantos arquivos tem nesta pasta?', 't1')
    expect(await find($, BAND, /🟡 Sessão 77% → 78%/)).toBeDefined()
    expect(await find($, BAND, /🟢 Semana 8% → 8%/)).toBeDefined()
    // The terminal uses words instead of emoji.
    expect(await find($, BAND, /Sessão atenção 77% → 78%/, 'terminal')).toBeDefined()
  })
})

describe('reinício, avisos, projeção e parte de cada modelo', () => {
  test('o horário de reinício: minutos na sessão, dia e hora na semana', () => {
    expect(sessionResetText(new Date(NOW + 11 * 60_000).toISOString(), NOW)).toBe('em 11 min')
    expect(sessionResetText(new Date(NOW + 134 * 60_000).toISOString(), NOW)).toBe('em 2h 14min')
    expect(weekResetText(new Date(2026, 9, 23, 12, 0).toISOString(), NOW)).toBe('sex., 12:00')
  })

  test('avisos de 80% e 90%, independentes por janela e uma vez por período', () => {
    const m = reading(85, 50, NOW, { sessionResetsAt: 'A', weekResetsAt: 'W' })
    const first = newWarnings(m, [])
    expect(first.map(x => x.key)).toEqual(['session:A:80'])
    expect(newWarnings(m, first.map(x => x.key))).toEqual([])
    const week = newWarnings(reading(85, 92, NOW, { sessionResetsAt: 'A', weekResetsAt: 'W' }), first.map(x => x.key))
    expect(week.map(x => x.key)).toEqual(['week:W:80', 'week:W:90'])
    // A new session period warns again.
    expect(newWarnings(reading(85, 50, NOW, { sessionResetsAt: 'B', weekResetsAt: 'W' }), first.map(x => x.key)).length).toBe(1)
  })

  test('os avisos chegam como toast, um por janela', async ($, on) => {
    const world = engine(on, [w(79, 89), w(81, 91)])
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await turn($, 'quantos arquivos tem nesta pasta?', 't1')
    // The week was already at 89% when the request started: 80% warned then, 90% now; the session once.
    expect(world.toasts.filter(t => t.includes('Limite da sessão')).length).toBe(1)
    expect(world.toasts.filter(t => t.includes('Limite da semana')).length).toBe(2)
    expect(world.toasts.filter(t => t.includes('semana em 91%')).length).toBe(1)
  })

  test('a projeção só aparece quando a sessão acaba antes de reiniciar', () => {
    const later = new Date(NOW + 5 * 3_600_000).toISOString()
    const soon = new Date(NOW + 30 * 60_000).toISOString()
    let pace = addPace([], reading(20, 5, NOW - 10 * 60_000))
    pace = addPace(pace, reading(30, 5, NOW))
    expect(projectionMinutes(pace, reading(30, 5, NOW, { sessionResetsAt: later }), NOW)).toBe(70)
    expect(projectionMinutes(pace, reading(30, 5, NOW, { sessionResetsAt: soon }), NOW)).toBeUndefined()
    expect(projectionMinutes(addPace([], reading(30, 5)), reading(30, 5), NOW)).toBeUndefined()
  })

  test('a semana conta por modelo e o reinício é percebido', () => {
    let share = addShare(null, 'W', 2, 1.5)
    share = addShare(share, 'W', 0, 0.5)
    expect(shareText(share)).toBe('Esta semana: Opus 1,5% · Sonnet 0% · Haiku 0,5% (aproximado)')
    expect(addShare(share, 'W2', 1, 1).pct).toEqual([0, 1, 0, 0])
    const before = reading(80, 40, NOW, { sessionResetsAt: 'A', weekResetsAt: 'W' })
    expect(resetsBetween(before, reading(1, 40, NOW, { sessionResetsAt: 'B', weekResetsAt: 'W' }))).toEqual(['session'])
    expect(resetsBetween(before, reading(81, 41, NOW, { sessionResetsAt: 'A', weekResetsAt: 'W' }))).toEqual([])
  })

  test('o toast de reinício e a parte de cada modelo no resumo', async ($, on) => {
    const world = engine(on, [w(80, 40, { s: 'A' }), w(82, 41, { s: 'A' }), w(2, 41, { s: 'B' }), w(3, 42, { s: 'B' })])
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await turn($, 'crie um painel meteorológico de Magé', 't1')
    await turn($, 'quantos arquivos tem nesta pasta?', 't2')
    expect(world.toasts).toContain('🔄 Sessão reiniciada: 100% livre')
    const resumo = (await run($, 'resumo')).text
    expect(resumo).toContain('Esta semana: Opus 1%')
    expect(resumo).toContain('Haiku 1%')
  })

  test('o rodapé mostra a janela mais cheia ao lado do modelo, e desliga', async ($, on) => {
    engine(on, [w(84, 10), w(85, 10)])
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await turn($, 'quantos arquivos tem nesta pasta?', 't1')
    expect(worstWindow({ session: 85, week: 10 }).name).toBe('Sessão')
    expect(worstWindow({ session: 60, week: 95 }).name).toBe('Semana')
    expect(await find($, MODE, /🟡 Sessão 85%/)).toBeDefined()
    expect((await run($, 'config usorodape desligar')).text).toContain('Uso no rodapé desligado')
    expect(await find($, MODE, /Sessão 85%/)).toBeUndefined()
  })
})

describe('prévia ao vivo: o que mostra é o que roda', () => {
  test('a prévia usa a mesma decisão do envio', async ($, on) => {
    const world = engine(on, [w(10, 5)])
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await $.prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: 'crie um painel meteorológico de Magé' })
    await world.clock.advance(800)
    await world.clock.settle()
    expect(await find($, BAND, /Próximo pedido → Opus/)).toBeDefined()
    await turn($, 'crie um painel meteorológico de Magé', 't1')
    expect(world.models[0]).toBe('claude-opus-5-5')
    // The send reused the preview's reading: one router call in all.
    expect(world.prompts.length).toBe(1)
  })

  test('quando o envio decide diferente da prévia, a faixa diz por quê', async ($, on) => {
    const world = engine(on, [w(10, 5)])
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await $.prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: 'crie um painel meteorológico de Magé' })
    await world.clock.advance(800)
    await world.clock.settle()
    await run($, 'config teto sonnet')
    await turn($, 'crie um painel meteorológico de Magé', 't1')
    expect(await find($, BAND, /mudou de Opus .* para Sonnet/)).toBeDefined()
  })

  test('texto longo: um pedido no meio não se perde', () => {
    const filler = 'Este parágrafo descreve o contexto da empresa e a história do projeto em detalhe. '.repeat(30)
    const text = `${filler}\nAlém disso, migre o banco de dados de produção para o novo servidor.\n${filler}`
    const parts = routerParts(text, attachmentsOf(text))
    expect(parts.length).toBe(1)
    expect(parts[0]).toContain('migre o banco de dados de produção')
    expect(parts[0]).toContain('Cada pedido listado conta')
    expect((parts[0] ?? '').length).toBeLessThan(text.length)
  })

  test('texto longo: o roteador recebe o pedido do meio', async ($, on) => {
    const world = engine(on, [w(10, 5)])
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const filler = 'Contexto da reunião de ontem com detalhes sobre o cliente e o histórico. '.repeat(40)
    await turn($, `${filler}\nPor favor, refatore o módulo de pagamentos inteiro.\n${filler}`, 't1')
    expect(world.prompts[0]).toContain('refatore o módulo de pagamentos')
    expect(world.models[0]).toBe('claude-opus-5-5')
  })

  test('texto muito longo: partes lidas lado a lado, vale a mais exigente', () => {
    const asks = Array.from({ length: 120 }, (_, i) => `Item ${i}: crie a tela número ${i} com validação completa.`).join('\n')
    const parts = routerParts(`${'x'.repeat(700)}\n${asks}\n${'y'.repeat(700)}`, attachmentsOf(''))
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.length).toBeLessThanOrEqual(3)
    expect(mergeRoutes([COUNT, BUILD])?.construcao).toBe(3)
    expect(mergeRoutes([COUNT, BUILD])?.resumo).toBe('painel com dados ao vivo')
  })

  test('mudança que importa: pedido novo no meio de texto longo sim, vírgula não', () => {
    const filler = 'Texto de contexto sem nada a fazer aqui, apenas a descrição do cenário atual. '.repeat(40)
    const base = `${filler}\n${filler}`
    expect(isMeaningfulChange({ text: base, sig: '' }, { text: base.replace('aqui,', 'aqui;'), sig: '' })).toBe(false)
    expect(isMeaningfulChange({ text: base, sig: '' }, { text: `${filler}\nCrie um relatório.\n${filler}`, sig: '' })).toBe(true)
    expect(isMeaningfulChange({ text: base, sig: '' }, { text: base, sig: 'i1f0p0l0' })).toBe(true)
  })

  test('anexos: marcas do rascunho e lista do envio contam igual', () => {
    const att = attachmentsOf('analise isto [Image #1] e [Pasted text #2 +40 lines] [Image: source: C:\\fotos\\17.png]')
    expect(att.images).toBe(2)
    expect(att.pasted).toBe(1)
    expect(att.pastedLines).toBe(40)
    expect(att.names).toContain('17.png')
    expect(attachmentSig(attachmentsOf('[Image #1] veja', [{ type: 'image' }]))).toBe(attachmentSig(attachmentsOf('[Image #1] veja')))
    const parts = routerParts('o que tem nesta imagem? [Image #1]', att)
    expect(parts[0]).toContain('Anexos: 2 imagem(ns)')
  })

  test('anexar ou tirar uma imagem refaz a leitura; rascunho só com anexo também tem prévia', async ($, on) => {
    const world = engine(on, [w(10, 5)])
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await $.prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: '[Image #1]' })
    await world.clock.advance(800)
    await world.clock.settle()
    expect(await find($, BAND, /Próximo pedido →/)).toBeDefined()
    const before = world.prompts.length
    await $.prompt.edit({ origin: { kind: 'composer' }, text: '[Image #1]', cursor: 10, start: 10, end: 10, inputText: ' [Image #2]' })
    await world.clock.advance(800)
    await world.clock.settle()
    expect(world.prompts.length).toBe(before + 1)
    expect(world.prompts[world.prompts.length - 1]).toContain('Anexos: 2 imagem(ns)')
  })

  test('colar um texto grande lê na hora, sem esperar a pausa', async ($, on) => {
    const world = engine(on, [w(10, 5)])
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const big = `Crie um painel completo. ${'Detalhe do requisito. '.repeat(60)}`
    await $.prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: big })
    await world.clock.settle()
    expect(world.prompts.length).toBe(1)
    expect(await find($, BAND, /Próximo pedido → Opus/)).toBeDefined()
  })

  test('modelo escolhido na faixa congela a prévia daquele rascunho', async ($, on) => {
    const world = engine(on, [w(10, 5)])
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await $.prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: 'quantos arquivos tem nesta pasta?' })
    await world.clock.advance(800)
    await world.clock.settle()
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    await ui.press({ key: 'auto-model-escolher' })
    await ui.press({ key: 'auto-model-escolher' })
    await ui.unmount()
    const before = world.prompts.length
    await $.prompt.edit({ origin: { kind: 'composer' }, text: 'quantos arquivos tem nesta pasta?', cursor: 33, start: 33, end: 33, inputText: ' e quantas subpastas existem dentro delas?' })
    await world.clock.advance(800)
    await world.clock.settle()
    expect(world.prompts.length).toBe(before)
    expect(await find($, BAND, /Próximo pedido → Sonnet \(escolhido por você\)/)).toBeDefined()
  })

  test('/automodelo prever mostra a decisão sem enviar', async ($, on) => {
    const world = engine(on, [w(10, 5)])
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const out = (await run($, 'prever crie um painel meteorológico de Magé')).text
    expect(out).toContain('Previsão do Auto Model 0.8.3')
    expect(out).toContain('Opus')
    expect(out).toContain('Motivo: painel com dados ao vivo')
    expect(world.models.length).toBe(0)
    expect((await run($, 'prever')).text).toContain('Use /automodelo prever <texto>')
    expect((await run($, 'ajuda')).text).toContain('/automodelo prever <texto>')
  })
})

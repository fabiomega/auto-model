import { describe, expect, mock, test } from 'claude-code/testing'

import {
  MIN_SAMPLES,
  accuracyText,
  afterRange,
  fmtDuration,
  fmtDurationRange,
  fmtTokens,
  forecastOf,
  noteTime,
  previewExtra,
  previewWarning,
  pushDuration,
  quantile,
  rangeOf,
  ratioOf,
  tookText,
  upsertRatio,
  windowAfterText,
} from '../hooks/round9'
import type { DurSample, RatioSample } from '../hooks/round9'
import type { Route } from '../hooks/router'

const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const
const NOW = new Date(2026, 9, 20, 12).getTime()
const SMALL = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const COUNT: Route = { raciocinio: 0, construcao: 0, passos: 1, ambiguidade: 0, risco: 0, continuacao: false, resumo: 'contar e-mails', confianca: 92 }
const EMAILS = 'quantos e-mails não lidos eu tenho hoje?'

type Window = { kind: string; percentUsed: number }
type OnFn = Parameters<Parameters<typeof test>[1]>[1]

const w = (session: number, week: number): Window[] => [
  { kind: 'five_hour', percentUsed: session },
  { kind: 'seven_day', percentUsed: week },
]

/** An engine whose limit readings come one per call (the last repeats) and whose router can be made to fail. */
function engine(on: OnFn, readings: Window[][] = []) {
  mock.store(on)
  const clock = mock.clock(on, { now: NOW })
  const world = { timeouts: [] as number[], calls: 0, fail: false, usageCalls: 0, clock }
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
    if (e.component === 'CommandOutput') return <Text>{e.props.text}</Text>
    return <Text>engine</Text>
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('model.classify', () => ({ value: 'simples' }))
  on('model.complete', (_, e) => {
    world.calls += 1
    world.timeouts.push(Number((e as unknown as { timeoutMs?: number }).timeoutMs ?? 0))
    if (world.fail) {
      return { value: { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: { ...SMALL, input_tokens: 0, output_tokens: 0 } } }
    }
    return { value: { isAnswered: true, text: JSON.stringify(COUNT), usage: SMALL } }
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
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { ...SMALL, model: e.model } }
  })

  return world
}

async function turn($: any, text: string, turnId: string, durationMs: number) {
  const sent = await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: sent.text, turnId })
  for await (const _ of $.turn.step({ turnId, index: 0, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1 })) {
    // drain
  }
  await $.turn.complete({ turnId, answer: '', durationMs, isAborted: false, reason: 'answer', usage: { ...SMALL, model: 'x' } })
}

const run = ($: any, args: string) => $.command.run({ command: 'automodelo', args, ...RUN })

const BAND = {
  plugin: 'auto-model',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

async function find($: any, mount: Record<string, unknown>, pattern: RegExp, surface: 'terminal' | 'desktop' = 'desktop') {
  const ui = await $.ui.mount({ ...mount, surface })
  const found = await ui.find({ type: 'Text', text: pattern })
  await ui.unmount()

  return found?.text as string | undefined
}

const TIMES = [60_000, 90_000, 120_000, 150_000, 180_000]

describe('1. tempo de cada resposta', () => {
  test('formato compacto', () => {
    expect(fmtDuration(8_000)).toBe('8 s')
    expect(fmtDuration(102_000)).toBe('1 min 42 s')
    expect(fmtDuration(120_000)).toBe('2 min')
    expect(fmtDuration(3_780_000)).toBe('1 h 3 min')
    expect(tookText(102_000, undefined)).toBe('⏱ levou 1 min 42 s')
    expect(tookText(190_000, { lo: 120_000, hi: 240_000 })).toBe('⏱ estimado 2–4 min · levou 3 min 10 s')
  })

  test('a faixa mostra quanto levou, e some com /automodelo tempo desligar', async ($, on) => {
    engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await turn($, EMAILS, 't1', 102_000)
    expect(await find($, BAND, /levou 1 min 42 s/)).toBe('⏱ levou 1 min 42 s')
    expect((await run($, 'tempo desligar')).text).toContain('Tempo desligado')
    expect(await find($, BAND, /levou/)).toBeUndefined()
    expect((await run($, 'tempo')).text).toContain('desligado')
    await run($, 'tempo ligar')
    expect(await find($, BAND, /levou/)).toBe('⏱ levou 1 min 42 s')
    expect((await run($, 'ajuda')).text).toContain('/automodelo tempo ligar | desligar')
    expect((await run($, 'config')).text).toContain('Tempo de cada resposta: ligado')
  })

  test('só o loop principal conta', async ($, on) => {
    engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    for (let i = 0; i < 4; i += 1) await turn($, EMAILS, `t${i}`, TIMES[i] ?? 60_000)
    // A helper agent's turn is not one of the person's requests: it adds no sample.
    await $.turn.start({ text: 'sub', turnId: 'a-t', agentId: 'a1' })
    await $.turn.complete({ turnId: 'a-t', agentId: 'a1', answer: '', durationMs: 9_000, isAborted: false, reason: 'answer', usage: { ...SMALL, model: 'x' } })
    expect((await run($, `prever ${EMAILS}`)).text).toMatch(/⏱ Tempo\s+sem histórico suficiente/)
    await turn($, EMAILS, 't4', TIMES[4] ?? 60_000)
    expect((await run($, `prever ${EMAILS}`)).text).toMatch(/⏱ Tempo\s+≈ 1–3 min/)
  })
})

describe('2. estimativa de tempo pelo histórico', () => {
  const samples = (n: number, b = '0|low|0|0|0'): DurSample[] => TIMES.slice(0, n).map((ms, i) => ({ b, ms, units: 1000 * (i + 1), at: i }))

  test('precisa de 5 pedidos parecidos e usa o meio (p25–p75)', () => {
    expect(rangeOf(samples(MIN_SAMPLES - 1), '0|low|0|0|0', 'ms')).toBeUndefined()
    const r = rangeOf(samples(5), '0|low|0|0|0', 'ms')
    expect(r).toEqual({ lo: 90_000, hi: 150_000, n: 5 })
    expect(quantile([1, 2, 3, 4, 5], 0.25)).toBe(2)
    expect(fmtDurationRange({ lo: 90_000, hi: 150_000 })).toBe('≈ 1–3 min')
    // A neighbour bucket (same model and effort) fills in when the exact one is empty.
    expect(rangeOf(samples(5, '0|low|1|0|0'), '0|low|0|1|0', 'ms')?.n).toBe(5)
    expect(pushDuration([], { b: 'x', ms: 0, units: 1, at: 0 })).toEqual([])
  })

  test('acerto do tempo: quantas vezes o real caiu dentro da faixa', () => {
    let cal = { hit: 0, total: 0 }
    expect(accuracyText(cal)).toBeUndefined()
    cal = noteTime(cal, { lo: 60_000, hi: 120_000, n: 5 }, 90_000)
    cal = noteTime(cal, { lo: 60_000, hi: 120_000, n: 5 }, 200_000)
    cal = noteTime(cal, undefined, 90_000)
    expect(cal).toEqual({ hit: 1, total: 2 })
    expect(accuracyText(cal)).toContain('acerto do tempo: 50%')
  })
})

describe('3. prever: tokens, sessão, semana e tempo', () => {
  test('sem histórico e sem leitura: diz isso, sem inventar', async ($, on) => {
    engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const out = (await run($, `prever ${EMAILS}`)).text as string
    expect(out).toContain('Previsão do Auto Model 0.8.3 · nada foi enviado')
    expect(out).toContain('● Haiku')
    expect(out).toMatch(/Tokens\s+sem histórico suficiente/)
    expect(out).toMatch(/Sessão\s+sem leitura agora/)
    expect(out).toMatch(/Semana\s+sem leitura agora/)
    expect(out).toMatch(/⏱ Tempo\s+sem histórico suficiente/)
    expect(out).toContain('mínimo 5')
  })

  test('com histórico e leituras medidas: faixas de tokens, uso antes → depois e tempo', async ($, on) => {
    // Each request moves the session one point and the week a tenth, measured.
    const readings = Array.from({ length: 12 }, (_, k) => w(10 + k, 5 + k / 10))
    engine(on, readings)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    for (let i = 0; i < 5; i += 1) await turn($, EMAILS, `t${i}`, TIMES[i] ?? 60_000)
    const out = (await run($, `prever ${EMAILS}`)).text as string
    expect(out).toMatch(/Tokens\s+~/)
    expect(out).toMatch(/Sessão\s+🟢 19% → ~20%/)
    expect(out).toMatch(/Semana\s+🟢 5,9% → ~/)
    expect(out).toMatch(/⏱ Tempo\s+≈ 1–3 min/)
    expect(out).toContain('Estimativas com base em 5 pedidos parecidos')
  })

  test('o sinal segue onde a janela termina', () => {
    expect(windowAfterText(68, { lo: 69, hi: 72 }, false).startsWith('🟡')).toBe(true)
    expect(windowAfterText(30, { lo: 31, hi: 33 }, false).startsWith('🟢')).toBe(true)
    expect(windowAfterText(89, { lo: 90, hi: 93 }, false).startsWith('🔴')).toBe(true)
    expect(windowAfterText(89, { lo: 90, hi: 93 }, true).startsWith('crítico')).toBe(true)
    expect(afterRange(99, 1, { lo: 1, hi: 5 })).toEqual({ lo: 100, hi: 100 })
    expect(fmtTokens(45_000)).toBe('45 mil')
    expect(fmtTokens(1_200_000)).toBe('1,2 mi')
  })

  test('a razão tokens → % precisa de 3 movimentos medidos', () => {
    let list: RatioSample[] = []
    list = upsertRatio(list, { id: 'a', units: 1000, ds: 1, dw: 0.1 })
    list = upsertRatio(list, { id: 'b', units: 1000, ds: 1, dw: 0.1 })
    expect(ratioOf(list)).toBeUndefined()
    list = upsertRatio(list, { id: 'c', units: 1000, ds: 1, dw: 0.1 })
    // The latest reading of a request replaces its earlier one; a reset in between drops it.
    list = upsertRatio(list, { id: 'c', units: 1000, ds: 2, dw: 0.1 })
    list = upsertRatio(list, { id: 'd', units: 1000, ds: -40, dw: 0 })
    expect(list.length).toBe(3)
    expect(Math.abs((ratioOf(list)?.session ?? 0) - 4 / 3000) < 1e-9).toBe(true)
  })

  test('o ponto da decisão sai na cor do modelo', async ($, on) => {
    engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const text = (await run($, `prever ${EMAILS}`)).text as string
    const ui = await $.ui.mount({
      plugin: 'auto-model',
      component: 'CommandOutput',
      requestId: 'out-prever',
      props: { command: 'automodelo', args: `prever ${EMAILS}`, text, isErrored: false },
      surface: 'desktop',
    })
    const dot = await ui.find({ type: 'Text', text: /^●$/ })
    const rest = await ui.find({ type: 'Text', text: /Haiku · esforço baixo/ })
    await ui.unmount()
    expect(dot?.text).toBe('●')
    expect(rest !== undefined).toBe(true)
  })
})

describe('4. roteador no prever', () => {
  test('espera 8 s no prever, mantém 2 s no envio, e o diagnóstico diz por que falhou', async ($, on) => {
    const world = engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    world.fail = true
    await turn($, EMAILS, 't1', 5_000)
    expect(world.timeouts[0]).toBe(2000)
    // The send's failure rests the router for a minute; prever still tries it, with more time.
    const out = (await run($, 'prever crie um relatório de vendas do mês')).text as string
    expect(world.timeouts[world.timeouts.length - 1]).toBe(8000)
    expect(out).toContain('o roteador não respondeu: erro da API (HTTP 529) · overloaded')
    const diag = (await run($, 'diagnostico')).text as string
    expect(diag).toContain('6) Roteador')
    expect(diag).toContain('Roteador: última falha')
    expect(diag).toContain('HTTP 529')
    world.fail = false
    const ok = (await run($, 'prever liste os arquivos desta pasta')).text as string
    expect(ok).not.toContain('regras de reserva')
  })
})

describe('5–6. prévia: tempo, parte da sessão e aviso de 90%', () => {
  test('a prévia ganha "≈ … · ~…% da sessão", e some com config previsaoextra desligar', async ($, on) => {
    const readings = Array.from({ length: 12 }, (_, k) => w(10 + k, 5 + k / 10))
    const world = engine(on, readings)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    for (let i = 0; i < 5; i += 1) await turn($, EMAILS, `t${i}`, TIMES[i] ?? 60_000)
    await $.prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: EMAILS })
    await world.clock.advance(800)
    await world.clock.settle()
    const line = await find($, BAND, /Próximo pedido →/)
    expect(line).toContain('· ≈1–3 min · ~1% da sessão')
    expect((await run($, 'config previsaoextra desligar')).text).toContain('desligada')
    expect(await find($, BAND, /da sessão/)).toBeUndefined()
    expect((await run($, 'config')).text).toContain('Previsão extra na prévia (tempo e sessão): desligada')
  })

  test('avisa antes de passar de 90% da sessão', async ($, on) => {
    // The session climbs two points per request and stands at 90% before the next one.
    const readings = Array.from({ length: 10 }, (_, k) => w(72 + 2 * k, 5))
    const world = engine(on, readings)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    for (let i = 0; i < 5; i += 1) await turn($, EMAILS, `t${i}`, TIMES[i] ?? 60_000)
    await $.prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: EMAILS })
    await world.clock.advance(800)
    await world.clock.settle()
    expect(await find($, BAND, /pode passar de 90% da sessão/)).toBe('· pode passar de 90% da sessão')
  })

  test('sem estimativas, a prévia não ganha nada', () => {
    const f = forecastOf([], [], '0|low|0|0|0', null, NOW)
    expect(previewExtra(f)).toBeUndefined()
    expect(previewWarning(f)).toBeUndefined()
  })
})

describe('7. depois da resposta: estimado e real', () => {
  test('a faixa mostra "estimado … · levou …" quando havia estimativa', async ($, on) => {
    engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    for (let i = 0; i < 5; i += 1) await turn($, EMAILS, `t${i}`, TIMES[i] ?? 60_000)
    await turn($, EMAILS, 't5', 130_000)
    expect(await find($, BAND, /estimado/)).toBe('⏱ estimado 1–3 min · levou 2 min 10 s')
    // The pane's advanced fold scores the estimates: 2 min 10 s fell inside 1 min 30 s – 2 min 30 s.
    const ui = await $.ui.mount({
      plugin: 'auto-model',
      component: 'Pane',
      requestId: 'auto-model',
      props: { title: 'Auto Model', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} },
      surface: 'desktop',
    })
    await ui.press({ key: 'advanced' })
    const line = await ui.find({ type: 'Text', text: /acerto do tempo/ })
    await ui.unmount()
    expect(line?.text).toContain('acerto do tempo: 100% (em 1 pedidos com estimativa)')
  })
})

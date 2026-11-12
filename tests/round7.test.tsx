import { describe, expect, mock, test } from 'claude-code/testing'

import { DEFAULT_SETTINGS, HAIKU_CONFIRMED, decide, friendlyWhy } from '../hooks/logic'
import { splitUnits, usageLine } from '../hooks/round5'
import type { Route } from '../hooks/router'

const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const
const NOW = new Date(2026, 9, 20, 12).getTime()
const SMALL = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
// A long conversation: most of what each request carries is history read back from the cache.
const LONG = { input_tokens: 300, output_tokens: 200, cache_read_input_tokens: 200_000, cache_creation_input_tokens: 0 }
// Big enough that leaving Opus would cost more in rebuilt cache than it saves.
const HUGE = { input_tokens: 300, output_tokens: 200, cache_read_input_tokens: 600_000, cache_creation_input_tokens: 0 }

const COUNT: Route = { raciocinio: 0, construcao: 0, passos: 1, ambiguidade: 0, risco: 0, continuacao: false, resumo: 'contar e-mails', confianca: 92 }
const BUILD: Route = { raciocinio: 2, construcao: 3, passos: 2, ambiguidade: 1, risco: 0, continuacao: false, resumo: 'painel com dados ao vivo', confianca: 90 }

function judge(prompt: string): Route {
  const asked = (/Pedido:\n"""\n([\s\S]*?)\n"""/.exec(prompt)?.[1] ?? '').toLowerCase()
  if (/painel|sistema|build|refatore|deploy/.test(asked)) return BUILD

  return COUNT
}

type OnFn = Parameters<Parameters<typeof test>[1]>[1]
type Options = { isPlaced?: boolean | 'never'; windows?: { kind: string; percentUsed: number }[]; usage?: typeof SMALL }

function engine(on: OnFn, options: Options = {}) {
  mock.store(on)
  const clock = mock.clock(on, { now: NOW })
  const world = { opened: 0, toasts: [] as string[], clock }
  const usage = options.usage ?? SMALL
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'automodelo' } }))
  on('command.list', () => ({ value: [] }))
  on('command.run', () => ({ text: '' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: {}, rateLimits: options.windows ?? [], cost: undefined } }))
  on('ui.open', async () => {
    world.opened += 1
    if (options.isPlaced === 'never') await new Promise(() => undefined)
    return { value: { isPlaced: options.isPlaced !== false } }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', (_, e) => {
    world.toasts.push(String((e as unknown as { text?: string }).text ?? ''))
    return { value: undefined }
  })
  on('model.classify', () => ({ value: 'simples' }))
  on('model.complete', (_, e) => ({ value: { isAnswered: true, text: JSON.stringify(judge(e.prompt)), usage: SMALL } }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('prompt.edit', (_, e) => {
    const text = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)
    return { text, cursor: e.start + e.inputText.length }
  })
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '', usage: { ...usage, model: 'x' } }))
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { ...usage, model: e.model } }
  })

  return { world, usage }
}

async function turn($: any, text: string, turnId: string, usage: typeof SMALL, options: { edit?: boolean } = {}) {
  const sent = await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: sent.text, turnId })
  if (options.edit === true) await $.tool.call({ tool: 'Edit', file_path: '/app/index.ts', old_string: 'a', new_string: 'b' })
  for await (const _ of $.turn.step({ turnId, index: 0, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1 })) {
    // drain
  }
  await $.turn.complete({ turnId, answer: '', durationMs: 10, isAborted: false, reason: 'answer', usage: { ...usage, model: 'x' } })
}

const run = ($: any, args: string) => $.command.run({ command: 'automodelo', args, ...RUN })

const BAND = {
  plugin: 'auto-model',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const
const PANE = {
  plugin: 'auto-model',
  component: 'Pane',
  requestId: 'auto-model',
  props: { title: 'Auto Model', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

describe('1. /automodelo diz quando o painel não coube', () => {
  test('painel colocado: confirma e mostra a versão', async ($, on) => {
    engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const out = await run($, '')
    expect(out.text).toContain('Painel do Auto Model aberto (versão 0.8.3)')
  })
  test('painel que não coube: explica e sugere o resumo', async ($, on) => {
    engine(on, { isPlaced: false })
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const out = await run($, '')
    expect(out.text).toContain('não coube nesta janela')
    expect(out.text).toContain('/automodelo resumo')
    expect((await run($, 'diagnostico')).text).toContain('não coube na janela')
  })
  test('o app demora a responder: o comando responde mesmo assim', async ($, on) => {
    const { world } = engine(on, { isPlaced: 'never' })
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const pending = run($, '')
    await world.clock.advance(1300)
    const out = await pending
    expect(out.text).toContain('Painel do Auto Model aberto')
    expect((await run($, 'diagnostico')).text).toContain('o app não respondeu a tempo')
  })
})

describe('2. a faixa mostra e oculta o painel (0.8.3)', () => {
  test('"Mostrar painel" abre o painel e o botão vira "Ocultar painel"', async ($, on) => {
    const { world } = engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await turn($, 'quantos e-mails não lidos eu tenho hoje?', 't1', SMALL)
    const before = world.opened
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect((await ui.find({ type: 'Button', label: /Mostrar painel/ })) !== undefined).toBe(true)
    await ui.press({ key: 'auto-model-painel' })
    expect(world.opened).toBe(before + 1)
    expect((await ui.find({ type: 'Button', label: /Ocultar painel/ })) !== undefined).toBe(true)
    await ui.press({ key: 'auto-model-painel' })
    expect((await ui.find({ type: 'Button', label: /Mostrar painel/ })) !== undefined).toBe(true)
    await ui.unmount()
  })
})

describe('3. /automodelo resumo', () => {
  test('versão, economia, uso, modelos e as últimas decisões, em texto', async ($, on) => {
    engine(on, { windows: [{ kind: 'five_hour', percentUsed: 30 }, { kind: 'seven_day', percentUsed: 10 }] })
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const empty = await run($, 'resumo')
    expect(empty.text).toContain('Auto Model 0.8.3')
    expect(empty.text).toContain('- nenhuma ainda')
    await turn($, 'quantos e-mails não lidos eu tenho hoje?', 't1', SMALL)
    await turn($, 'crie um painel meteorológico de Magé', 't2', SMALL)
    const out = await run($, 'resumo')
    expect(out.text).toContain('Economia:')
    expect(out.text).toContain('Uso: 🟢 Sessão')
    expect(out.text).toContain('medido')
    expect(out.text).toMatch(/Por modelo: .*Haiku \d+%/)
    const decisions = out.text.split('\n').filter(l => l.startsWith('- '))
    expect(decisions.length).toBe(2)
    expect(decisions[0]).toContain('painel com dados ao vivo')
    expect((await run($, 'ajuda')).text).toContain('/automodelo resumo')
  })
})

describe('4. diagnóstico: versão, painel e origem do uso', () => {
  test('sem os limites oficiais, diz por que o uso é estimado', async ($, on) => {
    engine(on, { windows: [{ kind: 'five_hour', percentUsed: 30 }] })
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    expect((await run($, 'diagnostico')).text).toContain('Ainda não leu os limites')
    await turn($, 'quantos e-mails não lidos eu tenho hoje?', 't1', SMALL)
    const out = (await run($, 'diagnostico')).text
    expect(out).toContain('versão 0.8.3')
    expect(out).toContain('informou só five_hour')
    // 0.7.0: no invented figure; the last measured reading stands.
    expect(out).toContain('fica valendo a última leitura medida')
    expect(out).toContain('Nenhuma leitura medida guardada ainda.')
    expect(out).toContain('O painel ainda não foi aberto nesta sessão.')
  })
  test('com os dois limites, diz que o uso é medido', async ($, on) => {
    engine(on, { windows: [{ kind: 'five_hour', percentUsed: 30 }, { kind: 'seven_day', percentUsed: 10 }] })
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await turn($, 'quantos e-mails não lidos eu tenho hoje?', 't1', SMALL)
    const diag = (await run($, 'diagnostico')).text
    expect(diag).toContain('o app informou five_hour, seven_day')
    expect(diag).toContain('sessão 30%, semana 10%')
  })
})

describe('5. confiança coerente', () => {
  test('quando o Haiku confirma, a confiança é a dele e a frase diz isso', () => {
    const input = {
      text: 'faz aquilo',
      hasAttachments: false,
      settings: DEFAULT_SETTINGS,
      bias: {},
      previous: undefined,
      ctx: 0,
      isCacheWarm: false,
      at: 0,
      thresholds: undefined as unknown as number[],
    }
    const unsure = decide(input as never)
    expect(unsure.needsClassifier).toBe(true)
    const confirmed = decide({ ...input, classified: 0 } as never)
    expect(confirmed.layer).toBe('haiku')
    expect(confirmed.confidence).toBeGreaterThanOrEqual(HAIKU_CONFIRMED)
    const why = friendlyWhy(confirmed as never)
    expect(why).toContain('o Haiku analisou e confirmou')
    expect(why).not.toContain('regras ficaram em dúvida')
  })
})

describe('6. uso estimado separa o pedido do histórico', () => {
  test('a conta e a linha', () => {
    const parts = splitUnits(LONG, { cacheRead: 0.1, cacheWrite: 1.25, output: 5 })
    expect(parts.request).toBe(300 + 200 * 5)
    expect(parts.history).toBe(20_000)
    const line = usageLine({
      source: 'estimado',
      from: { session: 10, week: 2 },
      to: { session: 10.4, week: 2.1 },
      split: { request: 0.03, history: 0.4 },
    })
    expect(line).toContain('pedido +0%')
    expect(line).toContain('histórico reenviado +0,4%')
    // Measured numbers are shown as they came, with no split.
    expect(usageLine({ source: 'medido', from: { session: 10, week: 2 }, to: { session: 11, week: 2 }, split: { request: 1, history: 1 } })).not.toContain('histórico')
  })
  // 0.7.0: estimates are gone from the band; without an official reading it says so.
  test('na faixa, sem leitura oficial não aparece número inventado', async ($, on) => {
    engine(on, { usage: LONG })
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await turn($, 'quantos e-mails não lidos eu tenho hoje?', 't1', LONG)
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    const none = await ui.find({ type: 'Text', text: /Uso: sem leitura agora/ })
    const invented = await ui.find({ type: 'Text', text: /estimado|histórico reenviado/ })
    await ui.unmount()
    expect(none !== undefined).toBe(true)
    expect(invented === undefined).toBe(true)
  })
})

describe('7. a versão aparece', () => {
  test('no painel, embaixo do título', async ($, on) => {
    engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const found = await ui.find({ type: 'Text', text: /versão 0.8.3/ })
    await ui.unmount()
    expect(found !== undefined).toBe(true)
  })
})

describe('8. a prévia diz modelo, esforço e o que entendeu', () => {
  test('mesmo sem o modo explicativo', async ($, on) => {
    const { world } = engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await run($, 'explicar desligar')
    await $.prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: 'quantos e-mails não lidos eu tenho hoje?' })
    await world.clock.advance(800)
    await world.clock.settle()
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    const found = await ui.find({ type: 'Text', text: /Próximo pedido → Haiku · esforço baixo · contar e-mails · 92%/ })
    await ui.unmount()
    expect(found !== undefined).toBe(true)
  })
})

describe('teste: lido como conversa nova', () => {
  test('numa conversa longa no Opus, o pedido simples ainda aparece no Haiku, com a nota desta conversa', async ($, on) => {
    engine(on, { usage: HUGE })
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await turn($, 'crie um painel meteorológico de Magé', 't1', HUGE, { edit: true })
    const out = await run($, 'teste')
    const first = out.text.split('\n').find(l => l.startsWith('- quantos arquivos')) ?? ''
    expect(first).toContain('→ Haiku·')
    expect(first).toContain('nesta conversa: Opus')
  })
})

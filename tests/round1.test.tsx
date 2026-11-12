import { describe, expect, mock, test } from 'claude-code/testing'

import { explain, fmtPercent } from '../hooks/logic'

const USAGE = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const

type OnFn = Parameters<Parameters<typeof test>[1]>[1]

type World = {
  models: string[]
  efforts: (string | number | undefined)[]
  commands: { command: string; args: string }[]
  submitted: { text: string; origin: unknown }[]
  clock: ReturnType<typeof mock.clock>
}

function engine(on: OnFn, options: { sessionModel?: string; hasEffort?: boolean } = {}): World {
  const world: World = { models: [], efforts: [], commands: [], submitted: [], clock: mock.clock(on) }
  mock.store(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'automodelo' } }))
  on('command.list', () => ({
    value: options.hasEffort === true ? [{ name: 'effort', description: 'effort', source: 'builtin' }] : [],
  }))
  on('command.run', (_, e) => {
    world.commands.push({ command: e.command, args: e.args })
    return { text: '' }
  })
  on('session.model', () => ({ value: options.sessionModel ?? 'claude-opus-5-5' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('model.classify', () => ({ value: 'simples' }))
  on('prompt.submit', (_, e) => {
    world.submitted.push({ text: e.text, origin: e.origin })
    return { text: e.text }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '', usage: { ...USAGE, model: 'x' } }))
  on('turn.step', async function* (_, e) {
    world.models.push(e.model)
    world.efforts.push(e.effort)
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn',
      usage: { ...USAGE, model: e.model },
    }
  })
  return world
}

async function turn($: any, text: string, turnId: string, origin: unknown = { kind: 'composer' }) {
  const sent = await $.prompt.submit({ text, wait: false, origin })
  await $.turn.start({ text: sent.text, turnId })
  const stream = $.turn.step({ turnId, index: 0, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1 })
  for await (const _ of stream) {
    // drain
  }
  await $.turn.complete({
    turnId,
    answer: '',
    durationMs: 10,
    isAborted: false,
    reason: 'answer',
    usage: { ...USAGE, model: 'x' },
  })
  return sent
}

const DECISION = {
  tier: 0,
  reason: 'pergunta simples',
  layer: 'haiku',
  score: 4,
  confidence: 0.3,
  ctx: 0,
  at: 0,
  detail: ['anexo: +1'],
  label: 'simples',
} as const

describe('explicação amigável', () => {
  test('confiança em porcentagem', () => {
    expect(fmtPercent(0.3)).toBe('30%')
    expect(fmtPercent(1)).toBe('100%')
    expect(fmtPercent(0.456)).toBe('46%')
  })
  test('porque mostra duas linhas simples; detalhes mostra tudo', () => {
    const short = explain(DECISION)
    expect(short.split('\n')[0]).toBe('Haiku · pergunta simples')
    expect(short).toContain('Confiança 30%: o Haiku analisou e confirmou "simples".')
    expect(short.includes('pontuação')).toBe(false)
    const long = explain(DECISION, true)
    expect(long).toContain('confiança 30%')
    expect(long).toContain('pontuação 4')
    expect(long).toContain('- anexo: +1')
  })
})

test('/automodelo porque e porque detalhes', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await turn($, 'quantos arquivos tem aqui?', 't1')
  const short = await $.command.run({ command: 'automodelo', args: 'porque', ...RUN })
  expect(short.text).toContain('Haiku')
  expect(short.text).toContain('Confiança')
  expect(short.text.includes('Camada:')).toBe(false)
  const long = await $.command.run({ command: 'automodelo', args: 'porque detalhes', ...RUN })
  expect(long.text).toContain('Camada:')
  expect(long.text).toContain('%')
})

describe('seletor sincronizado', () => {
  test('depois do turno, /model muda para o modelo que o mod usou', async ($, on) => {
    const world = engine(on, { sessionModel: 'claude-opus-5-5' })
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await $.command.run({ command: 'automodelo', args: 'config sincronizar ligar', ...RUN })
    await turn($, 'quantos arquivos tem aqui?', 't1')
    await world.clock.settle()
    expect(world.models).toEqual(['claude-haiku-5-5'])
    expect(world.commands).toEqual([{ command: 'model', args: 'claude-haiku-5-5' }])
  })
  test('nada a fazer quando o seletor já mostra o modelo usado', async ($, on) => {
    const world = engine(on, { sessionModel: 'claude-haiku-5-5' })
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await turn($, 'quantos arquivos tem aqui?', 't1')
    await world.clock.settle()
    expect(world.commands).toEqual([])
  })
  test('sincronizar desligado não mexe no seletor', async ($, on) => {
    const world = engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const off = await $.command.run({ command: 'automodelo', args: 'config sincronizar desligar', ...RUN })
    expect(off.text).toContain('desligada')
    await turn($, 'quantos arquivos tem aqui?', 't1')
    await world.clock.settle()
    expect(world.commands.filter(c => c.command === 'model')).toEqual([])
  })
  test('esforço sincroniza só quando o comando /effort existe', async ($, on) => {
    const world = engine(on, { hasEffort: true })
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await $.command.run({ command: 'automodelo', args: 'config sincronizar ligar', ...RUN })
    await turn($, 'quantos arquivos tem aqui?', 't1')
    await world.clock.settle()
    expect(world.efforts).toEqual(['low'])
    expect(world.commands).toEqual([
      { command: 'model', args: 'claude-haiku-5-5' },
      { command: 'effort', args: 'low' },
    ])
  })
  test('sem /effort, o esforço muda só nos bastidores', async ($, on) => {
    const world = engine(on, { hasEffort: false })
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await turn($, 'quantos arquivos tem aqui?', 't1')
    await world.clock.settle()
    expect(world.efforts).toEqual(['low'])
    expect(world.commands.some(c => c.command === 'effort')).toBe(false)
  })
  test('o esforço do Opus vem do pedido, não do que o seletor mostra depois de um Haiku baixo', async ($, on) => {
    const world = engine(on, { hasEffort: true })
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await $.command.run({ command: 'automodelo', args: 'config sincronizar ligar', ...RUN })
    await turn($, 'quantos arquivos tem aqui?', 't1')
    await world.clock.settle()
    // The picker now says "low" (the mod wrote it); the Opus turn is sized by its own request: high.
    const sent = await $.prompt.submit({ text: 'Construa um dashboard de clima para Nova York', wait: false, origin: { kind: 'composer' } })
    await $.turn.start({ text: sent.text, turnId: 't2' })
    const stream = $.turn.step({ turnId: 't2', index: 0, model: 'claude-haiku-5-5', effort: 'low', messageCount: 3 })
    for await (const _ of stream) {
      // drain
    }
    expect(world.models[1]).toBe('claude-opus-5-5')
    expect(world.efforts[1]).toBe('high')
  })
})

const BAND = {
  plugin: 'auto-model',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

describe('Esse modelo errou', () => {
  test('a faixa aparece depois de um turno escolhido e refaz um nível acima', async ($, on) => {
    const world = engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await turn($, 'quantos arquivos tem aqui?', 't1')

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...BAND, surface })
      expect((await ui.find({ type: 'Text', text: /● Haiku · esforço baixo/ })) !== undefined).toBe(true)
      await ui.unmount()
    }

    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    await ui.press({ key: 'auto-model-errou' })
    await ui.unmount()
    const again = world.submitted[world.submitted.length - 1]
    expect(again?.text).toBe('quantos arquivos tem aqui?')

    // The resubmitted prompt runs one tier up, with no "!" prefix shown.
    await $.turn.start({ text: again?.text ?? '', turnId: 't2' })
    const stream = $.turn.step({ turnId: 't2', index: 0, model: 'claude-opus-5-5', effort: 'medium', messageCount: 3 })
    for await (const _ of stream) {
      // drain
    }
    expect(world.models[1]).toBe('claude-sonnet-5-5')
    const why = await $.command.run({ command: 'automodelo', args: 'porque', ...RUN })
    expect(why.text).toContain('Sonnet')
    expect(why.text).toContain('errou')
  })
  test('a faixa some no próximo pedido e com Ocultar; não aparece em turno forçado', async ($, on) => {
    engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await turn($, 'quantos arquivos tem aqui?', 't1')
    let ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    await ui.press({ key: 'auto-model-ocultar' })
    expect((await ui.find({ type: 'Text', text: /● Haiku/ })) === undefined).toBe(true)
    await ui.unmount()

    await turn($, '!opus quantos arquivos tem aqui?', 't2')
    ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect((await ui.find({ type: 'Text', text: /● (Haiku|Sonnet|Opus)/ })) === undefined).toBe(true)
    await ui.unmount()
  })
})

const PANE = {
  plugin: 'auto-model',
  component: 'Pane',
  requestId: 'auto-model',
  props: {
    title: 'Auto Model',
    isFocused: false,
    bodyColumns: 120,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

test('no desktop os números grandes são texto, sem desenho de caixa', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await turn($, 'quantos arquivos tem aqui?', 't1')

  const desktop = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await desktop.find({ type: 'Text', text: /[┏┓┗┛┃╺╸┫┣┻┳]/ })) === undefined).toBe(true)
  expect((await desktop.find({ type: 'Text', text: /^\d+%$/ })) !== undefined).toBe(true)
  expect((await desktop.find({ type: 'Text', text: /^\s*\d+%$/ })) !== undefined).toBe(true)
  await desktop.unmount()

  const terminal = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await terminal.find({ type: 'Text', text: /[┏┓┗┛┃]/ })) !== undefined).toBe(true)
  await terminal.unmount()
})

import { describe, expect, mock, test } from 'claude-code/testing'

import {
  DEFAULT_SETTINGS,
  decide,
  isContinuation,
  learn,
  readForce,
  scorePrompt,
  switchWorth,
  tierOfScore,
} from '../hooks/logic'

const S = DEFAULT_SETTINGS

function tierOf(text: string) {
  return tierOfScore(scorePrompt(text, { hasAttachments: false }).score, S)
}

const BASE = {
  hasAttachments: false,
  settings: S,
  bias: {},
  previous: undefined,
  ctx: 0,
  isCacheWarm: false,
  at: 0,
}

describe('regras locais', () => {
  test('perguntas simples vão para o Haiku, em pt-BR e inglês', () => {
    expect(tierOf('quantos e-mails não lidos tenho no Gmail?')).toBe(0)
    expect(tierOf('how many unread emails do I have?')).toBe(0)
    expect(tierOf('resuma este parágrafo em uma frase')).toBe(0)
  })
  test('construir e refatorar vão para o Opus', () => {
    expect(tierOf('Construa um dashboard de clima para Nova York')).toBe(2)
    expect(tierOf('Refatore a arquitetura do módulo de pagamentos e migre para o novo banco')).toBe(2)
    expect(tierOf('build me a weather dashboard for New York City')).toBe(2)
  })
  test('o Fable só aparece com teto fable', () => {
    const hard =
      'Refatore a arquitetura, otimize o algoritmo de concorrência, corrija o race condition e construa um sistema novo ```ts\nx\n``` depois migre tudo'
    expect(tierOf(hard)).toBe(2)
    expect(tierOfScore(scorePrompt(hard, { hasAttachments: false }).score, { ...S, ceiling: 3 })).toBe(3)
    expect(tierOfScore(scorePrompt(hard, { hasAttachments: false }).score, { ...S, ceiling: 3, isFableOn: false })).toBe(2)
  })
  test('pedidos sem palavra-chave ficam com confiança baixa', () => {
    const scored = scorePrompt('me fale sobre aquela coisa que conversamos ontem à tarde no escritório', {
      hasAttachments: false,
    })
    expect(scored.confidence < 0.5).toBe(true)
  })
})

describe('continuação, prefixo e frustração', () => {
  test('resposta curta mantém o modelo anterior', () => {
    expect(isContinuation('sim')).toBe(true)
    expect(isContinuation('pode continuar')).toBe(true)
    expect(isContinuation('keep going')).toBe(true)
    expect(isContinuation('construa um site')).toBe(false)
    const d = decide({ ...BASE, text: 'ok', previous: 2 })
    expect(d.tier).toBe(2)
    expect(d.layer).toBe('continuação')
  })
  test('prefixo força o modelo e é removido', () => {
    const f = readForce('!haiku construa um sistema enorme')
    expect(f?.tier).toBe(0)
    expect(f?.text).toBe('construa um sistema enorme')
    const d = decide({ ...BASE, text: '!opus quantos arquivos tem aqui?' })
    expect(d.tier).toBe(2)
    expect(d.layer).toBe('forçado')
  })
  test('"não funcionou" sobe um nível', () => {
    const d = decide({ ...BASE, text: 'não funcionou, ainda dá erro', previous: 1 })
    expect(d.tier).toBe(2)
    expect(d.layer).toBe('escalada')
  })
  test('aprender ajusta o peso e respeita o limite', () => {
    let bias: Record<string, number> = {}
    for (let i = 0; i < 10; i += 1) bias = learn(bias, ['pergunta'], 2, 0)
    expect(bias.pergunta).toBe(2)
  })
})

describe('cache', () => {
  test('contexto grande e cache quente: não troca Opus por Sonnet', () => {
    expect(switchWorth(2, 1, 80000, S.prices).isWorth).toBe(false)
    const d = decide({ ...BASE, text: 'analise este relatório e compare as duas opções de fornecedores', previous: 2, ctx: 80000, isCacheWarm: true })
    expect(d.tier).toBe(2)
    expect(d.layer).toBe('cache')
  })
  test('contexto pequeno: troca livre', () => {
    const d = decide({ ...BASE, text: 'quantos arquivos tem aqui?', previous: 2, ctx: 3000, isCacheWarm: true })
    expect(d.tier).toBe(0)
  })
  test('cache frio: troca livre mesmo com contexto grande', () => {
    const d = decide({ ...BASE, text: 'quantos arquivos tem aqui?', previous: 2, ctx: 90000, isCacheWarm: false })
    expect(d.tier).toBe(0)
  })
})

const USAGE = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

type OnFn = Parameters<Parameters<typeof test>[1]>[1]

function engine(on: OnFn, models: string[]) {
  mock.store(on)
  mock.clock(on)
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'automodelo' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('model.classify', () => ({ value: 'simples' }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '', usage: { ...USAGE, model: 'x' } }))
  on('tool.call', () => ({ result: {}, isError: true, text: 'falhou' }))
  on('turn.step', async function* (_, e) {
    models.push(e.model)
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn',
      usage: { ...USAGE, model: e.model },
    }
  })
}

async function step($: any, turnId: string, index: number, agentId?: string) {
  const stream = $.turn.step({ turnId, index, model: 'claude-opus-5-5', messageCount: 1, ...(agentId ? { agentId } : {}) })
  for await (const _ of stream) {
    // drain
  }
  return stream.result
}

async function ask($: any, text: string, turnId: string) {
  const sent = await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: sent.text, turnId })
  return sent
}

test('o turno inteiro usa o modelo escolhido, só no loop principal', async ($, on) => {
  const models: string[] = []
  engine(on, models)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const sent = await ask($, 'quantos e-mails não lidos tenho?', 't1')
  expect(sent.text).toBe('quantos e-mails não lidos tenho?')
  await step($, 't1', 0)
  await step($, 't1', 1)
  await step($, 't1', 2, 'agente-1')
  expect(models).toEqual(['claude-haiku-5-5', 'claude-haiku-5-5', 'claude-opus-5-5'])
})

test('o prefixo é removido do texto e força o modelo', async ($, on) => {
  const models: string[] = []
  engine(on, models)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const sent = await ask($, '!sonnet quantos arquivos tem aqui?', 't1')
  expect(sent.text).toBe('quantos arquivos tem aqui?')
  await step($, 't1', 0)
  expect(models).toEqual(['claude-sonnet-5-5'])
})

test('três erros de ferramenta sobem um nível no resto do turno', async ($, on) => {
  const models: string[] = []
  engine(on, models)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  await ask($, 'quantos arquivos tem aqui?', 't1')
  await step($, 't1', 0)
  for (let i = 0; i < 3; i += 1) await $.tool.call({ tool: 'Bash', command: 'ls' })
  await step($, 't1', 1)
  expect(models).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5'])
})

test('desligado, não troca nada; os comandos respondem', async ($, on) => {
  const models: string[] = []
  engine(on, models)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  const off = await $.command.run({ command: 'automodelo', args: 'desligar', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  expect(off.text).toContain('desligado')
  await ask($, 'quantos arquivos tem aqui?', 't1')
  await step($, 't1', 0)
  expect(models).toEqual(['claude-opus-5-5'])

  const cfg = await $.command.run({ command: 'automodelo', args: 'config teto sonnet', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  expect(cfg.text).toContain('Sonnet')
  await $.command.run({ command: 'automodelo', args: 'ligar', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  await ask($, 'construa um site completo para a minha empresa', 't2')
  await step($, 't2', 0)
  expect(models[1]).toBe('claude-sonnet-5-5')
  const why = await $.command.run({ command: 'automodelo', args: 'porque', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
  expect(why.text).toContain('Sonnet · esforço alto · tarefa média')
})

const PANE = {
  plugin: 'auto-model',
  component: 'Pane',
  requestId: 'auto-model',
  props: {
    title: 'Auto Model',
    isFocused: false,
    bodyColumns: 32,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

test('o painel desenha em largura estreita e larga, nos dois lugares', async ($, on) => {
  const models: string[] = []
  engine(on, models)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await ask($, 'quantos arquivos tem aqui?', 't1')
  await step($, 't1', 0)
  await $.turn.complete({ turnId: 't1', answer: '', durationMs: 10, isAborted: false, reason: 'answer', usage: { ...USAGE, model: 'claude-haiku-5-5' } })

  for (const surface of ['terminal', 'desktop'] as const) {
    for (const bodyColumns of [32, 120]) {
      const ui = await $.ui.mount({ ...PANE, surface, props: { ...PANE.props, bodyColumns } })
      const title = surface === 'terminal' ? /DISTRIBUIÇÃO POR MODELO/ : /POR MODELO/
      expect((await ui.find({ type: 'Text', text: title })) !== undefined).toBe(true)
      expect((await ui.find({ type: 'Text', text: /pergunta simples/ })) !== undefined).toBe(true)
      await ui.press({ key: 'toggle' })
      await ui.unmount()
    }
  }
})

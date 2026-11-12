import { describe, expect, mock, test } from 'claude-code/testing'

import { DEFAULT_SETTINGS } from '../hooks/logic'
import {
  CLEAN_TO_DECAY,
  TEST_PROMPTS,
  bumpDay,
  combineFloor,
  modelColor,
  noteOutcome,
  previousWeek,
  shiftStep,
  shiftThresholds,
  shortLabel,
  shouldHold,
  summarizeWeek,
  testRow,
  weekSummaryText,
} from '../hooks/round6'
import type { Route } from '../hooks/router'

const S = DEFAULT_SETTINGS
const USAGE = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const ROUTER_USAGE = { input_tokens: 600, output_tokens: 60, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const
// A Thursday: its Monday is 2026-10-12, so last week ran 05/10 to 11/10.
const NOW = new Date(2026, 9, 15, 12).getTime()

type OnFn = Parameters<Parameters<typeof test>[1]>[1]

const COUNT: Route = { raciocinio: 0, construcao: 0, passos: 1, ambiguidade: 0, risco: 0, continuacao: false, resumo: 'contagem simples', confianca: 95 }
// Needs 5.9: Opus when balanced, Sonnet in the saving mode.
const MID: Route = { raciocinio: 1, construcao: 1, passos: 2, ambiguidade: 1, risco: 0, continuacao: false, resumo: 'refatoração média', confianca: 85 }
const BUILD: Route = { raciocinio: 1, construcao: 2, passos: 2, ambiguidade: 1, risco: 0, continuacao: false, resumo: 'painel com dados ao vivo', confianca: 92 }
const HARD: Route = { raciocinio: 3, construcao: 3, passos: 3, ambiguidade: 2, risco: 0, continuacao: false, resumo: 'sistema completo', confianca: 90 }
const RISKY: Route = { raciocinio: 1, construcao: 1, passos: 1, ambiguidade: 0, risco: 2, continuacao: false, resumo: 'mudança em produção', confianca: 85 }

// Six requests of growing size, for the modes: needs 3.1, 4.9, 5.9, 6.4, 7.5 and 9.3.
const LADDER: Route[] = [
  { raciocinio: 1, construcao: 0, passos: 1, ambiguidade: 0, risco: 0, continuacao: false, resumo: 'passo 1', confianca: 90 },
  { raciocinio: 1, construcao: 1, passos: 1, ambiguidade: 1, risco: 0, continuacao: false, resumo: 'passo 2', confianca: 90 },
  { raciocinio: 1, construcao: 1, passos: 2, ambiguidade: 1, risco: 0, continuacao: false, resumo: 'passo 3', confianca: 90 },
  { raciocinio: 1, construcao: 1, passos: 2, ambiguidade: 1, risco: 1, continuacao: false, resumo: 'passo 4', confianca: 90 },
  { raciocinio: 2, construcao: 1, passos: 2, ambiguidade: 1, risco: 0, continuacao: false, resumo: 'passo 5', confianca: 90 },
  { raciocinio: 2, construcao: 2, passos: 2, ambiguidade: 2, risco: 0, continuacao: false, resumo: 'passo 6', confianca: 90 },
]

function judge(prompt: string): Route {
  const asked = (/Pedido:\n"""\n([\s\S]*?)\n"""/.exec(prompt)?.[1] ?? '').toLowerCase()
  const rung = /degrau (\d)/.exec(asked)
  if (rung !== null) return LADDER[Number(rung[1]) - 1] ?? COUNT
  if (/continue/.test(asked)) return { ...COUNT, continuacao: true, resumo: 'continua a tarefa' }
  if (/quantos|how many/.test(asked)) return COUNT
  if (/sistema|sales system/.test(asked)) return HARD
  if (/painel|dashboard/.test(asked)) return BUILD
  if (/refatore|refactor/.test(asked)) return MID
  if (/deploy/.test(asked)) return RISKY

  return COUNT
}

type World = {
  models: string[]
  efforts: (string | number | undefined)[]
  commands: { command: string; args: string }[]
  toasts: string[]
  clock: { advance: (ms: number) => Promise<void>; settle: () => Promise<void> }
  panes: Set<string>
  opens: number
}

function engine(on: OnFn, options: { store?: Record<string, unknown> } = {}): World {
  mock.store(on, options.store)
  const clock = mock.clock(on, { now: NOW })
  const world: World = { models: [], efforts: [], commands: [], toasts: [], clock, panes: new Set(), opens: 0 }
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'automodelo' } }))
  on('command.list', () => ({ value: [{ name: 'effort', description: 'effort', source: 'builtin' }] }))
  on('command.run', (_, e) => {
    world.commands.push({ command: e.command, args: e.args })
    return { text: '' }
  })
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('ui.open', (_, e) => {
    world.panes.add(e.id)
    world.opens += 1
    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    world.panes.delete(e.id)
    return { value: undefined }
  })
  on('ui.panes', () => ({
    value: [...world.panes].map(id => ({ id, title: id, isShown: true, isFocused: false, isPlaced: true })),
  }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    if (e.component === 'SessionMode') return <Text>{e.props.modes.join(' & ')}</Text>
    if (e.component === 'CommandOutput') return <Text>{e.props.text}</Text>
    if (e.component === 'UserMessage') return <Text>{`eco: ${e.props.text}`}</Text>

    return <Text>engine</Text>
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', (_, e) => {
    world.toasts.push(String((e as unknown as { text?: string }).text ?? ''))
    return { value: undefined }
  })
  on('model.classify', () => ({ value: 'simples' }))
  on('model.complete', (_, e) => ({
    value: { isAnswered: true, text: JSON.stringify(judge(e.prompt)), usage: ROUTER_USAGE },
  }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('prompt.edit', (_, e) => {
    const text = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)
    return { text, cursor: e.start + e.inputText.length }
  })
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '', usage: { ...USAGE, model: 'x' } }))
  on('turn.step', async function* (_, e) {
    world.models.push(e.model)
    world.efforts.push(e.effort)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { ...USAGE, model: e.model } }
  })

  return world
}

async function turn($: any, text: string, turnId: string, options: { edit?: boolean } = {}) {
  const sent = await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: sent.text, turnId })
  if (options.edit === true) await $.tool.call({ tool: 'Edit', file_path: '/app/index.ts', old_string: 'a', new_string: 'b' })
  for await (const _ of $.turn.step({ turnId, index: 0, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1 })) {
    // drain
  }
  await $.turn.complete({ turnId, answer: '', durationMs: 10, isAborted: false, reason: 'answer', usage: { ...USAGE, model: 'x' } })
  return sent
}

const run = ($: any, args: string) => $.command.run({ command: 'automodelo', args, ...RUN })

const PANE = {
  plugin: 'auto-model',
  component: 'Pane',
  requestId: 'auto-model',
  props: { title: 'Auto Model', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const
const BAND = {
  plugin: 'auto-model',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const
const OUTPUT = (command: string, args: string, text: string) =>
  ({ plugin: 'auto-model', component: 'CommandOutput', requestId: `out-${command}`, props: { command, args, text, isErrored: false } }) as const
const ECHO = (text: string, origin: unknown) =>
  ({ plugin: 'auto-model', component: 'UserMessage', requestId: 'echo', props: { text, origin, isExpanded: false } }) as const
const MODE = { plugin: 'auto-model', component: 'SessionMode', requestId: 'session-mode', props: { modes: [] as string[] } } as const

async function textOf($: any, mount: Record<string, unknown>, surface: 'terminal' | 'desktop', pattern: RegExp) {
  const ui = await $.ui.mount({ ...mount, surface })
  const found = await ui.find({ type: 'Text', text: pattern })
  await ui.unmount()

  return found?.text as string | undefined
}

describe('A. o que o mod roda sozinho não aparece', () => {
  test('a resposta e o eco do /model e do /effort do mod somem; os da pessoa ficam', async ($, on) => {
    const world = engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await run($, 'config sincronizar ligar')
    await turn($, 'quantos e-mails não lidos eu tenho hoje?', 't1')
    await world.clock.settle()
    expect(world.commands.some(c => c.command === 'effort')).toBe(true)
    for (const surface of ['terminal', 'desktop'] as const) {
      expect(await textOf($, OUTPUT('model', 'claude-haiku-5-5', 'Set model to `Haiku 5.5` for this session only'), surface, /./)).toBe(undefined)
      expect(await textOf($, OUTPUT('effort', 'low', 'Set effort level to low (this session only): Quick'), surface, /./)).toBe(undefined)
      // The echo of a command the mod queued is hidden whatever its origin said.
      expect(await textOf($, ECHO('/effort low', { kind: 'composer' }), surface, /./)).toBe(undefined)
      // The person's own run, with other words, is translated and kept.
      expect(await textOf($, OUTPUT('model', 'claude-sonnet-5-5', 'Set model to `Sonnet 5.5` for this session only'), surface, /./)).toBe(
        'Modelo ajustado para Sonnet 5.5 (só nesta conversa).',
      )
      expect(await textOf($, ECHO('/effort high', { kind: 'composer' }), surface, /./)).toBe('eco: /effort high')
    }
  })
})

describe('B. padrões e migração', () => {
  test('o uso vem ligado e a sincronização desligada', () => {
    expect(S.isUsageOn).toBe(true)
    expect(S.isSyncOn).toBe(false)
    expect(S.strategy).toBe('equilibrado')
    expect(S.v).toBe(6)
  })
  test('configurações antigas vão para os padrões novos uma vez; o que a pessoa muda depois fica', async ($, on) => {
    engine(on, { store: { settings: { ...DEFAULT_SETTINGS, isUsageOn: false, isSyncOn: true, v: undefined } } })
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    expect((await run($, 'uso')).text).toContain('Medidor de uso: ligado')
    expect((await run($, 'config')).text).toContain('Sincronizar o seletor de modelo: desligado')
    await run($, 'uso desligar')
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    expect((await run($, 'uso')).text).toContain('Medidor de uso: desligado')
  })
})

describe('1. rótulo compacto no rodapé', () => {
  test('"Haiku·baixo", sem prefixo, e o status curto diz o mesmo', async ($, on) => {
    engine(on)
    expect(shortLabel('Haiku', 'baixo')).toBe('Haiku·baixo')
    expect(shortLabel('Opus', undefined)).toBe('Opus')
    expect(modelColor(0)).toBe('#14A39A')
    expect(modelColor(2)).toBe('#7C5CD6')
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await turn($, 'quantos e-mails não lidos eu tenho hoje?', 't1')
    for (const surface of ['terminal', 'desktop'] as const) {
      expect(await textOf($, MODE, surface, /Haiku·/)).toBe('Haiku·baixo')
      expect(await textOf($, MODE, surface, /Rodando/)).toBe(undefined)
    }
  })
})

describe('2. uma faixa só', () => {
  test('o cartão traz o modelo, o esforço, a explicação, o uso e os botões, sem repetir nada', async ($, on) => {
    engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await turn($, 'quantos e-mails não lidos eu tenho hoje?', 't1')
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...BAND, surface })
      expect((await ui.find({ type: 'Text', text: /^● Haiku · esforço baixo$/ })) !== undefined).toBe(true)
      expect((await ui.find({ type: 'Text', text: /Confiança/ })) !== undefined).toBe(true)
      // "Respondido por" is gone: the model is said once.
      expect((await ui.find({ type: 'Text', text: /Respondido por/ })) === undefined).toBe(true)
      expect((await ui.find({ type: 'Button', label: /Esse modelo errou/ })) !== undefined).toBe(true)
      await ui.unmount()
    }
  })
})

describe('3. modos: economia, equilibrado, qualidade', () => {
  test('os limites e o esforço andam para cada lado, e os pisos de segurança ficam', () => {
    expect(shiftThresholds([2.5, 5.5, 9], 'equilibrado')).toEqual([2.5, 5.5, 9])
    expect(Math.abs((shiftThresholds([2.5, 5.5, 9], 'economia')[1] ?? 0) - 6.3) < 1e-9).toBe(true)
    expect(Math.abs((shiftThresholds([2.5, 5.5, 9], 'qualidade')[1] ?? 0) - 4.7) < 1e-9).toBe(true)
    expect(shiftStep(1, 'economia', false)).toBe(0)
    expect(shiftStep(0, 'economia', false)).toBe(0)
    expect(shiftStep(1, 'economia', true)).toBe(1)
    expect(shiftStep(2, 'qualidade', false)).toBe(3)
    expect(shiftStep(3, 'qualidade', false)).toBe(3)
    expect(shiftStep(1, 'equilibrado', false)).toBe(1)
  })
  test('a economia nunca escolhe um modelo acima do equilibrado, e a qualidade nunca abaixo', async ($, on) => {
    const world = engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const tiers: Record<string, number[]> = {}
    let n = 0
    for (const mode of ['economia', 'equilibrado', 'qualidade']) {
      expect((await run($, `modo ${mode}`)).text).toContain(`Modo ${mode}`)
      tiers[mode] = []
      for (let rung = 1; rung <= 6; rung += 1) {
        n += 1
        const before = world.models.length
        await turn($, `degrau ${rung} versão ${mode}`, `m${n}`)
        const model = world.models[before] ?? ''
        tiers[mode]?.push(model.includes('haiku') ? 0 : model.includes('sonnet') ? 1 : 2)
      }
    }
    const eco = tiers.economia ?? []
    const mid = tiers.equilibrado ?? []
    const high = tiers.qualidade ?? []
    for (let i = 0; i < 6; i += 1) {
      expect((eco[i] ?? 0) <= (mid[i] ?? 0)).toBe(true)
      expect((mid[i] ?? 0) <= (high[i] ?? 0)).toBe(true)
    }
    const sum = (list: number[]) => list.reduce((a, b) => a + b, 0)
    expect(sum(eco) < sum(high)).toBe(true)
    expect((await run($, 'config')).text).toContain('Modo: qualidade')
  })
  test('o esforço anda um passo: baixo na economia, alto na qualidade', async ($, on) => {
    const world = engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await turn($, 'crie um painel meteorológico', 't1')
    expect(world.efforts[0]).toBe('medium')
    await run($, 'modo economia')
    await turn($, 'monte um painel de vendas', 't2')
    expect(world.efforts[1]).toBe('low')
    await run($, 'modo qualidade')
    await turn($, 'faça um painel de estoque', 't3')
    expect(world.efforts[2]).toBe('high')
  })
  test('explicar ligar e desligar vive à parte; o modo antigo silencioso continua valendo', async ($, on) => {
    engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    expect((await run($, 'explicar desligar')).text).toContain('Explicações desligadas')
    expect((await run($, 'config')).text).toContain('Explicar cada escolha: desligado')
    expect((await run($, 'explicar ligar')).text).toContain('Explicações ligadas')
    expect((await run($, 'modo silencioso')).text).toContain('Explicações desligadas')
    expect((await run($, 'modo')).text).toContain('Use /automodelo modo economia')
  })
})

describe('4. resumo da semana', () => {
  test('o texto, a semana anterior e as contagens', () => {
    expect(previousWeek('2026-10-12')).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11'])
    let days = { '2026-10-06': { actual: 40, opus: 100, top: 0, turns: 5, units: 2_000_000 }, '2026-10-08': { actual: 20, opus: 100, top: 0, turns: 3 } }
    days = bumpDay(days, '2026-10-06', 'switches') as typeof days
    days = bumpDay(days, '2026-10-06', 'switches') as typeof days
    days = bumpDay(days, '2026-10-08', 'errou') as typeof days
    const week = summarizeWeek(days, previousWeek('2026-10-12'), 40_000_000)
    expect(week.savedPercent).toBe(70)
    expect(week.switches).toBe(2)
    expect(week.errou).toBe(1)
    expect(week.usagePercent).toBe(5)
    expect(weekSummaryText(week)).toBe(
      'Semana 05/10 a 11/10: economia de 70% · 2 trocas de modelo · 1 vez em que você apertou "errou" · uso estimado de 5% do limite semanal',
    )
  })
  test('aparece uma vez só, na primeira sessão da semana nova', async ($, on) => {
    const world = engine(on, {
      store: {
        days: { '2026-10-06': { actual: 40, opus: 100, top: 0, turns: 5, units: 2_000_000, switches: 2, errou: 1 } },
        weekSeen: '2026-10-05',
      },
    })
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    expect(world.toasts.filter(t => t.startsWith('Semana 05/10 a 11/10')).length).toBe(1)
    expect(world.toasts[0]).toContain('economia de 60%')
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    expect(world.toasts.filter(t => t.startsWith('Semana')).length).toBe(1)
  })
})

describe('5. o projeto aprende o próprio piso', () => {
  test('três erros no mesmo modelo em dez pedidos sobem o piso; vinte acertos o baixam', () => {
    let learn = noteOutcome(undefined, 0, true)
    learn = noteOutcome(learn, 0, true)
    expect(learn.floor).toBe(undefined)
    learn = noteOutcome(learn, 0, true)
    expect(learn.floor).toBe(1)
    expect(learn.clean).toBe(0)
    for (let i = 0; i < CLEAN_TO_DECAY - 1; i += 1) learn = noteOutcome(learn, 1, false)
    expect(learn.floor).toBe(1)
    learn = noteOutcome(learn, 1, false)
    expect(learn.floor).toBe(undefined)
    expect(combineFloor(undefined, 1)).toBe(1)
    expect(combineFloor(2, 1)).toBe(2)
    expect(combineFloor(undefined, undefined)).toBe(undefined)
  })
  test('apertar "errou" três vezes no Haiku faz o Sonnet virar o piso do projeto', async ($, on) => {
    const world = engine(on)
    await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
    for (let i = 1; i <= 3; i += 1) {
      await turn($, `quantos arquivos tem na pasta ${i}?`, `t${i}`)
      const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
      await ui.press({ key: 'auto-model-errou' })
      await ui.unmount()
    }
    await turn($, 'quantos arquivos tem na pasta 4?', 't4')
    expect(world.models[world.models.length - 1]).toBe('claude-sonnet-5-5')
    const why = await run($, 'porque detalhes')
    expect(why.text).toContain('aprendizado deste projeto')
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: 'advanced' })
    expect((await ui.find({ type: 'Text', text: /piso aprendido Sonnet/ })) !== undefined).toBe(true)
    await ui.unmount()
  })
})

describe('6. sem descer no meio de uma tarefa longa', () => {
  test('a regra', () => {
    const base = { buildStreak: 2, previous: 2 as const, tier: 0 as const, isContinuation: true, isRelated: false }
    expect(shouldHold(base)).toBe(true)
    expect(shouldHold({ ...base, buildStreak: 1 })).toBe(false)
    expect(shouldHold({ ...base, isContinuation: false })).toBe(false)
    expect(shouldHold({ ...base, isContinuation: false, isRelated: true })).toBe(true)
    expect(shouldHold({ ...base, tier: 2 })).toBe(false)
    expect(shouldHold({ ...base, previous: undefined })).toBe(false)
  })
  test('depois de dois pedidos de construção, um pedido do mesmo assunto não desce', async ($, on) => {
    const world = engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await turn($, 'crie um painel meteorológico de vendas', 't1', { edit: true })
    await turn($, 'monte um painel de vendas', 't2', { edit: true })
    await turn($, 'quantos arquivos tem o painel de vendas?', 't3')
    expect(world.models[2]).toBe('claude-opus-5-5')
    expect((await run($, 'porque detalhes')).text).toContain('tarefa longa em andamento')
  })
  test('sem a tarefa longa, o mesmo pedido simples desce para o Haiku', async ($, on) => {
    const world = engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await turn($, 'crie um painel meteorológico de vendas', 'u1')
    await turn($, 'monte um painel de vendas', 'u2')
    await turn($, 'quantos arquivos tem o painel de vendas?', 'u3')
    expect(world.models[2]).toBe('claude-haiku-5-5')
  })
})
describe('7. /automodelo teste', () => {
  test('mostra para onde iriam os 6 exemplos, sem enviar nada', async ($, on) => {
    const world = engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const out = await run($, 'teste')
    expect(TEST_PROMPTS.length).toBe(6)
    const lines = out.text.split('\n').filter(l => l.startsWith('- '))
    expect(lines.length).toBe(6)
    expect(out.text).toContain('nada foi enviado')
    expect(lines[0]).toContain('quantos arquivos tem nesta pasta? → Haiku·baixo')
    expect(lines[3]).toContain('→ Opus·')
    // The sensitive request never goes to the cheapest model.
    expect(lines[4]).toMatch(/→ (Sonnet|Opus)·/)
    // Read as the first request of a new conversation, a short "yes" has nothing to continue.
    expect(lines[5]).toContain('sim, pode continuar →')
    expect(out.text).toContain('primeiro de uma conversa nova')
    expect(world.models.length).toBe(0)
    expect(testRow('x', 'Haiku', 'baixo', 0.856, 'cache')).toBe('x → Haiku·baixo · 86% · cache')
  })
})

describe('8. a sincronização do seletor vem desligada', () => {
  test('sem ligar, nenhum /model nem /effort é enfileirado', async ($, on) => {
    const world = engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await turn($, 'quantos e-mails não lidos eu tenho hoje?', 't1')
    await world.clock.settle()
    expect(world.commands.filter(c => c.command === 'model' || c.command === 'effort')).toEqual([])
    expect((await run($, 'config sincronizar ligar')).text).toContain('Sincronização ligada')
  })
})

describe('C. o painel novo', () => {
  async function ready($: any, on: OnFn) {
    const world = engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await turn($, 'quantos e-mails não lidos eu tenho hoje?', 't1')
    await turn($, 'crie um painel meteorológico', 't2')

    return world
  }
  test('nos gráficos: anel, uso, gráfico, barra por modelo, decisões, avançado e ajustes, em palavras simples', async ($, on) => {
    await ready($, on)
    for (const bodyColumns of [32, 80, 140]) {
      const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { ...PANE.props, bodyColumns } })
      for (const word of [/^Auto Model$/, /de economia/, /^USO$/, /ÚLTIMOS 14 DIAS/, /POR MODELO/, /DECISÕES RECENTES/, /AVANÇADO/]) {
        expect((await ui.find({ type: 'Text', text: word })) !== undefined).toBe(true)
      }
      // A title never wraps: each fits well inside the narrowest pane.
      for (const title of ['USO', 'ÚLTIMOS 14 DIAS', 'POR MODELO', 'DECISÕES RECENTES', 'AVANÇADO']) expect(title.length <= 24).toBe(true)
      // No box-drawing numerals and no text-drawn rules: the drawings are SVG.
      expect((await ui.find({ type: 'Text', text: /[┏┓┗┛┃╺╸┫┣┻┳─]/ })) === undefined).toBe(true)
      expect((await ui.find({ type: 'Svg' })) !== undefined).toBe(true)
      await ui.unmount()
    }
  })
  test('o jargão sumiu do que aparece de início e fica no "Avançado"', async ($, on) => {
    await ready($, on)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect((await ui.find({ type: 'Text', text: /escalonamento|roteador/i })) === undefined).toBe(true)
    expect((await ui.find({ type: 'Text', text: /Vezes em que precisou subir de modelo/ })) === undefined).toBe(true)
    await ui.press({ key: 'advanced' })
    expect((await ui.find({ type: 'Text', text: /Vezes em que precisou subir de modelo/ })) !== undefined).toBe(true)
    expect((await ui.find({ type: 'Text', text: /Custo da análise/ })) !== undefined).toBe(true)
    await ui.unmount()
  })
  test('"ver detalhes" abre a conta de cada decisão', async ($, on) => {
    await ready($, on)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect((await ui.find({ type: 'Text', text: /necessidade/ })) === undefined).toBe(true)
    await ui.press({ key: 'details' })
    expect((await ui.find({ type: 'Text', text: /necessidade/ })) !== undefined).toBe(true)
    await ui.unmount()
  })
  test('os botões de ajuste mudam o modo, o teto, as explicações, a sincronização e o uso', async ($, on) => {
    await ready($, on)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    await ui.press({ key: 's-mode' })
    expect((await run($, 'config')).text).toContain('Modo: qualidade')
    await ui.press({ key: 's-ceiling' })
    expect((await run($, 'config')).text).toContain('Teto: Fable')
    await ui.press({ key: 's-explain' })
    expect((await run($, 'config')).text).toContain('Explicar cada escolha: desligado')
    await ui.press({ key: 's-sync' })
    expect((await run($, 'config')).text).toContain('Sincronizar o seletor de modelo: ligado')
    await ui.press({ key: 's-usage' })
    expect((await run($, 'uso')).text).toContain('Medidor de uso: desligado')
    await ui.unmount()
  })
  test('o terminal mantém a versão simples em texto, com as palavras novas', async ($, on) => {
    await ready($, on)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await ui.find({ type: 'Text', text: /SUBIU DE MODELO/ })) !== undefined).toBe(true)
    expect((await ui.find({ type: 'Text', text: /Custo da análise/ })) !== undefined).toBe(true)
    expect((await ui.find({ type: 'Text', text: /TAXA DE ESCALONAMENTO|Custo do roteador/ })) === undefined).toBe(true)
    await ui.unmount()
  })
})

describe('0.8.1: painel lateral e rótulo do rodapé', () => {
  test('o painel abre sozinho ao iniciar, também no app desktop (isInteractive falso)', async ($, on) => {
    const world = engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: false })
    await world.clock.advance(10)
    expect(world.panes.has('auto-model')).toBe(true)
  })

  test('clicar no rótulo oculta o painel aberto e mostra o oculto', async ($, on) => {
    const world = engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await world.clock.advance(10)
    await turn($, 'quantos e-mails não lidos eu tenho hoje?', 't1')
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...MODE, surface })
      await ui.press({ key: 'auto-model-rodape' })
      expect(world.panes.has('auto-model')).toBe(false)
      await ui.press({ key: 'auto-model-rodape' })
      expect(world.panes.has('auto-model')).toBe(true)
      await ui.unmount()
    }
  })

  test('oculto pelo rótulo, não abre sozinho na próxima conversa', async ($, on) => {
    const world = engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await world.clock.advance(10)
    await turn($, 'quantos e-mails não lidos eu tenho hoje?', 't1')
    const ui = await $.ui.mount({ ...MODE, surface: 'desktop' })
    await ui.press({ key: 'auto-model-rodape' })
    await ui.unmount()

    const before = world.opens
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await world.clock.advance(10)
    expect(world.opens).toBe(before)
  })
})

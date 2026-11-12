import { describe, expect, mock, test } from 'claude-code/testing'

import { DEFAULT_SETTINGS, MODEL_NAMES, applySetting, describeSettings, effortShort, translateCommandOutput } from '../hooks/logic'
import { EFFORT_LADDER, HELP, calibrate, effortAtStep, effortNudge, levelOfScore, pickEffort } from '../hooks/round2'
import type { Calibration, Sample } from '../hooks/round2'
import { demandStepOf, needOf, routeDecide } from '../hooks/router'
import type { Route } from '../hooks/router'

const S = DEFAULT_SETTINGS
const USAGE = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const ROUTER_USAGE = { input_tokens: 600, output_tokens: 60, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const
const NOW = new Date(2026, 9, 15, 12).getTime()

type OnFn = Parameters<Parameters<typeof test>[1]>[1]

const COUNT: Route = { raciocinio: 0, construcao: 0, passos: 1, ambiguidade: 0, risco: 0, continuacao: false, resumo: 'contar e-mails não lidos', confianca: 95 }
const BUILD: Route = { raciocinio: 1, construcao: 2, passos: 2, ambiguidade: 1, risco: 0, continuacao: false, resumo: 'painel com dados ao vivo', confianca: 92 }
const HARD: Route = { raciocinio: 3, construcao: 3, passos: 3, ambiguidade: 2, risco: 0, continuacao: false, resumo: 'sistema completo com várias partes', confianca: 90 }
const SUBTLE: Route = { raciocinio: 2, construcao: 3, passos: 3, ambiguidade: 3, risco: 3, continuacao: false, resumo: 'migração delicada', confianca: 80 }

function judge(prompt: string): Route {
  const asked = (/Pedido:\n"""\n([\s\S]*?)\n"""/.exec(prompt)?.[1] ?? '').toLowerCase()
  if (/sistema completo/.test(asked)) return HARD
  if (/painel|dashboard/.test(asked)) return BUILD
  if (/quant[oa]s|how many|e-mails/.test(asked)) return COUNT

  return COUNT
}

type World = {
  models: string[]
  efforts: (string | number | undefined)[]
  commands: { command: string; args: string }[]
  clock: { advance: (ms: number) => Promise<void>; settle: () => Promise<void> }
}

function engine(on: OnFn, options: { hasEffort?: boolean; sessionModel?: string } = {}): World {
  mock.store(on)
  const clock = mock.clock(on, { now: NOW })
  const world: World = { models: [], efforts: [], commands: [], clock }
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'automodelo' } }))
  on('command.list', () => ({
    value: options.hasEffort === false ? [] : [{ name: 'effort', description: 'effort', source: 'builtin' }],
  }))
  on('command.run', (_, e) => {
    world.commands.push({ command: e.command, args: e.args })
    return { text: '' }
  })
  on('session.model', () => ({ value: options.sessionModel ?? 'claude-opus-5-5' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    if (e.component === 'SessionMode') return <Text>{e.props.modes.join(' & ')}</Text>
    if (e.component === 'CommandOutput') return <Text>{e.props.text}</Text>
    if (e.component === 'UserMessage') return <Text>{`eco: ${e.props.text}`}</Text>

    return <Text>engine</Text>
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('model.classify', () => ({ value: 'simples' }))
  on('model.complete', (_, e) => ({ value: { isAnswered: true, text: JSON.stringify(judge(e.prompt)), usage: ROUTER_USAGE } }))
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

/** The person's own session effort is "high" here, as in their settings. */
async function turn($: any, text: string, turnId: string, sessionEffort = 'high') {
  const sent = await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: sent.text, turnId })
  for await (const _ of $.turn.step({ turnId, index: 0, model: 'claude-opus-5-5', effort: sessionEffort, messageCount: 1 })) {
    // drain
  }
  await $.turn.complete({ turnId, answer: '', durationMs: 10, isAborted: false, reason: 'answer', usage: { ...USAGE, model: 'x' } })
  return sent
}

const MODE = { plugin: 'auto-model', component: 'SessionMode', requestId: 'session-mode', props: { modes: [] as string[] } } as const
const OUTPUT = (command: string, args: string, text: string, isErrored = false) =>
  ({ plugin: 'auto-model', component: 'CommandOutput', requestId: `out-${command}`, props: { command, args, text, isErrored } }) as const
const ECHO = (text: string, origin: unknown, isExpanded = false) =>
  ({ plugin: 'auto-model', component: 'UserMessage', requestId: 'echo', props: { text, origin, isExpanded } }) as const
const PANE = {
  plugin: 'auto-model',
  component: 'Pane',
  requestId: 'auto-model',
  props: { title: 'Auto Model', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

async function textOf($: any, mount: Record<string, unknown>, surface: 'terminal' | 'desktop', pattern: RegExp) {
  const ui = await $.ui.mount({ ...mount, surface })
  const found = await ui.find({ type: 'Text', text: pattern })
  await ui.unmount()

  return found?.text as string | undefined
}

const SURFACES = ['terminal', 'desktop'] as const

describe('1. esforço pelo que o pedido exige', () => {
  test('a tabela: consulta baixo, painel médio, trabalho grande alto, só o raciocínio máximo vai além', () => {
    expect(demandStepOf(COUNT)).toBe(0)
    expect(demandStepOf(BUILD)).toBe(1)
    expect(demandStepOf({ ...BUILD, raciocinio: 2, passos: 2, risco: 1 })).toBe(2)
    expect(demandStepOf(HARD)).toBe(3)
    // Lots of work and risk, but no hard reasoning: never the top step.
    expect(demandStepOf(SUBTLE)).toBe(2)
    expect(EFFORT_LADDER).toEqual(['low', 'medium', 'high', 'xhigh'])
  })
  test('só o Opus e o Fable passam de alto', () => {
    expect(effortAtStep(0, 3)).toBe('high')
    expect(effortAtStep(1, 3)).toBe('high')
    expect(effortAtStep(2, 3)).toBe('xhigh')
    expect(effortAtStep(3, 3)).toBe('xhigh')
    expect(levelOfScore(1)).toBe(0)
    expect(levelOfScore(4)).toBe(1)
    expect(levelOfScore(7)).toBe(2)
    expect(levelOfScore(10)).toBe(3)
  })
  test('o esforço padrão da pessoa (alto) não manda: contar e-mails fica no Haiku com esforço baixo', () => {
    const base = { isCached: false, text: 'x', settings: S, previous: undefined, ctx: 0, isCacheWarm: false, at: 0, thresholds: [2.5, 5.5, 9], floor: undefined, budget: undefined, calibration: undefined } as const
    for (const baseEffort of ['high', 'xhigh', 'max', 'medium', undefined] as const) {
      const count = routeDecide({ ...base, baseEffort, route: COUNT })
      expect(count.decision.tier).toBe(0)
      expect(count.decision.effort).toBe('low')
      expect(count.decision.effortWhy).toContain('pouco raciocínio')
    }
    const build = routeDecide({ ...base, baseEffort: 'low', route: BUILD })
    expect(build.decision.tier).toBe(2)
    expect(build.decision.effort).toBe('medium')
    const hard = routeDecide({ ...base, baseEffort: 'low', route: HARD })
    expect(hard.decision.tier).toBe(2)
    expect(hard.decision.effort).toBe('xhigh')
    expect(needOf(HARD) > 9).toBe(true)
  })
  test('respeitar: o esforço da pessoa é só o teto', () => {
    const base = { isCached: false, text: 'x', previous: undefined, ctx: 0, isCacheWarm: false, at: 0, thresholds: [2.5, 5.5, 9], floor: undefined, budget: undefined, calibration: undefined } as const
    const respect = { ...S, effortMode: 'respeitar' as const }
    expect(routeDecide({ ...base, settings: respect, baseEffort: 'low', route: HARD }).decision.effort).toBe('low')
    expect(routeDecide({ ...base, settings: respect, baseEffort: 'high', route: HARD }).decision.effort).toBe('high')
    expect(routeDecide({ ...base, settings: respect, baseEffort: 'xhigh', route: HARD }).decision.effort).toBe('xhigh')
    // A demand below the ceiling stays where it is.
    expect(routeDecide({ ...base, settings: respect, baseEffort: 'high', route: COUNT }).decision.effort).toBe('low')
    // Automatic ignores the person's setting entirely.
    expect(routeDecide({ ...base, settings: S, baseEffort: 'low', route: HARD }).decision.effort).toBe('xhigh')
  })
  test('na beirada da faixa, um modelo menor com mais esforço leva o pedido quando sai bem mais barato', () => {
    const edge = pickEffort({ tier: 2, need: 5.6, step: 2, source: 'tarefa', settings: S, thresholds: [2.5, 5.5, 9], floor: undefined, calibration: undefined, base: undefined })
    expect(edge.tier).toBe(1)
    expect(edge.effort).toBe('high')
    // With a project floor of Opus it cannot step down.
    const held = pickEffort({ tier: 2, need: 5.6, step: 2, source: 'tarefa', settings: S, thresholds: [2.5, 5.5, 9], floor: 2, calibration: undefined, base: undefined })
    expect(held.tier).toBe(2)
    // Far from the edge nothing changes.
    expect(pickEffort({ tier: 2, need: 8, step: 2, source: 'tarefa', settings: S, thresholds: [2.5, 5.5, 9], floor: undefined, calibration: undefined, base: undefined }).tier).toBe(2)
  })
})

describe('1b. o esforço aprende com o histórico', () => {
  const sample = (i: number, tier: 0 | 1 | 2, effort: string, outcome: Sample['outcome']): Sample => ({ id: `s${i}`, at: i, tier, score: 4, groups: [], outcome, effort })

  test('uma combinação que falha sobe um nível de esforço, aos poucos', () => {
    const list: Sample[] = []
    for (let i = 0; i < 12; i += 1) list.push(sample(i, 1, 'medium', i % 3 === 0 ? 'ok' : 'errou'))
    for (let i = 12; i < 24; i += 1) list.push(sample(i, 0, 'low', 'ok'))
    const first = calibrate(list) as Calibration
    expect(first.effortBias?.['1:medium']).toBeGreaterThan(0)
    // One round is not enough to move the effort; the next confirms it.
    expect(effortNudge(first, 1, 1)).toBe(0)
    const second = calibrate(list, first) as Calibration
    expect(effortNudge(second, 1, 1)).toBe(1)
    expect(effortAtStep(1, 1, second)).toBe('high')
    // The other combination is untouched.
    expect(effortAtStep(0, 0, second)).toBe('low')
  })
  test('uma combinação que nunca falha desce, só depois de várias leituras', () => {
    const list: Sample[] = []
    for (let i = 0; i < 24; i += 1) list.push(sample(i, 2, 'high', 'ok'))
    let cal = calibrate(list) as Calibration
    expect(effortNudge(cal, 2, 2)).toBe(0)
    for (let i = 0; i < 6; i += 1) cal = calibrate(list, cal) as Calibration
    expect(cal.effortBias?.['2:high']).toBeLessThan(-0.5)
    expect(effortAtStep(2, 2, cal)).toBe('medium')
  })
  test('o porquê diz quando o histórico mexeu no esforço', () => {
    const cal: Calibration = { samples: 40, thresholds: [2.5, 5.5, 9], groupShift: {}, buckets: {}, effortBias: { '1:medium': 1.2 } }
    const pick = pickEffort({ tier: 1, need: 4, step: 1, source: 'tarefa', settings: S, thresholds: [2.5, 5.5, 9], floor: undefined, calibration: cal, base: undefined })
    expect(pick.effort).toBe('high')
    expect(pick.why).toContain('ajustado para cima pelo seu histórico')
  })
})

describe('1c. de ponta a ponta, com o roteador', () => {
  test('contar e-mails vai de Haiku com esforço baixo, mesmo com a sessão em alto', async ($, on) => {
    const world = engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await turn($, 'quantos e-mails não lidos eu tenho hoje?', 't1', 'high')
    expect(world.models[0]).toBe('claude-haiku-5-5')
    expect(world.efforts[0]).toBe('low')
  })
  test('um sistema completo vai de Opus com esforço muito alto; um painel, esforço médio', async ($, on) => {
    const world = engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await turn($, 'crie um sistema completo de vendas com estoque, login e relatórios', 't1', 'low')
    expect(world.models[0]).toBe('claude-opus-5-5')
    expect(world.efforts[0]).toBe('xhigh')
    await turn($, 'faça um painel meteorológico de Magé', 't2', 'high')
    expect(world.models[1]).toBe('claude-opus-5-5')
    expect(world.efforts[1]).toBe('medium')
  })
  test('os dois caminhos do reserva também calculam o esforço pelo pedido', async ($, on) => {
    const world = engine(on)
    await $.command.run({ command: 'automodelo', args: 'config roteador desligar', ...RUN })
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await turn($, 'quantos arquivos tem aqui?', 't1', 'high')
    expect(world.efforts[0]).toBe('low')
    // Forced by prefix: the model is the person's, the effort still follows the request.
    await turn($, '!opus quantos arquivos tem aqui?', 't2', 'high')
    expect(world.models[1]).toBe('claude-opus-5-5')
    expect(world.efforts[1]).toBe('low')
  })
  test('porque e porque detalhes mostram "Esforço: … · porque …"', async ($, on) => {
    engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await turn($, 'quantos e-mails não lidos eu tenho hoje?', 't1')
    const short = await $.command.run({ command: 'automodelo', args: 'porque', ...RUN })
    expect(short.text).toContain('Esforço: baixo · porque a tarefa pede pouco raciocínio e poucos passos')
    const long = await $.command.run({ command: 'automodelo', args: 'porque detalhes', ...RUN })
    expect(long.text).toContain('Esforço: baixo · porque')
    expect(long.text).toContain('esforço baixo:')
  })
  test('o painel mostra modelo e esforço nas últimas decisões', async ($, on) => {
    engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await turn($, 'quantos e-mails não lidos eu tenho hoje?', 't1')
    expect(await textOf($, PANE, 'terminal', /Haiku baixo/)).toContain('Haiku baixo')
    // The graphical pane draws the model and its effort as two plain texts on one row.
    expect(await textOf($, PANE, 'desktop', /^Haiku$/)).toBe('Haiku')
    expect(await textOf($, PANE, 'desktop', /^baixo$/)).toBe('baixo')
    expect(effortShort('xhigh')).toBe('m.alto')
  })
})

describe('2. rótulo "Haiku·baixo" no rodapé', () => {
  test('antes de qualquer pedido não mostra nada; depois, o que foi realmente usado', async ($, on) => {
    engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const label = /(Haiku|Sonnet|Opus|Fable)·/
    for (const surface of SURFACES) expect(await textOf($, MODE, surface, label)).toBe(undefined)
    await turn($, 'quantos e-mails não lidos eu tenho hoje?', 't1')
    for (const surface of SURFACES) expect(await textOf($, MODE, surface, label)).toBe('Haiku·baixo')
    await turn($, 'crie um sistema completo de vendas com estoque, login e relatórios', 't2')
    for (const surface of SURFACES) expect(await textOf($, MODE, surface, label)).toBe('Opus·muito alto')
  })
  test('mantém os rótulos que já existiam e some com rotulo desligar ou com o mod desligado', async ($, on) => {
    engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await turn($, 'quantos e-mails não lidos eu tenho hoje?', 't1')
    const withOthers = { ...MODE, props: { modes: ['foco'] } }
    expect(await textOf($, withOthers, 'desktop', /foco/)).toBe('foco & ')
    expect(await textOf($, withOthers, 'desktop', /Haiku·/)).toBe('Haiku·baixo')
    const off = await $.command.run({ command: 'automodelo', args: 'config rotulo desligar', ...RUN })
    expect(off.text).toContain('Rótulo desligado')
    expect(await textOf($, withOthers, 'desktop', /foco/)).toBe('foco')
    await $.command.run({ command: 'automodelo', args: 'config rotulo ligar', ...RUN })
    expect(await textOf($, MODE, 'desktop', /Haiku·/)).toBe('Haiku·baixo')
    await $.command.run({ command: 'automodelo', args: 'desligar', ...RUN })
    expect(await textOf($, MODE, 'desktop', /Haiku·/)).toBe(undefined)
  })
})

describe('3. /model e /effort em português', () => {
  test('o texto em inglês vira português, fiel ao original', () => {
    expect(translateCommandOutput('model', 'Set model to `Haiku 5.5` for this session only', false)).toBe('Modelo ajustado para Haiku 5.5 (só nesta conversa).')
    expect(translateCommandOutput('model', 'Set model to `Haiku 5.5` for this session only', true)).toBe('Auto Model: modelo desta conversa ajustado para Haiku 5.5.')
    expect(
      translateCommandOutput('effort', 'Set effort level to high (this session only): Comprehensive implementation with extensive testing and documentation', false),
    ).toBe('Esforço ajustado para alto (só nesta conversa): implementação completa, com testes e documentação extensivos.')
    expect(translateCommandOutput('effort', 'Set effort level to medium (this session only): Balanced approach with standard implementation and testing', false)).toContain('abordagem equilibrada')
    expect(translateCommandOutput('effort', 'Set effort level to low (this session only): Quick', true)).toBe('Auto Model: esforço desta conversa ajustado para baixo.')
    // Anything else is left as the app wrote it.
    expect(translateCommandOutput('model', 'Current model: Opus 5.5', false)).toBe(undefined)
    expect(translateCommandOutput('cost', 'Set model to `x` for this session only', false)).toBe(undefined)
  })
  test('no transcript, a resposta do /model que o mod rodou aparece como do Auto Model; a manual, só traduzida', async ($, on) => {
    const world = engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await $.command.run({ command: 'automodelo', args: 'config sincronizar ligar', ...RUN })
    await turn($, 'quantos e-mails não lidos eu tenho hoje?', 't1', 'high')
    await world.clock.settle()
    expect(world.commands).toEqual([
      { command: 'model', args: 'claude-haiku-5-5' },
      { command: 'effort', args: 'low' },
    ])
    const own = OUTPUT('model', 'claude-haiku-5-5', 'Set model to `Haiku 5.5` for this session only')
    const manual = OUTPUT('model', 'claude-sonnet-5-5', 'Set model to `Sonnet 5.5` for this session only')
    const ownEffort = OUTPUT('effort', 'low', 'Set effort level to low (this session only): Quick')
    for (const surface of SURFACES) {
      // What the mod ran itself draws nothing: the footer and the band already say it.
      expect(await textOf($, own, surface, /Haiku/)).toBe(undefined)
      expect(await textOf($, ownEffort, surface, /esforço/)).toBe(undefined)
      expect(await textOf($, manual, surface, /Sonnet/)).toBe('Modelo ajustado para Sonnet 5.5 (só nesta conversa).')
    }
  })
  test('outros comandos e erros ficam como estão', async ($, on) => {
    engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    expect(await textOf($, OUTPUT('cost', '', 'Set model to `x` for this session only'), 'desktop', /Set model/)).toBe('Set model to `x` for this session only')
    expect(await textOf($, OUTPUT('model', 'x', 'Set model to `x` for this session only', true), 'desktop', /Set model/)).toBe('Set model to `x` for this session only')
    expect(await textOf($, OUTPUT('model', '', 'Current model: Opus 5.5'), 'desktop', /Current/)).toBe('Current model: Opus 5.5')
  })
  test('o eco "/effort low" do que o mod rodou some; o de outras origens e o expandido ficam', async ($, on) => {
    engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const own = { kind: 'plugin', name: 'auto-model' }
    for (const surface of SURFACES) {
      expect(await textOf($, ECHO('/effort low', own), surface, /./)).toBe(undefined)
      expect(await textOf($, ECHO('/model claude-haiku-5-5', own), surface, /./)).toBe(undefined)
      // The person's own line, another plugin's, the mod's resubmitted prompt and ctrl+o all stay.
      expect(await textOf($, ECHO('/effort low', { kind: 'composer' }), surface, /./)).toBe('eco: /effort low')
      expect(await textOf($, ECHO('/effort low', { kind: 'plugin', name: 'outro' }), surface, /./)).toBe('eco: /effort low')
      expect(await textOf($, ECHO('refaça isto', own), surface, /./)).toBe('eco: refaça isto')
      expect(await textOf($, ECHO('/effort low', own, true), surface, /./)).toBe('eco: /effort low')
    }
  })
})

describe('4. diagnóstico', () => {
  test('mostra o que o motor informa, o que foi aplicado e o que a sincronização enfileirou', async ($, on) => {
    const world = engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await $.command.run({ command: 'automodelo', args: 'config sincronizar ligar', ...RUN })
    const before = await $.command.run({ command: 'automodelo', args: 'diagnostico', ...RUN })
    expect(before.text).toContain('Diagnóstico do Auto Model (versão 0.8.3)')
    expect(before.text).toContain('Modelo da conversa: Opus (claude-opus-5-5)')
    expect(before.text).toContain('Ainda não houve decisão nesta conversa.')
    expect(before.text).toContain('Nenhum comando foi enfileirado ainda.')
    await turn($, 'quantos e-mails não lidos eu tenho hoje?', 't1', 'high')
    await world.clock.settle()
    const after = await $.command.run({ command: 'automodelo', args: 'diagnostico', ...RUN })
    expect(after.text).toContain('Esforço da conversa: alto')
    expect(after.text).toContain('Última decisão: Haiku · esforço baixo')
    expect(after.text).toContain('Aplicado no último pedido: Haiku · esforço baixo')
    expect(after.text).toContain('Enviado ao motor')
    expect(after.text).toContain('claude-haiku-5-5 · esforço baixo')
    expect(after.text).toContain('Sincronizar: ligado · comando /effort existe nesta versão')
    expect(after.text).toContain('/model claude-haiku-5-5')
    expect(after.text).toContain('/effort low')
    expect(after.text).toContain('Compare com o seletor do rodapé do app; se ele ainda mostrar outro modelo, o seletor do app não acompanha mods.')
    const alias = await $.command.run({ command: 'automodelo', args: 'diag', ...RUN })
    expect(alias.text).toContain('Diagnóstico do Auto Model')
  })
})

describe('5. configuração e ajuda', () => {
  test('config esforco e config rotulo', () => {
    const respect = applySetting(S, ['esforco', 'respeitar'])
    expect('settings' in respect && respect.settings.effortMode).toBe('respeitar')
    const auto = applySetting({ ...S, effortMode: 'respeitar' }, ['esforço', 'automatico'])
    expect('settings' in auto && auto.settings.effortMode).toBe('automatico')
    expect('error' in applySetting(S, ['esforco', 'talvez'])).toBe(true)
    const off = applySetting(S, ['rotulo', 'desligar'])
    expect('settings' in off && off.settings.isLabelOn).toBe(false)
    expect('error' in applySetting(S, ['rotulo', 'quem sabe'])).toBe(true)
    expect(S.effortMode).toBe('automatico')
    expect(S.isLabelOn).toBe(true)
    // Since 0.6.0 the picker sync is off and the usage meter is on by default.
    expect(S.isSyncOn).toBe(false)
    expect(S.isUsageOn).toBe(true)
  })
  test('a lista de configurações e a ajuda falam das novidades', () => {
    const text = describeSettings(S)
    expect(text).toContain('Esforço: automático')
    expect(text).toContain('Rótulo do rodapé (modelo·esforço, como Haiku·baixo): ligado')
    expect(HELP).toContain('/automodelo diagnostico')
    expect(HELP).toContain('/automodelo config esforco automatico | respeitar')
    expect(HELP).toContain('/automodelo config rotulo ligar | desligar')
    expect(HELP).toContain('/automodelo config sincronizar ligar | desligar')
    expect(HELP).toContain('/automodelo modo economia | equilibrado | qualidade')
    expect(HELP).toContain('/automodelo teste')
    expect(MODEL_NAMES[0]).toBe('Haiku')
  })
  test('pelo comando: config esforco respeitar liga o teto da pessoa', async ($, on) => {
    const world = engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const set = await $.command.run({ command: 'automodelo', args: 'config esforco respeitar', ...RUN })
    expect(set.text).toContain('nunca passa do esforço que você escolheu')
    await turn($, 'crie um sistema completo de vendas com estoque, login e relatórios', 't1', 'medium')
    expect(world.efforts[0]).toBe('medium')
  })
})

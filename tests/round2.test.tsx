import { describe, expect, mock, test } from 'claude-code/testing'

import { DEFAULT_SETTINGS, THRESHOLDS } from '../hooks/logic'
import {
  EMPTY_SLIP,
  MIN_SAMPLES,
  addDay,
  budgetRatio,
  calibrate,
  calibratedConfidence,
  cheapestCombo,
  criticalHit,
  exportCsv,
  markLast,
  monthOf,
  noteCall,
  proofOf,
  refine,
  slipReason,
} from '../hooks/round2'
import type { Sample } from '../hooks/round2'

const S = DEFAULT_SETTINGS
const USAGE = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const
const DAY = 86_400_000
// 15 Oct 2026, noon local.
const NOW = new Date(2026, 9, 15, 12).getTime()

type OnFn = Parameters<Parameters<typeof test>[1]>[1]

type World = {
  models: string[]
  efforts: (string | number | undefined)[]
  toasts: string[]
  statuses: (string | undefined)[]
  files: Record<string, string>
  toolError: { value: boolean }
  clock: { advance: (ms: number) => Promise<void> }
}

function engine(on: OnFn, options: { label?: string } = {}): World {
  mock.store(on)
  const clock = mock.clock(on, { now: NOW })
  const world: World = { models: [], efforts: [], toasts: [], statuses: [], files: {}, toolError: { value: false }, clock }
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'automodelo' } }))
  on('command.list', () => ({ value: [] }))
  on('command.run', () => ({ text: '' }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('ui.status', (_, e) => {
    world.statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', (_, e) => {
    world.toasts.push(e.text)
    return { value: undefined }
  })
  on('fs.write', (_, e) => {
    world.files[e.path.split(String.fromCharCode(92)).join("/")] = e.text
    return { value: undefined }
  })
  on('model.classify', () => ({ value: 'label' in options ? options.label : 'simples' }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('prompt.edit', (_, e) => {
    const text = e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end)
    return { text, cursor: e.start + e.inputText.length }
  })
  on('tool.call', () => (world.toolError.value ? { result: {}, isError: true, text: 'falhou' } : { result: {}, text: 'ok' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '', usage: { ...USAGE, model: 'x' } }))
  on('turn.step', async function* (_, e) {
    world.models.push(e.model)
    world.efforts.push(e.effort)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { ...USAGE, model: e.model } }
  })
  return world
}

async function step($: any, turnId: string, index = 0) {
  const stream = $.turn.step({ turnId, index, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1 })
  for await (const _ of stream) {
    // drain
  }
}

async function turn($: any, text: string, turnId: string) {
  const sent = await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: sent.text, turnId })
  await step($, turnId)
  await $.turn.complete({ turnId, answer: '', durationMs: 10, isAborted: false, reason: 'answer', usage: { ...USAGE, model: 'x' } })
  return sent
}

function samplesOf(n: number, tier: 0 | 1 | 2, outcome: Sample['outcome'], score = 1, groups: string[] = []): Sample[] {
  return Array.from({ length: n }, (_, i) => ({ id: `${tier}-${outcome}-${i}`, at: i, tier, score, groups, outcome }))
}

describe('1. calibração', () => {
  test('nada muda antes de 20 pedidos', () => {
    expect(calibrate(samplesOf(MIN_SAMPLES - 1, 0, 'escalado'))).toBe(undefined)
  })
  test('um Haiku que erra muito baixa o limite dele; um que nunca erra sobe', () => {
    const bad = calibrate([...samplesOf(15, 0, 'escalado'), ...samplesOf(10, 0, 'ok')])
    expect((bad?.thresholds[0] ?? 99) < THRESHOLDS[0]).toBe(true)
    const good = calibrate(samplesOf(30, 0, 'ok'))
    expect((good?.thresholds[0] ?? 0) > THRESHOLDS[0]).toBe(true)
    // Bounded and smoothed: never far from the default.
    let cal = bad
    for (let i = 0; i < 50; i += 1) cal = calibrate([...samplesOf(25, 0, 'errou')], cal)
    expect((cal?.thresholds[0] ?? 0) >= THRESHOLDS[0] - 1.5).toBe(true)
  })
  test('confiança calibrada é a taxa de acerto real do grupo', () => {
    const cal = calibrate([...samplesOf(16, 0, 'ok'), ...samplesOf(4, 0, 'errou')])
    const conf = calibratedConfidence(cal, 0, 1)
    expect(conf?.n).toBe(20)
    expect(conf?.rate).toBe(0.8)
  })
  test('grupos que falham ganham peso', () => {
    const cal = calibrate([...samplesOf(12, 0, 'escalado', 1, ['depurar']), ...samplesOf(10, 0, 'ok')])
    expect((cal?.groupShift.depurar ?? 0) > 0).toBe(true)
  })
  test('o próximo "não funcionou" marca o pedido anterior', () => {
    const list = markLast(samplesOf(2, 0, 'ok'), 'frustracao')
    expect(list[1]?.outcome).toBe('frustracao')
    expect(list[0]?.outcome).toBe('ok')
  })
})

describe('2. patinando', () => {
  test('mesma chamada 3 vezes, mesmo arquivo editado 4 vezes, 3 erros', () => {
    let slip = EMPTY_SLIP
    for (let i = 0; i < 3; i += 1) slip = noteCall(slip, { tool: 'Read', file_path: '/a.ts', tool_use_id: `x${i}` }, false)
    expect(slipReason(slip)).toContain('repetiu a mesma chamada de Read')

    slip = EMPTY_SLIP
    for (let i = 0; i < 4; i += 1) slip = noteCall(slip, { tool: 'Edit', file_path: '/b.ts', old_string: `${i}`, new_string: 'y' }, false)
    expect(slipReason(slip)).toContain('editou b.ts 4 vezes')

    slip = EMPTY_SLIP
    for (let i = 0; i < 3; i += 1) slip = noteCall(slip, { tool: 'Bash', command: `ls ${i}` }, true)
    expect(slipReason(slip)).toContain('3 erros')

    slip = noteCall(EMPTY_SLIP, { tool: 'Bash', command: 'ls' }, false)
    expect(slipReason(slip)).toBe(undefined)
  })

  test('no turno, o Haiku que repete a mesma leitura sobe para o Sonnet', async ($, on) => {
    const world = engine(on)
    await $.session.start({ cwd: '/proj', surface: 'desktop', isInteractive: true })
    await $.prompt.submit({ text: 'quantos arquivos tem aqui?', wait: false, origin: { kind: 'composer' } })
    await $.turn.start({ text: 'x', turnId: 't1' })
    await step($, 't1', 0)
    for (let i = 0; i < 3; i += 1) await $.tool.call({ tool: 'Read', file_path: '/proj/a.ts' })
    await step($, 't1', 1)
    expect(world.models).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5'])
    const why = await $.command.run({ command: 'automodelo', args: 'porque detalhes', ...RUN })
    expect(why.text).toContain('patinando')
  })
})

describe('3. perfil por projeto', () => {
  test('perfil sonnet: uma pergunta simples deste projeto vai no mínimo para o Sonnet', async ($, on) => {
    const world = engine(on)
    await $.session.start({ cwd: 'C:\\projeto', surface: 'desktop', isInteractive: true })
    const set = await $.command.run({ command: 'automodelo', args: 'perfil sonnet', ...RUN })
    expect(set.text).toContain('mínimo Sonnet')
    const shown = await $.command.run({ command: 'automodelo', args: 'perfil', ...RUN })
    expect(shown.text).toContain('Sonnet')
    await turn($, 'quantos arquivos tem aqui?', 't1')
    expect(world.models).toEqual(['claude-sonnet-5-5'])
    const cleared = await $.command.run({ command: 'automodelo', args: 'perfil limpar', ...RUN })
    expect(cleared.text).toContain('removido')
    await turn($, 'quantas pastas tem aqui?', 't2')
    expect(world.models[1]).toBe('claude-haiku-5-5')
  })
})

describe('4. modelo e esforço juntos', () => {
  test('a combinação mais barata que dá conta', () => {
    // Easy: Haiku low.
    expect(cheapestCombo(0, 0, S, THRESHOLDS)).toEqual({ tier: 0, effort: 'low', reach: 1, cost: 0.8 })
    // Middle of Sonnet's band: Sonnet medium.
    const mid = cheapestCombo(4, 0, S, THRESHOLDS)
    expect(mid?.tier).toBe(1)
    expect(mid?.effort).toBe('medium')
    // Just past Sonnet's band: Opus low is cheaper than Sonnet xhigh.
    const edge = cheapestCombo(6, 0, S, THRESHOLDS)
    expect(edge?.tier).toBe(2)
    expect(edge?.effort).toBe('low')
    // Top of Sonnet's band: Sonnet high, cheaper than any Opus.
    const top = cheapestCombo(5.4, 0, S, THRESHOLDS)
    expect(top?.tier).toBe(1)
    expect(top?.effort).toBe('high')
  })
  test('a tarefa média vai com Sonnet e esforço alto em vez de Opus', async ($, on) => {
    // The classifier gives no answer, so the rules' score (5, near the top of
    // Sonnet's band) stands: Sonnet with high effort reaches it for less than Opus.
    const world = engine(on, { label: undefined })
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await turn($, 'analise o arquivo vendas.json e diga quais produtos venderam mais', 't1')
    expect(world.models[0]).toBe('claude-sonnet-5-5')
    expect(world.efforts[0]).toBe('high')
  })
})

describe('5. orçamento do Opus', () => {
  test('a conta do mês', () => {
    let days = addDay({}, '2026-10-01', 2, 1000, S.prices)
    days = addDay(days, '2026-10-02', 0, 1000, S.prices)
    days = addDay(days, '2026-09-30', 2, 99999, S.prices)
    const month = monthOf(days, '2026-10-15')
    expect(month.actual).toBe(6000)
    expect(month.top).toBe(5000)
    expect(budgetRatio({ ...S, opusBudget: 50 }, month)).toBe(5000 / 6000 / 0.5)
    expect(budgetRatio(S, month)).toBe(undefined)
  })
  test('esgotado: o Opus vira Sonnet; perto do limite a barra sobe', () => {
    const d = { tier: 2, reason: 'tarefa complexa', layer: 'regras', score: 7, confidence: 1, ctx: 0, at: 0, detail: [] } as const
    const base = { score: 7, text: 'construa um site', settings: S, thresholds: THRESHOLDS, floor: undefined, baseEffort: 'medium', calibration: undefined } as const
    expect(refine(d, { ...base, budget: 1.2 }).tier).toBe(1)
    expect(refine(d, { ...base, budget: 0.9 }).tier).toBe(1)
    expect(refine({ ...d, score: 11 }, { ...base, score: 11, budget: 0.7 }).tier).toBe(2)
    expect(refine(d, { ...base, budget: 0.3 }).tier).toBe(2)
  })
  test('comando, aviso de 80% uma vez e Opus só com !opus', async ($, on) => {
    const world = engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const set = await $.command.run({ command: 'automodelo', args: 'orcamento opus 10', ...RUN })
    expect(set.text).toContain('10%')
    // An Opus turn spends the month's budget.
    await turn($, '!opus construa um dashboard de clima para Nova York', 't1')
    await turn($, 'construa um dashboard de vendas completo para a empresa', 't2')
    expect(world.models[1]).toBe('claude-sonnet-5-5')
    expect(world.toasts.filter(t => t.includes('Orçamento do Opus')).length).toBe(1)
    await turn($, 'construa outro dashboard de vendas completo', 't3')
    expect(world.toasts.filter(t => t.includes('Orçamento do Opus')).length).toBe(1)
    const status = await $.command.run({ command: 'automodelo', args: 'orcamento', ...RUN })
    expect(status.text).toContain('Esgotado')
    await turn($, '!opus construa mais um dashboard', 't4')
    expect(world.models[3]).toBe('claude-opus-5-5')
    const cleared = await $.command.run({ command: 'automodelo', args: 'orcamento limpar', ...RUN })
    expect(cleared.text).toContain('removido')
  })
})

const BAND = {
  plugin: 'auto-model',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

describe('6. prévia ao digitar', () => {
  test('a faixa mostra para onde o rascunho vai e deixa escolher o próximo modelo', async ($, on) => {
    const world = engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await $.prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: 'construa um site completo para a padaria' })
    // The draft is read once the person pauses; with no router here the free rules answer.
    await world.clock.advance(800)

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ ...BAND, surface })
      // 0.7.0: the preview runs the send's own pipeline, classifier included, so it shows what the
      // send would pick here (this engine's classifier says "simples"), not a rules-only guess.
      expect((await ui.find({ type: 'Text', text: /Próximo pedido → Haiku/ })) !== undefined).toBe(true)
      await ui.unmount()
    }

    // Two presses: Haiku, then Sonnet, for the next prompt only.
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    await ui.press({ key: 'auto-model-escolher' })
    await ui.press({ key: 'auto-model-escolher' })
    expect((await ui.find({ type: 'Text', text: /Próximo pedido → Sonnet \(escolhido por você\)/ })) !== undefined).toBe(true)
    await ui.unmount()

    const sent = await turn($, 'construa um site completo para a padaria', 't1')
    expect(sent.text).toBe('construa um site completo para a padaria')
    expect(world.models[0]).toBe('claude-sonnet-5-5')
    // One-shot: the next prompt is automatic again.
    await turn($, 'construa um site completo para o mercado da esquina', 't2')
    expect(world.models[1]).toBe('claude-opus-5-5')
  })
  test('rascunho vazio tira a prévia', async ($, on) => {
    engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await $.prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: 'quantos arquivos?' })
    await $.prompt.edit({ origin: { kind: 'composer' }, text: 'quantos arquivos?', cursor: 17, start: 0, end: 17, inputText: '' })
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect((await ui.find({ type: 'Text', text: /Próximo pedido/ })) === undefined).toBe(true)
    await ui.unmount()
  })
})

const PANE = {
  plugin: 'auto-model',
  component: 'Pane',
  requestId: 'auto-model',
  props: { title: 'Auto Model', isFocused: false, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

describe('8. prova de economia', () => {
  test('14 dias, total e dias de plano', () => {
    let days = addDay({}, '2026-10-14', 0, 1000, S.prices)
    days = addDay(days, '2026-10-15', 2, 1000, S.prices)
    const proof = proofOf(days, '2026-10-15', NOW, 0)
    expect(proof.days.length).toBe(14)
    expect(proof.days[13]?.key).toBe('2026-10-15')
    expect(proof.opus).toBe(10000)
    expect(proof.actual).toBe(6000)
    expect(proof.savedPercent).toBe(40)
    // Baseline: 10000 always-Opus over 2 active days = 5000 a day; saved 4000 = 0,8 day.
    expect(proof.planDays).toBe(0.8)
    expect(proofOf(days, '2026-10-15', NOW, 2000).planDays).toBe(2)
  })
  test('o painel mostra a prova, estreito e largo', async ($, on) => {
    engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await turn($, 'quantos arquivos tem aqui?', 't1')
    for (const surface of ['terminal', 'desktop'] as const) {
      for (const bodyColumns of [32, 120]) {
        const ui = await $.ui.mount({ ...PANE, surface, props: { ...PANE.props, bodyColumns } })
        // The fold stays open from the last mount: press it only when it is shut.
        if (surface === 'desktop' && (await ui.find({ type: 'Text', text: /dias de plano/ })) === undefined) await ui.press({ key: 'advanced' })
        const title = surface === 'terminal' ? /PROVA DE ECONOMIA/ : /ÚLTIMOS 14 DIAS/
        expect((await ui.find({ type: 'Text', text: title })) !== undefined).toBe(true)
        expect((await ui.find({ type: 'Text', text: /dias de plano/ })) !== undefined).toBe(true)
        await ui.unmount()
      }
    }
  })
})

describe('10. modos', () => {
  test('silencioso mostra só o modelo; explicativo, o porquê e a frase na faixa', async ($, on) => {
    const world = engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await $.command.run({ command: 'automodelo', args: 'modo silencioso', ...RUN })
    await turn($, 'quantos arquivos tem aqui?', 't1')
    // 0.8.2: the status line is gone; the footer label and the band say it.
    expect(world.statuses.length).toBe(0)
    let ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect((await ui.find({ type: 'Text', text: /^● Haiku · esforço baixo$/ })) !== undefined).toBe(true)
    expect((await ui.find({ type: 'Text', text: /Confiança/ })) === undefined).toBe(true)
    await ui.unmount()

    await $.command.run({ command: 'automodelo', args: 'modo explicativo', ...RUN })
    await turn($, 'quantas pastas tem aqui?', 't2')
    expect(world.statuses.length).toBe(0)
    ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect((await ui.find({ type: 'Text', text: /^● Haiku · esforço baixo$/ })) !== undefined).toBe(true)
    expect((await ui.find({ type: 'Text', text: /Confiança/ })) !== undefined).toBe(true)
    await ui.unmount()
  })
})

describe('11. palavras críticas', () => {
  test('acha a palavra, sem acento e inteira', () => {
    expect(criticalHit('Faça o deploy agora', S.criticals)).toBe('deploy')
    expect(criticalHit('qual a SENHA do wifi?', S.criticals)).toBe('senha')
    expect(criticalHit('mexe no banco de dados', S.criticals)).toBe('banco de dados')
    expect(criticalHit('deployment notes', S.criticals)).toBe(undefined)
    expect(criticalHit('quantos arquivos?', S.criticals)).toBe(undefined)
  })
  test('pergunta simples com palavra crítica vai no mínimo para o Sonnet; lista configurável', async ($, on) => {
    const world = engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await turn($, 'quantos arquivos de produção tem aqui?', 't1')
    expect(world.models[0]).toBe('claude-sonnet-5-5')
    const add = await $.command.run({ command: 'automodelo', args: 'config criticos adicionar cliente', ...RUN })
    expect(add.text).toContain('cliente')
    await turn($, 'quantos cliente tem aqui?', 't2')
    expect(world.models[1]).toBe('claude-sonnet-5-5')
    const rm = await $.command.run({ command: 'automodelo', args: 'config criticos remover cliente', ...RUN })
    expect(rm.text).toContain('saiu')
    await turn($, 'quantos cliente tem aqui?', 't3')
    expect(world.models[2]).toBe('claude-haiku-5-5')
  })
})

describe('12. exportar e ajuda', () => {
  test('/automodelo exportar grava .md e .csv na pasta do projeto', async ($, on) => {
    const world = engine(on)
    await $.session.start({ cwd: 'C:\\projeto', surface: 'desktop', isInteractive: true })
    await turn($, 'quantos arquivos tem aqui?', 't1')
    const out = await $.command.run({ command: 'automodelo', args: 'exportar', ...RUN })
    const md = 'C:/projeto/automodelo-relatorios/automodelo-2026-10-15.md'
    const csv = 'C:/projeto/automodelo-relatorios/automodelo-2026-10-15.csv'
    expect(out.text).toContain(md)
    expect(world.files[md]).toContain('# Relatório do Auto Model')
    expect(world.files[csv]?.split('\n')[0]).toBe('tipo,data,modelo,resultado,pontuacao,grupos,custo_real,custo_sempre_opus,pedidos,uso_semana_estimado_pct')
    expect(world.files[csv]).toContain('decisao,2026-10-15,Haiku,ok')
  })
  test('csv escapa vírgulas', () => {
    expect(exportCsv([{ id: 'a', at: NOW, tier: 0, score: 1.5, groups: ['a', 'b'], outcome: 'ok' }], {})).toContain('"1,5"')
  })
  test('/automodelo ajuda lista os comandos', async ($, on) => {
    engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const help = await $.command.run({ command: 'automodelo', args: 'ajuda', ...RUN })
    for (const word of ['perfil', 'orcamento', 'modo', 'exportar', 'criticos', 'porque detalhes']) {
      expect(help.text).toContain(word)
    }
  })
})

describe('calibração no uso real', () => {
  test('depois de 20 pedidos respondidos, porque detalhes diz que está calibrado', async ($, on) => {
    engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    for (let i = 0; i < 21; i += 1) await turn($, `quantos arquivos tem na pasta ${i}?`, `t${i}`)
    const why = await $.command.run({ command: 'automodelo', args: 'porque detalhes', ...RUN })
    expect(why.text).toContain('Calibração ativa')
    expect(why.text).toContain('Confiança calibrada')
  })
})

void DAY

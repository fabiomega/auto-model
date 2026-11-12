import { describe, expect, mock, test } from 'claude-code/testing'

import { DEFAULT_SETTINGS, applySetting } from '../hooks/logic'
import { exportCsv } from '../hooks/round2'
import {
  EMPTY_METER,
  addEstimate,
  applyUsage,
  crossedThresholds,
  fmtPct,
  officialReading,
  parseTokens,
  pctOf,
  rollMeter,
  usageLine,
  usagePeak,
  usageTone,
  warningsFor,
  weekKeyOf,
} from '../hooks/round5'

const S = DEFAULT_SETTINGS
const USAGE = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const
const NOW = new Date(2026, 9, 15, 12).getTime()

const BAND = {
  plugin: 'auto-model',
  component: 'AbovePrompt',
  requestId: 'above',
  props: { hasSurvey: false, isWorking: false, view: {} },
} as const

describe('2. medidor de uso: as contas', () => {
  test('uma porcentagem é os tokens sobre o orçamento', () => {
    expect(pctOf(500_000, 5_000_000)).toBe(10)
    expect(pctOf(1, 0)).toBe(0)
  })
  test('a semana começa na segunda, às 00:00 do dia', () => {
    const wednesday = new Date(2026, 9, 14, 15).getTime()
    const monday = new Date(2026, 9, 12, 12).getTime()
    expect(weekKeyOf(wednesday)).toBe(weekKeyOf(monday))
    expect(weekKeyOf(new Date(2026, 9, 18, 12).getTime())).toBe(weekKeyOf(monday))
    expect(weekKeyOf(new Date(2026, 9, 19, 12).getTime())).not.toBe(weekKeyOf(monday))
  })
  test('a linha mostra antes → depois e a variação, com vírgula, e diz de onde veio o número', () => {
    const line = usageLine({ source: 'medido', from: { session: 38, week: 52 }, to: { session: 41, week: 53 } })
    expect(line).toBe('Sessão 38% → 41% (+3%) · Semana 52% → 53% (+1%) · medido')
    const est = usageLine({ source: 'estimado', from: { session: 1.25, week: 2 }, to: { session: 1.5, week: 2 } })
    expect(est).toBe('Sessão 1,3% → 1,5% (+0,3%) · Semana 2% → 2% (0%) · estimado')
  })
  test('a cor segue o maior número: verde até 70, dourado até 90, vermelho dali em diante', () => {
    expect(usageTone(69.9)).toBe('good')
    expect(usageTone(70)).toBe('accent')
    expect(usageTone(89.9)).toBe('accent')
    expect(usageTone(90)).toBe('bad')
    expect(usagePeak({ source: 'medido', from: { session: 1, week: 9 }, to: { session: 4, week: 12 } })).toBe(12)
    expect(fmtPct(41)).toBe('41')
    expect(fmtPct(41.26)).toBe('41,3')
  })
  test('o medidor soma cada pedido nos dois orçamentos e zera quando a sessão ou a semana mudam', () => {
    const meter = rollMeter(null, NOW, NOW)
    const after = addEstimate(meter, 1_000_000, { ...S, sessionTokens: 5_000_000, weekTokens: 40_000_000 })
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-9
    expect(near(after.est.session, 20)).toBe(true)
    expect(near(after.est.week, 2.5)).toBe(true)
    const nextSession = rollMeter(after, NOW + 1000, NOW)
    expect(nextSession.est.session).toBe(0)
    expect(near(nextSession.est.week, 2.5)).toBe(true)
    const nextWeek = rollMeter(after, NOW, NOW + 7 * 86_400_000)
    expect(nextWeek.est.week).toBe(0)
    expect(near(nextWeek.est.session, 20)).toBe(true)
    expect(EMPTY_METER.est).toEqual({ session: 0, week: 0 })
  })
})

describe('3. mostrar ou ocultar, e os tamanhos', () => {
  test('o medidor começa ligado; ligar e desligar mudam só essa escolha', () => {
    expect(S.isUsageOn).toBe(true)
    const on = applyUsage(S, ['ligar'])
    expect('error' in on).toBe(false)
    if ('error' in on) return
    expect(on.settings.isUsageOn).toBe(true)
    const off = applyUsage(on.settings, ['desligar'])
    if ('error' in off) throw new Error('should not fail')
    expect(off.settings.isUsageOn).toBe(false)
  })
  test('orçamentos aceitam 5m, 800k e 5000000, e recusam o que não é número', () => {
    expect(parseTokens('5m')).toBe(5_000_000)
    expect(parseTokens('800k')).toBe(800_000)
    expect(parseTokens('5000000')).toBe(5_000_000)
    expect(parseTokens('1,5m')).toBe(1_500_000)
    expect(parseTokens('muito')).toBeUndefined()
    expect(parseTokens('0')).toBeUndefined()
    const set = applyUsage(S, ['sessao', '5m'])
    if ('error' in set) throw new Error('should not fail')
    expect(set.settings.sessionTokens).toBe(5_000_000)
    expect('error' in applyUsage(S, ['semana', 'nada'])).toBe(true)
  })
  test('o comando de configuração não muda com isso e a configuração nova existe nos padrões', () => {
    expect(S.weekTokens).toBe(40_000_000)
    expect('error' in applySetting(S, ['uso', 'ligar'])).toBe(true)
  })
})

describe('4. avisos em 80% e 90%', () => {
  test('um limite é cruzado uma vez: de 75 para 85 avisa o 80, de 85 para 91 avisa o 90', () => {
    expect(crossedThresholds(75, 85)).toEqual([80])
    expect(crossedThresholds(85, 91)).toEqual([90])
    expect(crossedThresholds(70, 95)).toEqual([80, 90])
    expect(crossedThresholds(81, 89)).toEqual([])
  })
  test('cada limite avisa uma só vez por período; a semana nova avisa de novo', () => {
    const periods = { session: 'a', week: 'w1' }
    const first = warningsFor({ session: 75, week: 10 }, { session: 85, week: 10 }, periods, [])
    expect(first.map(w => w.text)).toEqual(['Limite da sessão em 80%'])
    const again = warningsFor({ session: 75, week: 10 }, { session: 85, week: 10 }, periods, first.map(w => w.key))
    expect(again).toEqual([])
    const newWeek = warningsFor({ session: 10, week: 75 }, { session: 10, week: 85 }, { session: 'a', week: 'w2' }, first.map(w => w.key))
    expect(newWeek.map(w => w.text)).toEqual(['Limite da semana em 80%'])
  })
})

describe('5. oficial ou estimado', () => {
  test('o oficial só vale quando as duas janelas existem; metade de uma leitura vira estimado', () => {
    expect(officialReading([{ kind: 'five_hour', percentUsed: 38 }, { kind: 'seven_day', percentUsed: 52 }])).toEqual({ session: 38, week: 52 })
    expect(officialReading([{ kind: 'five_hour', percentUsed: 38 }])).toBeNull()
    expect(officialReading([])).toBeNull()
    expect(officialReading([{ kind: 'five_hour', percentUsed: Number.NaN }, { kind: 'seven_day', percentUsed: 1 }])).toBeNull()
  })
})

describe('6. exportação com a coluna de uso', () => {
  test('cada dia ganha a porcentagem da semana que o dia usou; decisões ficam em branco nessa coluna', () => {
    const csv = exportCsv(
      [{ id: 'a', at: NOW, tier: 0, score: 1.5, groups: ['a'], outcome: 'ok' }],
      { '2026-10-15': { actual: 10, opus: 50, top: 0, turns: 2, units: 4_000_000 } },
      40_000_000,
    )
    const rows = csv.trim().split('\n')
    expect(rows[0]).toBe('tipo,data,modelo,resultado,pontuacao,grupos,custo_real,custo_sempre_opus,pedidos,uso_semana_estimado_pct')
    expect(rows[1]?.endsWith('a,,,,')).toBe(true)
    expect(rows[2]).toBe('dia,2026-10-15,,,,,10,50,2,"10,00"')
  })
})

describe('7. ponta a ponta: a faixa mostra o uso medido', () => {
  test('com o medidor ligado, a faixa mostra Sessão e Semana com a leitura oficial do Claude', async ($, on) => {
    mock.store(on)
    mock.clock(on, { now: NOW })
    const readings = [
      [{ kind: 'five_hour', percentUsed: 38 }, { kind: 'seven_day', percentUsed: 52 }],
      [{ kind: 'five_hour', percentUsed: 41 }, { kind: 'seven_day', percentUsed: 53 }],
    ]
    let call = 0
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    on('command.register', () => ({ value: { command: 'automodelo' } }))
    on('command.list', () => ({ value: [] }))
    on('command.run', () => ({ text: '' }))
    on('session.model', () => ({ value: 'claude-opus-5-5' }))
    on('session.usage', () => {
      const at = Math.min(call, readings.length - 1)
      call += 1
      return { value: { startedAt: NOW, context: {}, rateLimits: readings[at], cost: undefined } }
    })
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>engine</Text>
    })
    on('ui.status', () => ({ value: undefined }))
    on('ui.toast', () => ({ value: undefined }))
    on('prompt.submit', (_, e) => ({ text: e.text }))
    on('turn.start', (_, e) => ({ turnId: e.turnId }))
    on('turn.step', async function* (_, e) {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { ...USAGE, model: e.model } }
    })
    on('turn.complete', () => ({ text: '', usage: { ...USAGE, model: 'x' } }))

    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await $.command.run({ command: 'automodelo', args: 'uso ligar', ...RUN })
    const sent = await $.prompt.submit({ text: 'quantos arquivos tem aqui?', wait: false, origin: { kind: 'composer' } })
    await $.turn.start({ text: sent.text, turnId: 'u1' })
    for await (const _ of $.turn.step({ turnId: 'u1', index: 0, model: 'claude-opus-5-5', effort: 'high', messageCount: 1 })) {
      // drain
    }
    await $.turn.complete({ turnId: 'u1', answer: '', durationMs: 10, isAborted: false, reason: 'answer', usage: { ...USAGE, model: 'x' } })

    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    // 0.7.0: each window in its own text, with its own colour and sign.
    const session = await ui.find({ type: 'Text', text: /🟢 Sessão 38% → 41% \(\+3%\)/ })
    const week = await ui.find({ type: 'Text', text: /🟢 Semana 52% → 53% \(\+1%\)/ })
    const measured = await ui.find({ type: 'Text', text: /· medido/ })
    const effort = await ui.find({ type: 'Text', text: /● Haiku · esforço baixo/ })
    await ui.unmount()
    expect(session !== undefined).toBe(true)
    expect(week !== undefined).toBe(true)
    expect(measured !== undefined).toBe(true)
    expect(effort !== undefined).toBe(true)
  })
})

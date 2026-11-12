import { describe, expect, mock, test } from 'claude-code/testing'

import { DEFAULT_SETTINGS } from '../hooks/logic'
import { cacheGet, cachePut, keyOf, needOf, parseRoute, routeDecide, similar, tokensOf } from '../hooks/router'
import type { Example, Route } from '../hooks/router'

const S = DEFAULT_SETTINGS
const USAGE = { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const ROUTER_USAGE = { input_tokens: 600, output_tokens: 60, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } } as const
const NOW = new Date(2026, 9, 15, 12).getTime()

type OnFn = Parameters<Parameters<typeof test>[1]>[1]

const BUILD: Route = { raciocinio: 1, construcao: 2, passos: 2, ambiguidade: 1, risco: 0, continuacao: false, resumo: 'painel com dados ao vivo', confianca: 92 }
const COUNT: Route = { raciocinio: 0, construcao: 0, passos: 1, ambiguidade: 0, risco: 0, continuacao: false, resumo: 'contagem simples', confianca: 95 }
const RISKY: Route = { raciocinio: 1, construcao: 1, passos: 1, ambiguidade: 0, risco: 2, continuacao: false, resumo: 'mudança em produção', confianca: 85 }
const OTHER: Route = { raciocinio: 1, construcao: 1, passos: 1, ambiguidade: 1, risco: 0, continuacao: false, resumo: 'tarefa geral', confianca: 70 }

/** A stand-in for Haiku that judges by meaning, the same for every way of saying it. */
function judge(prompt: string): Route {
  const asked = (/Pedido:\n"""\n([\s\S]*?)\n"""/.exec(prompt)?.[1] ?? '').toLowerCase()
  if (/painel|dashboard|site|aplicativo|app\b/.test(asked)) return BUILD
  if (/quant[oa]s|how many/.test(asked)) return COUNT
  if (/deploy|produ[cç][aã]o/.test(asked)) return RISKY

  return OTHER
}

type Mode = 'judge' | 'garbage' | 'hang' | 'none'

type World = {
  models: string[]
  prompts: string[]
  clock: { advance: (ms: number) => Promise<void>; settle: () => Promise<void> }
}

function engine(on: OnFn, mode: Mode = 'judge'): World {
  mock.store(on)
  const clock = mock.clock(on, { now: NOW })
  const world: World = { models: [], prompts: [], clock }
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
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('model.classify', () => ({ value: 'simples' }))
  if (mode !== 'none') {
    on('model.complete', (_, e) => {
      world.prompts.push(e.prompt)
      if (mode === 'hang') return new Promise(() => undefined)
      const text = mode === 'garbage' ? 'Acho que é uma tarefa média, sei lá.' : JSON.stringify(judge(e.prompt))
      return { value: { isAnswered: true, text, usage: ROUTER_USAGE } }
    })
  }
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
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { ...USAGE, model: e.model } }
  })
  return world
}

async function turn($: any, text: string, turnId: string) {
  const sent = await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
  await $.turn.start({ text: sent.text, turnId })
  for await (const _ of $.turn.step({ turnId, index: 0, model: 'claude-opus-5-5', effort: 'medium', messageCount: 1 })) {
    // drain
  }
  await $.turn.complete({ turnId, answer: '', durationMs: 10, isAborted: false, reason: 'answer', usage: { ...USAGE, model: 'x' } })
  return sent
}

async function type($: any, text: string) {
  await $.prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: text })
}

const BAND = {
  plugin: 'auto-model',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

async function bandText($: any): Promise<string | undefined> {
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const found = await ui.find({ type: 'Text', text: /Próximo pedido/ })
  await ui.unmount()
  return found?.text
}

describe('o normalizador: mesmo sentido, mesma chave', () => {
  test('"Crie" e "Gere" (e os outros verbos de fazer) dão a mesma chave', () => {
    const crie = keyOf('Crie um painel meteorológico da cidade de Magé - RJ - Brasil.')
    for (const verb of ['Gere', 'Monte', 'Faça', 'Construa', 'Desenvolva', 'Elabore', 'Prepare']) {
      expect(keyOf(`${verb} um painel meteorológico da cidade de Magé - RJ - Brasil.`)).toBe(crie)
    }
    expect(keyOf('Preciso de um painel meteorológico de Magé')).toBe(keyOf('Quero um painel meteorológico de Magé'))
    // Accents, case, punctuation and plurals do not change the meaning.
    expect(keyOf('PAINÉIS de vendas!!')).toBe(keyOf('painel vendas'))
    expect(tokensOf('quantos arquivos tem aqui?')).toEqual(['arquivo', 'tem', '~consultar'])
  })
  test('cache: sete dias, ligado ao contexto só para pedidos curtos, no máximo 200', () => {
    let cache = cachePut({}, 'a b c d e', '', COUNT, NOW)
    expect(cacheGet(cache, 'a b c d e', '', NOW + 1000)?.resumo).toBe('contagem simples')
    expect(cacheGet(cache, 'a b c d e', '', NOW + 8 * 86_400_000)).toBe(undefined)
    expect(cacheGet(cache, 'a b c d e', '2:1', NOW)).toBe(undefined)
    for (let i = 0; i < 250; i += 1) cache = cachePut(cache, `k${i} x y z w`, '', COUNT, NOW + i)
    expect(Object.keys(cache).length).toBe(200)
  })
})

describe('a leitura do roteador', () => {
  test('JSON válido, mesmo com texto em volta; lixo vira undefined', () => {
    expect(parseRoute(`Claro: ${JSON.stringify(BUILD)} pronto`)?.resumo).toBe('painel com dados ao vivo')
    expect(parseRoute('{"raciocinio":9,"construcao":"2","passos":1,"ambiguidade":0,"risco":0,"resumo":"x y z","confianca":250}')?.raciocinio).toBe(3)
    expect(parseRoute('não sei')).toBe(undefined)
    expect(parseRoute('{"raciocinio":1}')).toBe(undefined)
    expect(parseRoute('{quebrado')).toBe(undefined)
  })
  test('a tabela fixa: contagem no Haiku, painel no Opus, risco no mínimo Sonnet', () => {
    const base = { isCached: false, text: 'x', settings: S, previous: undefined, ctx: 0, isCacheWarm: false, at: 0, thresholds: [2.5, 5.5, 9], floor: undefined, budget: undefined, baseEffort: 'medium', calibration: undefined } as const
    expect(routeDecide({ ...base, route: COUNT }).decision.tier).toBe(0)
    expect(routeDecide({ ...base, route: BUILD }).decision.tier).toBe(2)
    expect(routeDecide({ ...base, route: RISKY }).decision.tier >= 1).toBe(true)
    expect(needOf({ ...OTHER, construcao: 3 }) >= 7.6).toBe(true)
    // A continuation keeps the task's model.
    const kept = routeDecide({ ...base, route: { ...COUNT, continuacao: true }, previous: 2 })
    expect(kept.decision.tier).toBe(2)
    expect(kept.decision.reason).toBe('continua a tarefa anterior')
  })
  test('exemplos parecidos do histórico', () => {
    const ex = (text: string, tier: 0 | 1 | 2): Example => ({ key: keyOf(text), text, resumo: '', tier, outcome: 'ok', at: 0 })
    const list = [ex('quantos arquivos tem aqui', 0), ex('crie um painel de vendas', 2), ex('resuma este texto', 0)]
    const near = similar(list, keyOf('gere um painel de estoque'))
    expect(near[0]?.text).toBe('crie um painel de vendas')
  })
})

describe('paráfrases caem no mesmo modelo', () => {
  const GROUPS: { tier: string; texts: string[] }[] = [
    {
      tier: 'claude-opus-5-5',
      texts: [
        'Crie um painel meteorológico da cidade de Magé - RJ - Brasil.',
        'Gere um painel meteorológico da cidade de Magé - RJ - Brasil.',
        'Monte um painel meteorológico para Magé, no Rio de Janeiro',
        'Faça um painel do tempo de Magé RJ',
        'Construa um painel meteorológico de Magé',
        'Desenvolva um painel com a previsão do tempo de Magé',
        'Preciso de um painel meteorológico de Magé',
        'Build a weather dashboard for Magé, Brazil',
        'Make me a weather dashboard for Magé',
      ],
    },
    {
      tier: 'claude-haiku-5-5',
      texts: ['quantos arquivos tem nesta pasta?', 'Quantas pastas existem aqui no projeto?', 'how many files are in this folder?', 'me diga quantos arquivos há nesta pasta'],
    },
  ]
  for (const group of GROUPS) {
    test(`todas vão para ${group.tier}`, async ($, on) => {
      const world = engine(on)
      await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
      for (const [i, text] of group.texts.entries()) await turn($, text, `t${i}`)
      expect(world.models).toEqual(group.texts.map(() => group.tier))
    })
  }
  test('"Crie" e depois "Gere" o mesmo painel: uma análise só, a segunda vem do cache', async ($, on) => {
    const world = engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await turn($, 'Crie um painel meteorológico da cidade de Magé - RJ - Brasil.', 't1')
    await turn($, 'Gere um painel meteorológico da cidade de Magé - RJ - Brasil.', 't2')
    expect(world.prompts.length).toBe(1)
    expect(world.models).toEqual(['claude-opus-5-5', 'claude-opus-5-5'])
    const why = await $.command.run({ command: 'automodelo', args: 'porque detalhes', ...RUN })
    expect(why.text).toContain('Camada: roteador')
    expect(why.text).toContain('raciocínio 1 · construção 2 · passos 2')
    expect(why.text).toContain('veio do cache')
    const short = await $.command.run({ command: 'automodelo', args: 'porque', ...RUN })
    expect(short.text).toContain('painel com dados ao vivo')
    expect(short.text).toContain('Confiança 92%')
  })
})

describe('reserva quando o roteador falha', () => {
  test('passou de 2 segundos: decidem as regras, sem travar o pedido', async ($, on) => {
    const world = engine(on, 'hang')
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const sent = $.prompt.submit({ text: 'quantos arquivos tem nesta pasta?', wait: false, origin: { kind: 'composer' } })
    await world.clock.settle()
    await world.clock.advance(2100)
    await sent
    const why = await $.command.run({ command: 'automodelo', args: 'porque detalhes', ...RUN })
    expect(why.text).toContain('regras de reserva')
    expect(why.text).not.toContain('Camada: roteador')
  })
  test('resposta que não é JSON: decidem as regras', async ($, on) => {
    const world = engine(on, 'garbage')
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await turn($, 'quantos arquivos tem nesta pasta?', 't1')
    expect(world.prompts.length).toBe(1)
    expect(world.models).toEqual(['claude-haiku-5-5'])
    const why = await $.command.run({ command: 'automodelo', args: 'porque detalhes', ...RUN })
    expect(why.text).toContain('regras de reserva')
  })
  test('roteador desligado: nenhuma chamada, só regras', async ($, on) => {
    const world = engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    const off = await $.command.run({ command: 'automodelo', args: 'config roteador desligar', ...RUN })
    expect(off.text).toContain('Roteador desligado')
    await turn($, 'Gere um painel meteorológico da cidade de Magé', 't1')
    expect(world.prompts.length).toBe(0)
  })
  test('respostas curtas óbvias não gastam análise', async ($, on) => {
    const world = engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await turn($, 'Crie um painel meteorológico da cidade de Magé', 't1')
    await turn($, 'sim', 't2')
    expect(world.prompts.length).toBe(1)
    expect(world.models).toEqual(['claude-opus-5-5', 'claude-opus-5-5'])
  })
})

describe('prévia: espera a pausa, e o que ela mostra é o que roda', () => {
  test('analisando… até a pausa; várias teclas, uma análise; o envio reaproveita', async ($, on) => {
    const world = engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await type($, 'Gere um painel meteo')
    await world.clock.advance(300)
    await $.prompt.edit({ origin: { kind: 'composer' }, text: 'Gere um painel meteo', cursor: 20, start: 20, end: 20, inputText: 'rológico da cidade de Magé' })
    expect(await bandText($)).toBe('Próximo pedido · analisando…')
    expect(world.prompts.length).toBe(0)
    await world.clock.advance(800)
    expect(world.prompts.length).toBe(1)
    expect(await bandText($)).toBe('Próximo pedido → Opus · esforço médio · painel com dados ao vivo · 92%')
    // The send reads the same reading from the cache: no second call, the same model.
    await turn($, 'Gere um painel meteorológico da cidade de Magé', 't1')
    expect(world.prompts.length).toBe(1)
    expect(world.models).toEqual(['claude-opus-5-5'])
  })
  test('trocar só o verbo não faz nova análise', async ($, on) => {
    const world = engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await type($, 'Crie um painel meteorológico da cidade de Magé - RJ - Brasil.')
    await world.clock.advance(800)
    await $.prompt.edit({ origin: { kind: 'composer' }, text: 'Crie um painel meteorológico da cidade de Magé - RJ - Brasil.', cursor: 0, start: 0, end: 61, inputText: '' })
    await type($, 'Gere um painel meteorológico da cidade de Magé - RJ - Brasil.')
    expect(await bandText($)).toBe('Próximo pedido → Opus · esforço médio · painel com dados ao vivo · 92%')
    expect(world.prompts.length).toBe(1)
  })
  test('botão "Trocar modelo"', async ($, on) => {
    const world = engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await type($, 'quantos arquivos tem nesta pasta?')
    await world.clock.advance(800)
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    expect((await ui.find({ type: 'Button', label: 'Trocar modelo' })) !== undefined).toBe(true)
    await ui.unmount()
  })
})

describe('histórico pessoal e custo', () => {
  test('um pedido forçado vira exemplo no prompt do roteador', async ($, on) => {
    const world = engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await turn($, '!opus resuma o relatório de vendas do trimestre', 't1')
    await turn($, 'resuma o relatório de vendas do mês', 't2')
    const last = world.prompts[world.prompts.length - 1] ?? ''
    expect(last).toContain('Pedidos parecidos desta mesma pessoa')
    expect(last).toContain('resuma o relatório de vendas do trimestre" → Opus (forçado)')
    expect(last).toContain('Contexto da conversa: Tarefa anterior')
  })
  test('o painel mostra o custo do roteador', async ($, on) => {
    engine(on)
    await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
    await turn($, 'Crie um painel meteorológico da cidade de Magé', 't1')
    await turn($, 'Gere um painel meteorológico da cidade de Magé', 't2')
    const ui = await $.ui.mount({
      plugin: 'auto-model',
      component: 'Pane',
      requestId: 'auto-model',
      surface: 'desktop',
      props: { title: 'Auto Model', isFocused: false, bodyColumns: 120, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
    })
    await ui.press({ key: 'advanced' })
    const line = await ui.find({ type: 'Text', text: /Custo da análise/ })
    expect(line?.text).toContain('1 análises, 1 reaproveitadas')
    await ui.unmount()
  })
})

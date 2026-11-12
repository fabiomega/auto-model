import type {
  AutoModelApplied,
  AutoModelDay,
  AutoModelDecision,
  AutoModelSettings,
  AutoModelStats,
  AutoModelTier,
  AutoModelMeter,
  AutoModelView,
} from '../types'
import {
  MODEL_NAMES,
  effortName,
  effortShort,
  escalationRate,
  fmtCompact,
  fmtInt,
  fmtNumber,
  fmtPercent,
  savingsPercent,
  tokensSaved,
} from './logic'
import { ageText, projectionMinutes, projectionText, sessionResetText, shareText, signOf, toneOf, weekResetText } from './round8'
import { modelColor, shortLabel } from './round6'
import { GOLD, GREEN, MODEL_PALETTE, RED, areaChartSvg, ringSvg, stackedBarSvg, usageBarSvg } from './svgs'
import { C } from './theme'

// The elements the surface gave, passed in as plain values so this file never touches the engine.
type El = (props: Record<string, unknown>) => unknown
export type Els = { Box: El; Button: El; Text: El; Svg: El }

export type Proof = {
  days: { key: string; actual: number; opus: number }[]
  savedPercent: number
  planDays: number
  baseline: number
  opus: number
}

export type PaneData = {
  cols: number
  now: number
  version: string
  s: AutoModelSettings
  stats: AutoModelStats
  list: readonly AutoModelDecision[]
  days: Readonly<Record<string, AutoModelDay>>
  applied: AutoModelApplied | null
  meter: AutoModelMeter | null
  profile: AutoModelTier | null
  autoFloor: AutoModelTier | null
  view: AutoModelView
  summary: string | null
  proof: Proof
  /** The Opus budget used, 0 to 1 and beyond, when one is set. */
  ratio: number | undefined
  isCalibrated: boolean
  /** 0.8.0: "acerto do tempo: 78% (…)", once some estimated request finished. */
  timeAccuracy?: string
  actions: {
    setOn: (on: boolean) => unknown
    toggleUsage: () => unknown
    cycleStrategy: () => unknown
    cycleCeiling: () => unknown
    toggleExplain: () => unknown
    toggleSync: () => unknown
    toggleDetails: () => unknown
    toggleAdvanced: () => unknown
  }
}

const TONE = { good: GREEN, accent: GOLD, bad: RED } as const

/** "Reinicia em 2h 14min" from an ISO time; undefined when it is unknown or past. */
export function resetText(iso: string | undefined, now: number): string | undefined {
  if (iso === undefined) return undefined
  const ms = Date.parse(iso) - now
  if (!Number.isFinite(ms) || ms <= 0) return undefined
  const min = Math.round(ms / 60_000)
  if (min < 60) return `${min}min`
  const hours = Math.floor(min / 60)
  if (hours < 48) return `${hours}h ${String(min % 60).padStart(2, '0')}min`

  return `${Math.round(hours / 24)} dias`
}

const STRATEGY_LABEL = { economia: 'Economia', equilibrado: 'Equilibrado', qualidade: 'Qualidade' } as const

/** The premium pane for the graphical surfaces: cards, rings and charts, in plain words. */
export function premiumPane(els: Els, d: PaneData): unknown {
  const { Box, Button, Text, Svg } = els
  const { cols, s, stats, list, proof, view, actions } = d
  const isNarrow = cols < 44
  const MUTED = C.muted
  const MAIN = C.text

  const title = (label: string) => (
    <Text size="footnote" weight="semibold" color={MUTED}>
      {label}
    </Text>
  )
  const card = (key: string, children: unknown) => (
    <Box key={key} flexDirection="column" borderStyle="round" borderColor={C.hair} paddingX={2} paddingY={1} gap={1}>
      {children}
    </Box>
  )

  // ---- header: the title, the model running now, the on/off switch
  const applied = d.applied
  const chip =
    applied === null ? null : (
      <Text color={modelColor(applied.tier)} weight="semibold">
        {`● ${shortLabel(MODEL_NAMES[applied.tier], effortName(applied.effort))}`}
      </Text>
    )
  const toggle = s.isOn ? (
    <Button key="toggle" label="Desligar" onPress={() => actions.setOn(false)} />
  ) : (
    <Button key="toggle" label="Ligar" variant="primary" onPress={() => actions.setOn(true)} />
  )
  const header = (
    <Box key="header" flexDirection={isNarrow ? 'column' : 'row'} justifyContent="space-between" alignItems={isNarrow ? 'flex-start' : 'center'} gap={1}>
      <Box flexDirection="column">
        <Text size="heading" weight="bold" color={MAIN}>
          Auto Model
        </Text>
        <Text color={MUTED}>{`versão ${d.version}`}</Text>
      </Box>
      <Box flexDirection="row" gap={2} alignItems="center">
        {chip}
        {toggle}
      </Box>
    </Box>
  )

  // ---- hero: how much it saved
  const pct = savingsPercent(stats)
  const hero = card(
    'hero',
    <Box flexDirection={isNarrow ? 'column' : 'row'} gap={2} alignItems={isNarrow ? 'flex-start' : 'center'}>
      <Svg source={ringSvg(pct)} alt={`Anel mostrando ${pct}% de economia`} />
      <Box flexDirection="column">
        <Text size="title" weight="bold" tabular color={MAIN}>
          {`${pct}%`}
        </Text>
        <Text weight="semibold" color={MAIN}>
          de economia
        </Text>
        <Text size="caption" color={MUTED}>
          {`equivale a ${fmtCompact(tokensSaved(stats, s.prices))} tokens do Opus · estimativa`}
        </Text>
      </Box>
    </Box>,
  )

  // ---- usage: the two windows, measured only, each judged on its own
  const meter = d.meter
  const latest = meter?.latest ?? null
  const before = meter?.last?.from ?? null
  const usageRow = (name: string, to: number, from: number | undefined, reset: string | undefined) => {
    const tone = TONE[toneOf(to)]
    const shown = (n: number) => `${Math.round(n * 10) / 10}`.replace('.', ',')
    const delta = from === undefined ? undefined : Math.round((to - from) * 10) / 10

    return (
      <Box key={`u-${name}`} flexDirection="column">
        <Box flexDirection="row" justifyContent="space-between">
          <Text weight="medium" color={MAIN}>
            {`${signOf(to, false)} ${name}`}
          </Text>
          <Text tabular color={tone}>
            {from === undefined ? `${shown(to)}%` : `${shown(from)}% → ${shown(to)}% `}
            {delta !== undefined && <Text color={MUTED}>{`(${delta > 0 ? '+' : ''}${shown(delta)}%)`}</Text>}
          </Text>
        </Box>
        <Svg source={usageBarSvg(from ?? to, to, tone)} alt={`${name}: ${shown(to)}% usado`} />
        {reset !== undefined && (
          <Text size="caption" color={MUTED}>
            {`⏳ reinicia ${reset}`}
          </Text>
        )}
      </Box>
    )
  }
  const projection = latest === null || meter === null ? undefined : projectionText(projectionMinutes(meter.pace, latest, d.now))
  const shareLine = shareText(meter?.share ?? null)
  const usage = card(
    'usage',
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" justifyContent="space-between">
        {title('USO')}
        {s.isUsageOn && latest !== null && (
          <Text size="caption" color={MUTED}>
            {d.now - latest.at > 60_000 ? `medido ${ageText(latest.at, d.now)}` : 'medido'}
          </Text>
        )}
      </Box>
      {!s.isUsageOn ? (
        <Box flexDirection="row" gap={2} alignItems="center">
          <Text color={MUTED}>Medidor desligado.</Text>
          <Button key="usage-on" label="Ligar uso" onPress={() => actions.toggleUsage()} />
        </Box>
      ) : latest === null ? (
        <Text color={MUTED}>Sem leitura agora: os números aparecem quando o app informar os limites.</Text>
      ) : (
        <Box flexDirection="column" gap={1}>
          {usageRow('Sessão', latest.session, before?.session, sessionResetText(latest.sessionResetsAt, d.now))}
          {usageRow('Semana', latest.week, before?.week, weekResetText(latest.weekResetsAt, d.now))}
          {projection !== undefined && (
            <Text size="caption" color={C.warn}>
              {projection}
            </Text>
          )}
          {shareLine !== undefined && (
            <Text size="caption" color={MUTED}>
              {shareLine}
            </Text>
          )}
        </Box>
      )}
    </Box>,
  )

  // ---- the 14 days
  const chart = card(
    'chart',
    <Box flexDirection="column" gap={1}>
      {title('ÚLTIMOS 14 DIAS')}
      {proof.opus > 0 ? (
        <Svg source={areaChartSvg(proof.days)} alt="Gráfico dos últimos 14 dias: custo real contra custo se fosse sempre Opus" />
      ) : (
        <Text color={MUTED}>O gráfico aparece depois do primeiro pedido respondido.</Text>
      )}
      <Box flexDirection="row" gap={3} flexWrap="wrap">
        <Text size="caption" color={modelColor(0)}>
          ━ real
        </Text>
        <Text size="caption" color={MUTED}>
          ┅ se fosse sempre Opus
        </Text>
        <Text size="caption" color={MUTED}>
          ▒ economia
        </Text>
      </Box>
    </Box>,
  )

  // ---- the share of each model
  const total = stats.byTier.reduce((a, b) => a + b, 0)
  const share = card(
    'share',
    <Box flexDirection="column" gap={1}>
      {title('POR MODELO')}
      <Svg source={stackedBarSvg(stats.byTier, MODEL_PALETTE)} alt="Divisão dos pedidos entre os modelos" />
      <Box flexDirection="row" gap={3} flexWrap="wrap">
        {MODEL_NAMES.map((name, i) => {
          const n = stats.byTier[i] ?? 0
          if (n === 0 && i === 3) return null

          return (
            <Text key={`m-${name}`} size="caption" color={MUTED}>
              <Text color={modelColor(i as AutoModelTier)}>●</Text>
              {` ${name} ${total === 0 ? 0 : Math.round((n / total) * 100)}%`}
            </Text>
          )
        })}
      </Box>
    </Box>,
  )

  // ---- the latest decisions
  const shownRows = list.length === 0 ? [] : [...list].reverse().slice(0, view.details ? 10 : 5)
  const rows = shownRows.map((x, i) => (
    <Box key={`d-${i}`} flexDirection="column">
      <Box flexDirection="row" gap={2} alignItems="center">
        <Text color={modelColor(x.tier)}>●</Text>
        <Text weight="medium" color={MAIN}>
          {MODEL_NAMES[x.tier]}
        </Text>
        {x.effort !== undefined && (
          <Text size="caption" color={MUTED}>
            {effortShort(x.effort)}
          </Text>
        )}
        <Box flexGrow={1} flexShrink={1}>
          <Text color={MUTED} wrap="truncate-end">
            {x.summary ?? x.reason}
          </Text>
        </Box>
        <Text tabular size="caption" color={MUTED}>
          {fmtPercent(x.confidence)}
        </Text>
      </Box>
      {view.details && (
        <Box paddingLeft={4}>
          <Text size="caption" color={MUTED} wrap="wrap">
            {[`${x.layer} · ${x.layer === 'roteador' ? 'necessidade' : 'pontuação'} ${fmtNumber(x.score)}`, ...x.detail.slice(0, 4)].join(' · ')}
          </Text>
        </Box>
      )}
    </Box>
  ))
  const decisions = card(
    'decisions',
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        {title('DECISÕES RECENTES')}
        {list.length > 0 && (
          <Button key="details" label={view.details ? 'ocultar detalhes' : 'ver detalhes'} onPress={() => actions.toggleDetails()} />
        )}
      </Box>
      {rows.length === 0 ? <Text color={MUTED}>Nenhuma decisão ainda. Envie um pedido e ela aparece aqui.</Text> : rows}
    </Box>,
  )

  // ---- advanced numbers, folded away
  const routerCost = stats.routerCost ?? 0
  const net = stats.opusCost > 0 ? Math.max(0, Math.round(((stats.opusCost - stats.actualCost - routerCost) / stats.opusCost) * 100)) : 0
  const line = (key: string, text: string) => (
    <Text key={key} size="caption" color={MUTED} wrap="wrap">
      {text}
    </Text>
  )
  const advancedLines = [
    line('esc', `Vezes em que precisou subir de modelo: ${escalationRate(stats)}% (quanto menor, mais certeira a escolha)`),
    line(
      'router',
      s.isRouterOn
        ? `Custo da análise: ${fmtInt(routerCost)} · ${stats.routerCalls ?? 0} análises, ${stats.routerHits ?? 0} reaproveitadas · economia líquida ${net}%`
        : 'Análise desligada: só as regras grátis decidem.',
    ),
    line(
      'proof',
      proof.opus > 0
        ? `Economia total ${proof.savedPercent}% · cerca de ${fmtNumber(proof.planDays)} dias de plano (estimativa, base de um dia ${fmtInt(proof.baseline)})`
        : 'A economia total aparece depois do primeiro pedido respondido.',
    ),
    ...(d.ratio === undefined
      ? []
      : [line('budget', `Orçamento do Opus: ${fmtPercent(Math.min(d.ratio, 9.99))} usado (limite de ${fmtNumber(s.opusBudget ?? 0)}% do mês)`)]),
    line(
      'project',
      `Projeto: ${d.profile === null ? 'sem perfil manual' : `piso manual ${MODEL_NAMES[d.profile]}`}${d.autoFloor === null ? '' : ` · piso aprendido ${MODEL_NAMES[d.autoFloor]}`}${d.isCalibrated ? ' · calibrado com o seu histórico' : ''}`,
    ),
    ...(d.timeAccuracy === undefined ? [] : [line('time', d.timeAccuracy)]),
    line('version', `Versão ${d.version} · valores estimados contra usar sempre o Opus`),
  ]
  const advanced = card(
    'advanced',
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="row" justifyContent="space-between" alignItems="center">
        {title('AVANÇADO')}
        <Button key="advanced" label={view.advanced ? 'ocultar' : 'mostrar'} onPress={() => actions.toggleAdvanced()} />
      </Box>
      {view.advanced && <Box flexDirection="column">{advancedLines}</Box>}
    </Box>,
  )

  // ---- the settings, one press each
  const settings = (
    <Box key="settings" flexDirection="row" gap={1} flexWrap="wrap">
      <Button key="s-usage" label={s.isUsageOn ? 'Uso: ligado' : 'Uso: desligado'} onPress={() => actions.toggleUsage()} />
      <Button key="s-mode" label={`Modo: ${STRATEGY_LABEL[s.strategy].toLowerCase()}`} onPress={() => actions.cycleStrategy()} />
      <Button key="s-ceiling" label={`Teto: ${MODEL_NAMES[s.ceiling]}`} onPress={() => actions.cycleCeiling()} />
      <Button key="s-explain" label={s.mode === 'explicativo' ? 'Explicar: ligado' : 'Explicar: desligado'} onPress={() => actions.toggleExplain()} />
      <Button key="s-sync" label={s.isSyncOn ? 'Sincronizar: ligado' : 'Sincronizar: desligado'} onPress={() => actions.toggleSync()} />
    </Box>
  )

  return (
    <Box flexDirection="column" gap={1} width={cols}>
      {header}
      {hero}
      {d.summary !== null && (
        <Text size="caption" color={MUTED} wrap="wrap">
          {d.summary}
        </Text>
      )}
      {usage}
      {chart}
      {share}
      {decisions}
      {advanced}
      {settings}
    </Box>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { STAT_KEYS, type StatKey, type UnitInstance } from '@war/engine'
import type { Wallet } from '@war/core'
import { gachaCtx, service } from '../services.ts'
import { CardInfo } from './CardInfo.tsx'
import { costText, CURRENCY_LABEL, SPECIAL_LABEL, specialText, STAT_LABEL } from './format.ts'
import { UnitRow } from './UnitRow.tsx'

const statSum = (u: UnitInstance) => STAT_KEYS.reduce((s, k) => s + u.stats[k], 0)

function useUnits(version: number) {
  const [units, setUnits] = useState<UnitInstance[] | null>(null)
  useEffect(() => {
    void service.listUnits().then(setUnits)
  }, [version])
  return units
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? <div className="error">{error}</div> : null
}

// ───────────── 뽑기 ─────────────

export function GachaScreen({ onChanged, onOpen }: { onChanged: () => void; onOpen: (id: string) => void }) {
  const [result, setResult] = useState<UnitInstance[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const doPull = async (n: 1 | 10) => {
    setBusy(true)
    setError(null)
    try {
      setResult((await service.pull(n)).units)
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="screen-body">
      <h2>뽑기</h2>
      <div className="row">
        <button className="primary" disabled={busy} onClick={() => doPull(1)}>
          1회 · {costText(service.pullCost(1))}
        </button>
        <button className="primary" disabled={busy} onClick={() => doPull(10)}>
          10회 · {costText(service.pullCost(10))}
        </button>
      </div>
      {!service.chargesResources && <p className="hint">개발 모드: 자원이 차감되지 않습니다</p>}
      <ErrorLine error={error} />
      <div className="list">
        {result.map((u) => (
          <UnitRow key={u.id} unit={u} onClick={() => onOpen(u.id)} badge="NEW" />
        ))}
      </div>
    </div>
  )
}

// ───────────── 보관함 ─────────────

type SortKey = 'new' | StatKey | 'sum'
const SORT_LABEL: Record<SortKey, string> = { new: '최신순', hp: '체력', atk: '공격력', armor: '방어력', sum: '능력치 합' }

export function InventoryScreen({ version, onOpen }: { version: number; onOpen: (id: string) => void }) {
  const units = useUnits(version)
  const [champ, setChamp] = useState('all')
  const [sort, setSort] = useState<SortKey>('new')
  const shown = useMemo(() => {
    const list = (units ?? []).filter((u) => champ === 'all' || u.champId === champ)
    const key = (u: UnitInstance) => (sort === 'new' ? u.createdAt : sort === 'sum' ? statSum(u) : u.stats[sort])
    return [...list].sort((a, b) => key(b) - key(a))
  }, [units, champ, sort])
  return (
    <div className="screen-body">
      <h2>보관함 ({units?.length ?? 0})</h2>
      <div className="row">
        <select value={champ} onChange={(e) => setChamp(e.target.value)}>
          <option value="all">전체 챔프</option>
          {Object.values(gachaCtx.catalog).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
          {Object.entries(SORT_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </div>
      {units && units.length === 0 && <p className="hint">보유 유닛이 없습니다. 뽑기에서 얻으세요.</p>}
      <div className="list">
        {shown.map((u) => (
          <UnitRow key={u.id} unit={u} onClick={() => onOpen(u.id)} />
        ))}
      </div>
    </div>
  )
}

// ───────────── 유닛 상세 · 리롤 ─────────────

export function UnitDetail({ id, onBack, onReroll }: { id: string; onBack: () => void; onReroll: () => void }) {
  const [unit, setUnit] = useState<UnitInstance | null | undefined>(undefined)
  useEffect(() => {
    void service.getUnit(id).then(setUnit)
  }, [id])
  if (unit === undefined) return null
  if (!unit) return <div className="screen-body">유닛을 찾을 수 없습니다. <button onClick={onBack}>뒤로</button></div>
  const c = gachaCtx.catalog[unit.champId]!
  return (
    <div className="screen-body">
      <button className="back" onClick={onBack}>
        ← 뒤로
      </button>
      <CardInfo champ={c} unit={unit} />
      <p className="hint">
        획득 {new Date(unit.createdAt).toLocaleString()} · 리롤 {unit.rerollCount}회 · 특수능력 슬롯 {c.specialSlots}
      </p>
      <button className="primary" onClick={onReroll}>
        능력치 리롤
      </button>
    </div>
  )
}

export function RerollScreen({ id, onBack, onChanged }: { id: string; onBack: () => void; onChanged: () => void }) {
  const [unit, setUnit] = useState<UnitInstance | null>(null)
  const [locks, setLocks] = useState<StatKey[]>([])
  const [last, setLast] = useState<{ before: UnitInstance; after: UnitInstance } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void service.getUnit(id).then(setUnit)
  }, [id])
  if (!unit) return null
  const c = gachaCtx.catalog[unit.champId]!
  const maxLocks = gachaCtx.config.maxStatLocks
  const toggle = (k: StatKey) =>
    setLocks((l) => (l.includes(k) ? l.filter((x) => x !== k) : l.length < maxLocks ? [...l, k] : l))
  const cost = service.rerollCost({ stats: locks })

  const doReroll = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await service.reroll(unit.id, { stats: locks })
      setLast({ before: r.before, after: r.after })
      setUnit(r.after)
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="screen-body">
      <button className="back" onClick={onBack}>
        ← 뒤로
      </button>
      <h2>{c.name} 리롤</h2>
      <p className="hint">
        일반 능력치와 특수능력을 다시 정합니다. 최대 {maxLocks}개 능력치를 잠가 유지할 수 있습니다. 이동거리·사거리·슬롯 수는
        변하지 않습니다.
      </p>
      <div className="lock-list">
        {STAT_KEYS.map((k) => {
          const r = c.statRanges[k]
          const on = locks.includes(k)
          return (
            <button key={k} className={`lock ${on ? 'on' : ''}`} onClick={() => toggle(k)} disabled={!on && locks.length >= maxLocks}>
              <span>{on ? '🔒' : '🔓'}</span>
              <span className="lock-name">{STAT_LABEL[k]}</span>
              <b>{unit.stats[k]}</b>
              <span className="hint">
                ({r.min}~{r.max})
              </span>
            </button>
          )
        })}
      </div>
      <div className="card-info">
        {unit.specials.map((s, i) => (
          <div key={i} className="ci-effect">
            ✦ {SPECIAL_LABEL[s.kind]}: {specialText(s)}
          </div>
        ))}
      </div>
      <button className="primary" disabled={busy} onClick={doReroll}>
        리롤 · {costText(cost)} {locks.length > 0 && `(잠금 ${locks.length}개 · ×${gachaCtx.table.lockMultiplier[locks.length]})`}
      </button>
      <ErrorLine error={error} />
      {last && <Compare before={last.before} after={last.after} />}
    </div>
  )
}

function Compare({ before, after }: { before: UnitInstance; after: UnitInstance }) {
  return (
    <div className="compare">
      <h3>변경 전 → 후</h3>
      <table>
        <tbody>
          {STAT_KEYS.map((k) => {
            const d = after.stats[k] - before.stats[k]
            return (
              <tr key={k}>
                <td>{STAT_LABEL[k]}</td>
                <td>{before.stats[k]}</td>
                <td>→</td>
                <td>
                  <b>{after.stats[k]}</b>
                </td>
                <td className={d > 0 ? 'up' : d < 0 ? 'down' : ''}>{d > 0 ? `▲${d}` : d < 0 ? `▼${-d}` : '–'}</td>
              </tr>
            )
          })}
          {after.specials.map((s, i) => (
            <tr key={`s${i}`}>
              <td>슬롯 {i + 1}</td>
              <td colSpan={2}>{before.specials[i] ? `${SPECIAL_LABEL[before.specials[i]!.kind]} ${specialText(before.specials[i]!)}` : '-'}</td>
              <td colSpan={2}>
                <b>
                  {SPECIAL_LABEL[s.kind]} {specialText(s)}
                </b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ───────────── 덱 ─────────────

export function DeckScreen({
  version,
  onStart,
  actionLabel = '대전 시작 (vs AI)',
}: {
  version: number
  onStart: (deck: UnitInstance[]) => void
  actionLabel?: string
}) {
  const units = useUnits(version)
  const [picked, setPicked] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const need = gachaCtx.config.cardsPerSide
  useEffect(() => {
    void service.getDeck().then(setPicked)
  }, [version])
  if (!units) return null
  const byId = new Map(units.map((u) => [u.id, u]))
  const pickedChamps = new Set(picked.map((id) => byId.get(id)?.champId))
  const toggle = (u: UnitInstance) =>
    setPicked((p) => (p.includes(u.id) ? p.filter((x) => x !== u.id) : p.length < need ? [...p, u.id] : p))
  const start = async () => {
    setError(null)
    try {
      await service.setDeck(picked)
      onStart(picked.map((id) => byId.get(id)!))
    } catch (e) {
      setError((e as Error).message)
    }
  }
  return (
    <div className="screen-body">
      <h2>
        덱 편성 ({picked.length}/{need})
      </h2>
      <p className="hint">서로 다른 챔프 {need}장을 고르세요. 보유 개체 능력치 그대로 대전에 나갑니다.</p>
      {units.length === 0 && <p className="hint">보유 유닛이 없습니다. 뽑기에서 얻거나 개발 메뉴에서 지급받으세요.</p>}
      <div className="list">
        {[...units]
          .sort((a, b) => a.champId.localeCompare(b.champId) || statSum(b) - statSum(a))
          .map((u) => {
            const on = picked.includes(u.id)
            const blocked = !on && (picked.length >= need || (!gachaCtx.config.allowDuplicateChamps && pickedChamps.has(u.champId)))
            return <UnitRow key={u.id} unit={u} selected={on} disabled={blocked} onClick={() => toggle(u)} badge={on ? `${picked.indexOf(u.id) + 1}` : undefined} />
          })}
      </div>
      <ErrorLine error={error} />
      <div className="footer sticky">
        <button className="primary" disabled={picked.length !== need} onClick={start}>
          {actionLabel}
        </button>
      </div>
    </div>
  )
}

// ───────────── 확률 정보 (확률표에서 자동 생성) ─────────────

const p2 = (p: number) => `${(p * 100).toFixed(2)}%`

export function RatesScreen() {
  const d = service.describeRates()
  return (
    <div className="screen-body rates">
      <h2>확률 정보</h2>
      <p className="hint">아래 내용은 게임이 실제로 사용하는 확률표에서 자동으로 만들어집니다.</p>
      <h3>등급</h3>
      <table>
        <tbody>
          {d.rarities.map((r) => (
            <tr key={r.id}>
              <td>
                {r.id} ({r.label})
              </td>
              <td>{p2(r.probability)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>챔프별</h3>
      <table>
        <tbody>
          {d.champs.map((c) => (
            <tr key={c.id}>
              <td>
                {c.name} <span className="tag">{c.rarity}</span>
              </td>
              <td>{p2(c.probability)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>일반 능력치 구간</h3>
      <table>
        <tbody>
          {d.statTiers.map((t) => (
            <tr key={t.label}>
              <td>
                {t.label} <span className="tag">{t.range}</span>
              </td>
              <td>{p2(t.probability)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>특수능력 (슬롯당)</h3>
      <table>
        <tbody>
          {d.specials.map((s) => (
            <tr key={s.kind}>
              <td>
                {SPECIAL_LABEL[s.kind]}{' '}
                <span className="tag">
                  {specialText({ kind: s.kind, value: s.min })} ~ {specialText({ kind: s.kind, value: s.max })}
                </span>
              </td>
              <td>{p2(s.probability)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>규칙</h3>
      <ul>
        {d.rules.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <h3>비용</h3>
      <ul>
        <li>뽑기 1회: {costText(d.costs.pull1)}</li>
        <li>뽑기 10회: {costText(d.costs.pull10)}</li>
        <li>
          리롤: {costText(d.costs.reroll)} × 잠금 배율 ({d.lockMultiplier.map((m, i) => `${i}개 ×${m}`).join(', ')})
        </li>
      </ul>
    </div>
  )
}

// ───────────── 개발 메뉴 ─────────────

export function DevScreen({ onChanged }: { onChanged: () => void }) {
  const [msg, setMsg] = useState<string | null>(null)
  const act = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn()
      setMsg(`${label} 완료`)
      onChanged()
    } catch (e) {
      setMsg((e as Error).message)
    }
  }
  return (
    <div className="screen-body">
      <h2>개발 메뉴</h2>
      <p className="hint">자원 차감: {service.chargesResources ? '켜짐' : '꺼짐 (DEV_UNLIMITED_RESOURCES)'}</p>
      <div className="row">
        <button onClick={() => act('보석 +1000', () => service.dev.addResources({ gem: 1000 }))}>보석 +1000</button>
        <button onClick={() => act('리롤석 +100', () => service.dev.addResources({ rerollStone: 100 }))}>리롤석 +100</button>
      </div>
      <button
        onClick={() => confirm('보관함을 비울까요?') && act('보관함 초기화', () => service.dev.resetInventory())}
      >
        보관함 초기화
      </button>
      <h3>챔프 지급</h3>
      <div className="grid2">
        {Object.values(gachaCtx.catalog).map((c) => (
          <button key={c.id} onClick={() => act(`${c.name} 지급`, () => service.dev.grantChamp(c.id))}>
            {c.name} <span className="tag">{c.rarity}</span>
          </button>
        ))}
      </div>
      {msg && <p className="hint">{msg}</p>}
    </div>
  )
}

export function WalletBar({ wallet }: { wallet: Wallet | null }) {
  if (!wallet) return null
  return (
    <div className="wallet">
      {Object.entries(wallet).map(([k, v]) => (
        <span key={k}>
          {CURRENCY_LABEL[k as keyof Wallet]} {v}
        </span>
      ))}
      {!service.chargesResources && <span className="tag">∞ DEV</span>}
    </div>
  )
}

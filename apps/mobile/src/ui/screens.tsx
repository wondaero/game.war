import { useEffect, useMemo, useState } from 'react'
import { ABILITY_KINDS, ABILITIES, STAT_KEYS, type StatKey, type UnitInstance } from '@war/v2'
import type { Wallet } from '@war/core'
import { service, V2_CFG } from '../services.ts'
import { CardInfo } from './CardInfo.tsx'
import { costText, CURRENCY_LABEL, IMAGE_INFO, imageOf, STAT_LABEL } from './format.ts'
import { UnitRow } from './UnitRow.tsx'

const statSum = (u: UnitInstance) => u.stats.atk + u.stats.armor * 3 + u.stats.hp / 2

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
  const lucky = result.filter((u) => u.ability).length
  return (
    <div className="screen-body">
      <h2>뽑기</h2>
      <p className="hint">
        캐릭터 1명을 뽑습니다. 그림·능력치가 정해지고, {Math.round(V2_CFG.abilityChanceBp / 100)}% 확률로 특수능력이 1개 붙습니다.
      </p>
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
      {result.length > 0 && <p className="hint">특수능력 {lucky}명 / {result.length}명</p>}
      <div className="list">
        {result.map((u) => (
          <UnitRow key={u.id} unit={u} onClick={() => onOpen(u.id)} badge="NEW" />
        ))}
      </div>
    </div>
  )
}

// ───────────── 보관함 ─────────────

type SortKey = 'new' | StatKey | 'ability'
const SORT_LABEL: Record<SortKey, string> = {
  new: '최신순',
  ability: '특수능력',
  atk: '공격력',
  armor: '방어력',
  hp: '체력',
  move: '이동',
  range: '사거리',
}

export function InventoryScreen({ version, onOpen }: { version: number; onOpen: (id: string) => void }) {
  const units = useUnits(version)
  const [image, setImage] = useState('all')
  const [sort, setSort] = useState<SortKey>('new')
  const shown = useMemo(() => {
    const list = (units ?? []).filter((u) => image === 'all' || u.image === image)
    const key = (u: UnitInstance) =>
      sort === 'new' ? (u.createdAt ?? 0) : sort === 'ability' ? (u.ability ? 1000 : 0) + statSum(u) : u.stats[sort]
    return [...list].sort((a, b) => key(b) - key(a))
  }, [units, image, sort])
  return (
    <div className="screen-body">
      <h2>보관함 ({units?.length ?? 0})</h2>
      <div className="row">
        <select value={image} onChange={(e) => setImage(e.target.value)}>
          <option value="all">전체 그림</option>
          {Object.entries(IMAGE_INFO).map(([k, v]) => (
            <option key={k} value={k}>
              {v.emoji} {v.name}
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
      {units && units.length === 0 && <p className="hint">보유 유닛이 없습니다. 상점 → 뽑기에서 얻으세요.</p>}
      <div className="list">
        {shown.map((u) => (
          <UnitRow key={u.id} unit={u} onClick={() => onOpen(u.id)} />
        ))}
      </div>
    </div>
  )
}

// ───────────── 유닛 상세 ─────────────

export function UnitDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [unit, setUnit] = useState<UnitInstance | null | undefined>(undefined)
  useEffect(() => {
    void service.getUnit(id).then(setUnit)
  }, [id])
  if (unit === undefined) return null
  if (!unit)
    return (
      <div className="screen-body">
        유닛을 찾을 수 없습니다. <button onClick={onBack}>뒤로</button>
      </div>
    )
  return (
    <div className="screen-body">
      <button className="back" onClick={onBack}>
        ← 뒤로
      </button>
      <CardInfo unit={unit} />
      <table className="stat-table">
        <tbody>
          {STAT_KEYS.map((k) => {
            const r = V2_CFG.statRanges[k]
            return (
              <tr key={k}>
                <td>{STAT_LABEL[k]}</td>
                <td>
                  <b>{unit.stats[k]}</b>
                </td>
                <td className="hint">
                  ({r.min}~{r.max})
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {unit.createdAt !== undefined && <p className="hint">획득 {new Date(unit.createdAt).toLocaleString()}</p>}
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
  const need = V2_CFG.cardsPerSide
  useEffect(() => {
    void service.getDeck().then(setPicked)
  }, [version])
  if (!units) return null
  const byId = new Map(units.map((u) => [u.id, u]))
  const pickedImages = new Set(picked.map((id) => byId.get(id)?.image))
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
      <p className="hint">{need}명을 고르세요. 같은 그림은 한 명만 넣을 수 있습니다.</p>
      {units.length === 0 && <p className="hint">보유 유닛이 없습니다. 상점에서 뽑거나 개발 메뉴에서 지급받으세요.</p>}
      <div className="list">
        {[...units]
          .sort((a, b) => a.image.localeCompare(b.image) || (b.ability ? 1 : 0) - (a.ability ? 1 : 0) || statSum(b) - statSum(a))
          .map((u) => {
            const on = picked.includes(u.id)
            const blocked = !on && (picked.length >= need || pickedImages.has(u.image))
            return (
              <UnitRow
                key={u.id}
                unit={u}
                selected={on}
                disabled={blocked}
                onClick={() => toggle(u)}
                badge={on ? `${picked.indexOf(u.id) + 1}` : undefined}
              />
            )
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

// ───────────── 확률 정보 (실제 뽑기 설정에서 자동 생성) ─────────────

const p2 = (p: number) => `${(p * 100).toFixed(2)}%`

export function RatesScreen() {
  const d = service.describeRates()
  return (
    <div className="screen-body rates">
      <h2>확률 정보</h2>
      <p className="hint">아래 내용은 게임이 실제로 쓰는 뽑기 설정에서 자동으로 만들어집니다.</p>
      <h3>그림 (성능 무관)</h3>
      <table>
        <tbody>
          {d.images.map((x) => (
            <tr key={x.image}>
              <td>
                {imageOf(x.image).emoji} {imageOf(x.image).name}
              </td>
              <td>{p2(x.probability)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>능력치 (범위 안 균등)</h3>
      <table>
        <tbody>
          {d.stats.map((s) => (
            <tr key={s.key}>
              <td>{STAT_LABEL[s.key as StatKey]}</td>
              <td>
                {s.min} ~ {s.max}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>특수능력 (붙을 확률 {p2(d.abilityChance)} · 없음 {p2(1 - d.abilityChance)})</h3>
      <table>
        <tbody>
          {d.abilities.map((a) => (
            <tr key={a.kind}>
              <td>
                <b>{a.name}</b>
                {a.tiers.map((t, i) => (
                  <div key={i} className="hint">
                    {a.tiers.length > 1 ? `${i + 1}등급: ` : ''}
                    {t.desc} ({p2(t.probability)})
                  </div>
                ))}
              </td>
              <td>{p2(a.probability)}</td>
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
        <li>뽑기 1회: {costText(d.costs[1])}</li>
        <li>뽑기 10회: {costText(d.costs[10])}</li>
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
      <p className="hint">자원 차감: {service.chargesResources ? '켜짐' : '꺼짐 (개발 모드)'}</p>
      <div className="row">
        <button onClick={() => act('보석 +1000', () => service.dev.addResources({ gem: 1000 }))}>보석 +1000</button>
        <button onClick={() => confirm('보관함을 비울까요?') && act('보관함 초기화', () => service.dev.resetInventory())}>
          보관함 초기화
        </button>
      </div>
      <h3>능력 지정 지급 (시험용)</h3>
      <div className="grid2">
        <button onClick={() => act('능력 없는 유닛 지급', () => service.dev.grantUnit(null))}>능력 없음</button>
        {ABILITY_KINDS.map((k) => (
          <button key={k} onClick={() => act(`${ABILITIES[k].name} 지급`, () => service.dev.grantUnit(k))}>
            {ABILITIES[k].name}
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
          {CURRENCY_LABEL[k as keyof Wallet] ?? k} {v}
        </span>
      ))}
      {!service.chargesResources && <span className="tag">∞ DEV</span>}
    </div>
  )
}

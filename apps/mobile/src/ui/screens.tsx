import { useEffect, useMemo, useState } from 'react'
import { ABILITY_KINDS, ABILITIES, MAX_REROLL_LOCKS, MERGE_COUNT, MERGE_REWARD, STAT_KEYS, type StatKey, type UnitInstance } from '@war/v2'
import type { Wallet } from '@war/core'
import { service, V2_CFG } from '../services.ts'
import { CardInfo } from './CardInfo.tsx'
import { costText, CURRENCY_LABEL, IMAGE_INFO, imageOf, STAT_LABEL } from './format.ts'
import { UnitRow } from './UnitRow.tsx'
import { loadPracticeSeconds, PRACTICE_SECONDS, savePracticeSeconds, secondsLabel } from '../lobby/store.ts'

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

export function InventoryScreen({
  version,
  onOpen,
  onChanged,
}: {
  version: number
  onOpen: (id: string) => void
  onChanged: () => void
}) {
  const units = useUnits(version)
  const [deck, setDeck] = useState<string[]>([])
  const [image, setImage] = useState('all')
  const [sort, setSort] = useState<SortKey>('new')
  const [merging, setMerging] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void service.getDeck().then(setDeck)
  }, [version])
  const shown = useMemo(() => {
    const list = (units ?? []).filter((u) => image === 'all' || u.image === image)
    const key = (u: UnitInstance) =>
      sort === 'new' ? (u.createdAt ?? 0) : sort === 'ability' ? (u.ability ? 1000 : 0) + statSum(u) : u.stats[sort]
    return [...list].sort((a, b) => key(b) - key(a))
  }, [units, image, sort])

  const toggle = (u: UnitInstance) =>
    setPicked((p) => (p.includes(u.id) ? p.filter((x) => x !== u.id) : p.length < MERGE_COUNT ? [...p, u.id] : p))
  const doMerge = async () => {
    const withAbility = (units ?? []).filter((u) => picked.includes(u.id) && u.ability)
    if (withAbility.length && !confirm(`특수능력이 있는 캐릭 ${withAbility.length}명이 포함돼 있습니다. 합칠까요?`)) return
    setBusy(true)
    setMsg(null)
    try {
      const r = await service.merge(picked)
      setMsg(`합성 완료: 리롤석 +${r.gained} (보유 ${r.wallet.rerollStone})`)
      setPicked([])
      onChanged()
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="screen-body">
      <div className="row between">
        <h2>보관함 ({units?.length ?? 0})</h2>
        <button className={merging ? 'on' : ''} onClick={() => (setMerging((m) => !m), setPicked([]), setMsg(null))}>
          {merging ? '합성 취소' : '합성하기'}
        </button>
      </div>
      {merging && (
        <p className="hint">
          캐릭 {MERGE_COUNT}명을 골라 합치면 리롤석 {MERGE_REWARD}개를 받습니다. 합친 캐릭은 사라집니다. 덱에 있는 캐릭은 고를 수 없습니다.
        </p>
      )}
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
        {shown.map((u) => {
          const inDeck = deck.includes(u.id)
          if (!merging) return <UnitRow key={u.id} unit={u} onClick={() => onOpen(u.id)} badge={inDeck ? '덱' : undefined} />
          const on = picked.includes(u.id)
          return (
            <UnitRow
              key={u.id}
              unit={u}
              selected={on}
              disabled={inDeck || (!on && picked.length >= MERGE_COUNT)}
              onClick={() => toggle(u)}
              badge={inDeck ? '덱' : on ? `${picked.indexOf(u.id) + 1}` : undefined}
            />
          )
        })}
      </div>
      {msg && <p className="hint">{msg}</p>}
      {merging && (
        <div className="footer sticky">
          <button className="primary" disabled={busy || picked.length !== MERGE_COUNT} onClick={() => void doMerge()}>
            합성 ({picked.length}/{MERGE_COUNT}) → 리롤석 {MERGE_REWARD}개
          </button>
        </div>
      )}
    </div>
  )
}

// ───────────── 유닛 상세 · 리롤 ─────────────

export function UnitDetail({ id, onBack, onChanged }: { id: string; onBack: () => void; onChanged: () => void }) {
  const [unit, setUnit] = useState<UnitInstance | null | undefined>(undefined)
  const [lock, setLock] = useState<StatKey | null>(null)
  const [last, setLast] = useState<{ before: UnitInstance; after: UnitInstance } | null>(null)
  const [stones, setStones] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    void service.getUnit(id).then(setUnit)
    void service.getWallet().then((w) => setStones(w.rerollStone ?? 0))
  }, [id])
  if (unit === undefined) return null
  if (!unit)
    return (
      <div className="screen-body">
        유닛을 찾을 수 없습니다. <button onClick={onBack}>뒤로</button>
      </div>
    )
  const cost = service.rerollCost()
  const need = cost.rerollStone ?? 0
  const doReroll = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await service.reroll(unit.id, lock)
      setLast({ before: r.before, after: r.after })
      setUnit(r.after)
      setStones(r.wallet.rerollStone ?? 0)
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
      <CardInfo unit={unit} />
      <h3>리롤</h3>
      <p className="hint">
        그림·특수능력은 그대로입니다. 능력치 {MAX_REROLL_LOCKS}개를 눌러 잠그면 유지되고, 나머지는 범위 안에서 다시 정해집니다.
      </p>
      <div className="lock-list">
        {STAT_KEYS.map((k) => {
          const r = V2_CFG.statRanges[k]
          const on = lock === k
          const d = last ? last.after.stats[k] - last.before.stats[k] : 0
          return (
            <button key={k} className={`lock ${on ? 'on' : ''}`} onClick={() => setLock(on ? null : k)}>
              <span>{on ? '🔒' : '🔓'}</span>
              <span className="lock-name">{STAT_LABEL[k]}</span>
              <b>{unit.stats[k]}</b>
              <span className="hint">
                ({r.min}~{r.max})
              </span>
              {last && <span className={d > 0 ? 'up' : d < 0 ? 'down' : 'hint'}>{d > 0 ? `▲${d}` : d < 0 ? `▼${-d}` : '–'}</span>}
            </button>
          )
        })}
      </div>
      <button className="primary" disabled={busy || (stones !== null && stones < need)} onClick={() => void doReroll()}>
        리롤 · {costText(cost)} (보유 {stones ?? '…'}){lock ? ` · ${STAT_LABEL[lock]} 유지` : ''}
      </button>
      {stones !== null && stones < need && (
        <p className="hint">리롤석이 부족합니다. 보관함 → 합성하기에서 캐릭 {MERGE_COUNT}명을 합쳐 얻으세요.</p>
      )}
      <ErrorLine error={error} />
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
        <li>
          합성: 캐릭 {d.reroll.mergeCount}명 → 리롤석 {d.reroll.mergeReward}개
        </li>
        <li>
          리롤: {costText(d.reroll.cost)} (능력치 {d.reroll.maxLocks}개 잠금 가능)
        </li>
      </ul>
    </div>
  )
}

// ───────────── 개발 메뉴 ─────────────

export function DevScreen({ onChanged }: { onChanged: () => void }) {
  const [msg, setMsg] = useState<string | null>(null)
  const [practice, setPractice] = useState(loadPracticeSeconds)
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
        <button onClick={() => act('리롤석 +10', () => service.dev.addResources({ rerollStone: 10 }))}>리롤석 +10</button>
        <button onClick={() => confirm('보관함을 비울까요?') && act('보관함 초기화', () => service.dev.resetInventory())}>
          보관함 초기화
        </button>
      </div>
      <h3>AI 연습 제한시간</h3>
      <div className="row">
        {PRACTICE_SECONDS.map((s) => (
          <button key={s} className={practice === s ? 'on' : ''} onClick={() => (savePracticeSeconds(s), setPractice(s))}>
            {secondsLabel(s)}
          </button>
        ))}
      </div>
      <p className="hint">방 목록의 "AI와 연습하기"에 적용됩니다. 무제한은 AI 연습·오프라인 방에서만 쓸 수 있습니다.</p>
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

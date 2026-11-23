// 서버 함수(Deno)에서 쓰도록 엔진·저장 로직을 supabase/functions/_shared 로 복사한다.
// 원본: packages/engine/src, packages/core/src  (직접 수정하지 말 것 — 배포 전 이 스크립트로 다시 복사)
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, 'supabase/functions/_shared')

function copyDir(src, dst, rewrite) {
  fs.rmSync(dst, { recursive: true, force: true })
  fs.mkdirSync(dst, { recursive: true })
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name)
    const d = path.join(dst, e.name)
    if (e.isDirectory()) copyDir(s, d, rewrite)
    else if (e.name.endsWith('.ts')) fs.writeFileSync(d, '// 자동 생성 (scripts/sync-functions.mjs) — 직접 수정 금지\n' + rewrite(fs.readFileSync(s, 'utf8'), d))
  }
}

copyDir(path.join(root, 'packages/engine/src'), path.join(out, 'engine'), (t) => t)
// core 는 '@war/engine' 을 상대 경로로 바꿔서 import map 없이 동작하게
copyDir(path.join(root, 'packages/core/src'), path.join(out, 'core'), (t, file) => {
  const rel = path.relative(path.dirname(file), path.join(out, 'engine/index.ts')).split(path.sep).join('/')
  return t.replaceAll("from '@war/engine'", `from '${rel.startsWith('.') ? rel : './' + rel}'`)
})
console.log('synced → supabase/functions/_shared/{engine,core}')

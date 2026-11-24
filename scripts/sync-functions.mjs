// 서버 함수(Deno)에서 쓰도록 규칙·저장 로직을 supabase/functions/_shared 로 복사한다.
// 원본: packages/engine/src (난수만 씀), packages/v2/src (새 규칙), packages/core/src (저장·뽑기 서비스)
// 직접 수정하지 말 것 — 배포 전 이 스크립트로 다시 복사
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, 'supabase/functions/_shared')

/** import map 없이 동작하도록 '@war/xxx' 를 상대 경로로 */
function rewriter(map) {
  return (text, file) => {
    let t = text
    for (const [pkg, dir] of Object.entries(map)) {
      const rel = path.relative(path.dirname(file), path.join(out, dir, 'index.ts')).split(path.sep).join('/')
      t = t.replaceAll(`from '${pkg}'`, `from '${rel.startsWith('.') ? rel : './' + rel}'`)
    }
    return t
  }
}

function copyDir(src, dst, rewrite) {
  fs.rmSync(dst, { recursive: true, force: true })
  fs.mkdirSync(dst, { recursive: true })
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name)
    const d = path.join(dst, e.name)
    if (e.isDirectory()) copyDir(s, d, rewrite)
    else if (e.name.endsWith('.ts'))
      fs.writeFileSync(d, '// 자동 생성 (scripts/sync-functions.mjs) — 직접 수정 금지\n' + rewrite(fs.readFileSync(s, 'utf8'), d))
  }
}

copyDir(path.join(root, 'packages/engine/src'), path.join(out, 'engine'), (t) => t)
copyDir(path.join(root, 'packages/v2/src'), path.join(out, 'v2'), rewriter({ '@war/engine': 'engine' }))
copyDir(path.join(root, 'packages/core/src'), path.join(out, 'core'), rewriter({ '@war/v2': 'v2', '@war/engine': 'engine' }))
console.log('synced → supabase/functions/_shared/{engine,v2,core}')

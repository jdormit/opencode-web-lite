import { brotliCompressSync } from 'node:zlib'
import { resolve } from 'node:path'

type ManifestEntry = { file: string; src?: string; isEntry?: boolean; isDynamicEntry?: boolean; imports?: string[]; dynamicImports?: string[]; css?: string[]; assets?: string[] }
type ReportEntry = { file: string; bytes: number; brotliBytes: number; kind: string; initial: boolean }

const root = resolve(import.meta.dir, '..')
const client = resolve(root, 'dist/client')
const manifestFile = Bun.file(resolve(client, '.vite/manifest.json'))
if (!(await manifestFile.exists())) throw new Error('Build manifest missing. Run `bun run build` first.')
const manifest = await manifestFile.json() as Record<string, ManifestEntry>
const initial = new Set<string>()
const visit = (key: string, files = initial) => {
  const entry = manifest[key]
  if (!entry || files.has(entry.file)) return
  files.add(entry.file)
  entry.css?.forEach((file) => files.add(file))
  entry.assets?.forEach((file) => files.add(file))
  entry.imports?.forEach((dependency) => visit(dependency, files))
}
Object.entries(manifest).filter(([, entry]) => entry.isEntry).forEach(([key]) => visit(key))

const entries: ReportEntry[] = []
for await (const relative of new Bun.Glob('**/*').scan({ cwd: client, onlyFiles: true })) {
  if (relative.endsWith('.map') || relative === '.vite/manifest.json') continue
  const kind = kindOf(relative)
  if (!kind) continue
  const bytes = new Uint8Array(await Bun.file(resolve(client, relative)).arrayBuffer())
  entries.push({ file: relative, bytes: bytes.byteLength, brotliBytes: brotliCompressSync(bytes).byteLength, kind, initial: initial.has(relative) })
}

const sum = (kind: string, files: ReadonlySet<string>) => entries.filter((entry) => files.has(entry.file) && entry.kind === kind).reduce((total, entry) => total + entry.brotliBytes, 0)
const budgets = { javascript: 120 * 1024, css: 35 * 1024, font: 150 * 1024, lazy: 100 * 1024 }
const routes = Object.entries(manifest).filter(([key, entry]) => key.includes('src/routes/') && entry.isDynamicEntry).map(([key, entry]) => {
  const files = new Set(initial)
  visit(key, files)
  return { route: entry.src ?? key, javascript: sum('javascript', files), css: sum('css', files), font: sum('font', files), files: [...files] }
})
const totals = {
  javascript: Math.max(...routes.map((route) => route.javascript), sum('javascript', initial)),
  css: Math.max(...routes.map((route) => route.css), sum('css', initial)),
  font: Math.max(...routes.map((route) => route.font), sum('font', initial)),
}
const violations = [
  ...Object.entries(totals).flatMap(([kind, bytes]) => bytes > budgets[kind as keyof typeof budgets] ? [`Initial ${kind}: ${bytes} > ${budgets[kind as keyof typeof budgets]}`] : []),
  ...entries.filter((entry) => !entry.initial && entry.kind === 'javascript' && entry.brotliBytes > budgets.lazy)
    .map((entry) => `Lazy chunk ${entry.file}: ${entry.brotliBytes} > ${budgets.lazy}`),
]
const report = { compression: 'brotli', budgets, totals, routes, entries: entries.sort((left, right) => right.brotliBytes - left.brotliBytes), violations }
await Bun.write(resolve(root, 'bundle-report.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
if (violations.length) process.exit(1)

function kindOf(path: string) {
  if (/\.(m?js)$/.test(path)) return 'javascript'
  if (path.endsWith('.css')) return 'css'
  if (/\.(woff2?|ttf|otf)$/.test(path)) return 'font'
  return undefined
}

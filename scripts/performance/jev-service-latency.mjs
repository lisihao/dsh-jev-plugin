/** Keyless public-service benchmark of an exact built package on a local disk.
 * npm run build; node scripts/performance/jev-service-latency.mjs [package-root]
 * Peer services come from this checkout's pinned published development baseline.
 * Runtime bytes are copied unchanged to a scratch profile; no user data is read.
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { cp, mkdtemp, readFile, rm, symlink, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'
import { createHash } from 'node:crypto'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'

const checkout = fileURLToPath(new URL('../..', import.meta.url))
const packageRoot = resolve(process.argv[2] ?? checkout)
const root = await mkdtemp(join(tmpdir(), 'jev-service-latency-'))
const fixture = { answers: [{ type: 'predicate', name: 'q', probability: 0.8 }], usage: { input_tokens: 1, output_tokens: 1 } }
const responseText = JSON.stringify(fixture)
let requests = 0
const server = createServer(async (request, response) => {
  let text = ''
  for await (const chunk of request) text += chunk
  const body = JSON.parse(text)
  assert.equal(body.model, 'gpt-6-luna')
  requests++
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(responseText)
})
let ctx, backend, facility, unregister
function stat(values) {
  const ordered = [...values].sort((a, b) => a - b)
  return { n: ordered.length, p50: ordered[Math.floor(ordered.length / 2)], p95: ordered[Math.ceil(ordered.length * .95) - 1], max: ordered.at(-1) }
}
const request = { state: { source: 'synthetic-latency-fixture', text: 'x'.repeat(7800) }, questions: [{ id: 'q', kind: 'noul', prompt: 'Ready?' }] }
try {
  const payload = join(root, 'payload')
  await cp(join(packageRoot, 'runtime'), join(payload, 'runtime'), { recursive: true })
  await cp(join(packageRoot, 'package.json'), join(payload, 'package.json'))
  await symlink(join(checkout, 'node_modules'), join(payload, 'node_modules'), 'dir')
  const { default: JevService } = await import(pathToFileURL(join(payload, 'runtime/index.js')))
  const runtimeHash = createHash('sha256').update(await readFile(join(payload, 'runtime/index.js'))).digest('hex')
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  const endpoint = `http://127.0.0.1:${server.address().port}/v1/decisions`
  ctx = new Context()
  await ctx.plugin(Storage)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  backend = new JsonStorageBackend(join(root, 'storage'))
  let writes = 0
  const backendTimes = []
  const wrapped = { kv: { async open(descriptor) {
    const unit = await backend.kv.open(descriptor)
    return new Proxy(unit, { get(target, key) {
      if (key === 'putRecord') return async (...args) => {
        const at = performance.now()
        try { return await target.putRecord(...args) }
        finally { writes++; backendTimes.push(performance.now() - at) }
      }
      const value = target[key]
      return typeof value === 'function' ? value.bind(target) : value
    } })
  } }, close: () => backend.close() }
  unregister = ctx.storage.backend.register('json', wrapped)
  facility = new DomainFacility(ctx, { backend: 'json' })
  ctx.provide('storageDomain', facility)
  ctx.provide('profileContext', { dir: join(root, 'profile') })
  ctx.provide('settings', { configure: () => () => {} })
  ctx.provide('credentials', { resolve: async () => ({ value: 'dummy-local-fixture', source: 'fixture' }) })
  await ctx.plugin(JevService, { judgmentModel: 'luna', lunaApi: 'openai', lunaOpenAIBaseUrl: endpoint, timeoutMs: 10000, features: { fixture: true } })
  ctx.jev.registerFeature({ id: 'fixture', name: 'Fixture', description: 'Keyless durability benchmark' })
  const ids = [], results = []
  for (const concurrency of [1, 4, 16]) {
    const elapsed = [], inputWait = [], network = []
    writes = 0
    backendTimes.length = 0
    const started = performance.now()
    for (let batch = 0; batch < 48 / concurrency; batch++) await Promise.all(Array.from({ length: concurrency }, async () => {
      const at = performance.now()
      const outcome = await ctx.jev.judgeOnce({ featureId: 'fixture', link: {}, refresh: () => request })
      elapsed.push(performance.now() - at)
      assert.equal(outcome.kind, 'ok')
      ids.push(outcome.operationId)
      const detail = await ctx.jev.getRecord(outcome.operationId)
      const packet = detail.attemptRecords[0].networkRecords[0]
      inputWait.push(Date.parse(packet.dispatchedAt) - Date.parse(detail.startedAt))
      network.push(Date.parse(packet.settledAt) - Date.parse(packet.dispatchedAt))
    }))
    results.push({ concurrency, operations: 48, elapsedMs: performance.now() - started, writes, operationMs: stat(elapsed), beforeDispatchMs: stat(inputWait), localHttpMs: stat(network), backendWriteMs: stat(backendTimes) })
  }
  await ctx.fiber.dispose()
  await facility.closeAll()
  unregister(); unregister = undefined
  await backend.close()
  // Reopen the actual published backend and inspect every durable result.
  const reopened = new JsonStorageBackend(join(root, 'storage'))
  try {
    const domains = await readdir(join(root, 'storage'))
    assert.equal(domains.length, 1)
    const unit = await reopened.kv.open({ name: domains[0], version: 1, layout: 'per-record', tables: ['operations'], hasGlobal: false })
    const records = (await unit.loadAll()).tables.operations
    assert.equal(Object.keys(records).length, ids.length)
    for (const id of ids) {
      const detail = records[id], attempt = detail.attemptRecords[0], packet = attempt.networkRecords[0]
      assert.equal(detail.status, 'succeeded')
      assert.deepEqual(attempt.request, request)
      assert.deepEqual(JSON.parse(packet.requestBody.input), request.state)
      assert.equal(packet.rawResponseText, responseText)
      assert.deepEqual(packet.rawResponse, fixture)
      assert.deepEqual(attempt.response.answers, [{ id: 'q', kind: 'noul', probability: 0.8 }])
      assert.equal(packet.status, 'succeeded')
      assert.equal(packet.httpStatus, 200)
    }
    await unit.close()
  } finally { await reopened.close() }
  assert.equal(requests, ids.length)
  console.log(JSON.stringify({ formatVersion: 1, synthetic: true, realModelCalls: 0, node: process.version, runtimeEntrySha256: runtimeHash, reloadedRecordsVerified: ids.length, localRequests: requests, results }, null, 2))
} finally {
  await ctx?.fiber.dispose()
  await facility?.closeAll()
  unregister?.()
  await backend?.close()
  server.closeAllConnections()
  await new Promise(done => server.close(done))
  await rm(root, { recursive: true, force: true })
}

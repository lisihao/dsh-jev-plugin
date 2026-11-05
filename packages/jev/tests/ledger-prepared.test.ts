import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import JevService from '../src/index.ts'
import { JevLedger } from '../src/ledger.ts'
import { protocolBody } from '../src/wire.ts'
import type { JevConfigValues, JevConnectionId, JevNetworkRecord, JevRequest } from '../src/types.ts'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  const failures: unknown[] = []
  for (const cleanup of cleanups.splice(0).reverse()) {
    try { await cleanup() } catch (error) { failures.push(error) }
  }
  vi.restoreAllMocks()
  if (failures.length) throw new AggregateError(failures, 'Jev prepared-packet fixture cleanup failed')
})

async function scratch() {
  const path = await mkdtemp(join(tmpdir(), 'jev-ledger-prepared-test-'))
  cleanups.push(() => rm(path, { recursive: true, force: true }))
  return path
}

async function openLedger(root: string, profile: string) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  const backend = new JsonStorageBackend(join(root, 'storage'))
  const unregister = ctx.storage.backend.register('json', backend)
  const facility = new DomainFacility(ctx, { backend: 'json' })
  const ledger = await JevLedger.open(facility, profile)
  let closed = false
  const close = async () => {
    if (closed) return
    closed = true
    await ledger.close()
    await facility.closeAll()
    unregister()
    await backend.close()
    await ctx.fiber.dispose()
  }
  cleanups.push(close)
  return { ledger, close }
}

async function setupService(root: string, options: { baseUrl: string; config?: Partial<JevConfigValues> }) {
  const ctx = new Context()
  await ctx.plugin(Storage)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  const backend = new JsonStorageBackend(join(root, 'storage'))
  const unregister = ctx.storage.backend.register('json', backend)
  const facility = new DomainFacility(ctx, { backend: 'json' })
  ctx.provide('storageDomain', facility)
  ctx.provide('profileContext', { dir: join(root, 'profile') } as never)
  ctx.provide('settings', { configure: () => () => {} } as never)
  ctx.provide('credentials', {
    resolve: async () => ({ value: 'prepared-packet-fixture-key', source: 'fixture' }),
    describe: async () => ({ configured: true, writable: true, source: 'fixture' }),
    set: async () => {},
  } as never)
  await ctx.plugin(JevService, {
    baseUrl: options.baseUrl,
    model: 'jev-prepared-fixture',
    credentialRef: 'JEV_PREPARED_TEST_KEY',
    timeoutMs: 10_000,
    features: { fixture: true },
    ...options.config,
  })
  let disposed = false
  const dispose = async () => {
    if (disposed) return
    disposed = true
    await ctx.fiber.dispose()
    unregister()
    await facility.closeAll()
    await backend.close()
  }
  cleanups.push(dispose)
  return { ctx, dispose }
}

function manyQuestions(count: number): JevRequest {
  return {
    state: { fixture: 'prepared-packets', count },
    questions: Array.from({ length: count }, (_, index) => ({
      id: `q-${index}`,
      kind: 'noul' as const,
      prompt: `Question ${index}`,
    })),
  }
}

const oneQuestion: JevRequest = {
  state: { fixture: 'prepared-packet' },
  questions: [{ id: 'ready', kind: 'noul', prompt: 'Ready?' }],
}

async function latestAttempt(ctx: Context) {
  const page = await ctx.jev.listRecords({})
  const id = page.items[0]?.id
  if (id === undefined) throw new Error('Prepared-packet fixture has no operation')
  const detail = await ctx.jev.getRecord(id)
  if (detail === null) throw new Error('Prepared-packet fixture operation disappeared')
  const attempt = detail.attemptRecords.at(-1)
  if (attempt === undefined) throw new Error('Prepared-packet fixture has no attempt')
  return { detail, attempt }
}

describe('Jev prepared network packets', () => {
  it.each([
    { connectionId: 'jev', expectedCount: 201 },
    { connectionId: 'luna-openrouter', expectedCount: 200 },
    { connectionId: 'luna-openai', expectedCount: 201 },
  ] as const)('reopens the exact first protocol packet for $connectionId', async ({ connectionId, expectedCount }) => {
    const root = await scratch()
    const profile = join(root, 'profile')
    const first = await openLedger(root, profile)
    const operation = await first.ledger.create('prepared-packet-fixture', {})
    const connection = {
      baseUrl: 'https://prepared-packet.invalid/decisions',
      model: 'prepared-packet-model',
      credentialRef: 'JEV_PREPARED_TEST_KEY',
      connectionId,
    }
    const request = manyQuestions(201)
    const attempt = await first.ledger.startAttempt(operation.id, request, connection)
    const packet = attempt.networkRecords?.[0]
    if (packet === undefined) throw new Error('startAttempt did not return its prepared packet')
    const part = { ...request, questions: request.questions.slice(0, expectedCount) }
    expect(packet.questionIds).toEqual(part.questions.map(question => question.id))
    expect(packet.requestBody).toEqual(protocolBody(connectionId, connection.model, part))
    expect(packet.status).toBe('pending')

    await first.close()
    const reopened = await openLedger(root, profile)
    const stored = reopened.ledger.get(operation.id)
    expect(stored?.attemptRecords[0]?.request).toEqual(request)
    expect(stored?.attemptRecords[0]?.networkRecords?.[0]).toEqual(packet)
  })

  it('acknowledges the prepared packet before dispatch and saves the first response', async () => {
    const root = await scratch()
    const url = 'https://prepared-packet.invalid/jev'
    const runtime = await setupService(root, { baseUrl: url })
    const callbackHistory: JevNetworkRecord[][] = []
    const originalSaveNetwork = JevLedger.prototype.saveNetwork
    vi.spyOn(JevLedger.prototype, 'saveNetwork').mockImplementation(async function (operationId, attemptId, records) {
      callbackHistory.push(structuredClone(records))
      await originalSaveNetwork.call(this, operationId, attemptId, records)
    })
    const dispatchChecks: Array<{ callbackCount: number; status: string; dispatchedAt?: string }> = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const current = await latestAttempt(runtime.ctx)
      const packet = current.attempt.networkRecords?.[0]
      if (packet === undefined) throw new Error('Prepared packet was not present before dispatch')
      dispatchChecks.push({ callbackCount: callbackHistory.length, status: packet.status, dispatchedAt: packet.dispatchedAt })
      expect(callbackHistory).toEqual([])
      expect(packet.status).toBe('pending')
      expect(packet.dispatchedAt).toBeUndefined()
      const body = JSON.parse(String(init?.body)) as { model: string; questions: Record<string, unknown> }
      expect(body.model).toBe('jev-prepared-fixture')
      expect(Object.keys(body.questions)).toEqual(['ready'])
      return new Response(JSON.stringify({ answers: { ready: { type: 'noul', noul: 0.8 } }, usage: { input_tokens: 7, output_tokens: 2 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    runtime.ctx.jev.registerFeature({ id: 'fixture', name: 'Fixture', description: 'Prepared-packet fixture' })

    const result = await runtime.ctx.jev.judgeOnce({ featureId: 'fixture', link: {}, refresh: () => oneQuestion })
    expect(result.kind).toBe('ok')
    expect(dispatchChecks).toEqual([{ callbackCount: 0, status: 'pending' }])
    expect(callbackHistory).toHaveLength(1)
    expect(callbackHistory[0]).toMatchObject([{ questionIds: ['ready'], status: 'succeeded', httpStatus: 200 }])
    if (result.kind !== 'ok') throw new Error('Prepared-packet fixture did not succeed')
    const detail = await runtime.ctx.jev.getRecord(result.operationId)
    expect(detail?.attemptRecords[0]?.networkRecords).toHaveLength(1)
    expect(detail?.attemptRecords[0]?.networkRecords?.[0]).toMatchObject({ status: 'succeeded', rawResponse: { answers: { ready: { type: 'noul', noul: 0.8 } } } })
  })

  it('keeps a 201-question OpenRouter run to response1, input2, response2 packet callbacks', async () => {
    const root = await scratch()
    const url = 'https://prepared-packet.invalid/openrouter'
    const runtime = await setupService(root, {
      baseUrl: '',
      config: { judgmentModel: 'luna', lunaApi: 'openrouter', lunaOpenRouterBaseUrl: url },
    })
    const callbackHistory: JevNetworkRecord[][] = []
    const originalSaveNetwork = JevLedger.prototype.saveNetwork
    vi.spyOn(JevLedger.prototype, 'saveNetwork').mockImplementation(async function (operationId, attemptId, records) {
      callbackHistory.push(structuredClone(records))
      await originalSaveNetwork.call(this, operationId, attemptId, records)
    })
    const dispatches: Record<string, unknown>[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { state: unknown; questions: Record<string, unknown> }
      dispatches.push(body)
      const current = await latestAttempt(runtime.ctx)
      const packets = current.attempt.networkRecords ?? []
      if (dispatches.length === 1) {
        expect(callbackHistory).toHaveLength(0)
        expect(packets).toHaveLength(1)
        expect(packets[0]).toMatchObject({ status: 'pending', questionIds: manyQuestions(201).questions.slice(0, 200).map(question => question.id) })
      } else {
        expect(callbackHistory).toHaveLength(2)
        expect(callbackHistory[0]?.map(record => record.status)).toEqual(['succeeded'])
        expect(callbackHistory[1]?.map(record => record.status)).toEqual(['succeeded', 'pending'])
        expect(packets.map(packet => packet.status)).toEqual(['succeeded', 'pending'])
        expect(packets.map(packet => packet.questionIds.length)).toEqual([200, 1])
      }
      const answers = Object.fromEntries(Object.keys(body.questions).map(id => [id, { type: 'noul', noul: 0.8 }]))
      return new Response(JSON.stringify({ answers, usage: { input_tokens: 7, output_tokens: 2 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    runtime.ctx.jev.registerFeature({ id: 'fixture', name: 'Fixture', description: 'Prepared-packet fixture' })
    const request = manyQuestions(201)
    const result = await runtime.ctx.jev.judgeOnce({ featureId: 'fixture', link: {}, refresh: () => request })

    expect(result.kind).toBe('ok')
    expect(dispatches).toHaveLength(2)
    expect(Object.keys(dispatches[0]!.questions)).toEqual(request.questions.slice(0, 200).map(question => question.id))
    expect(Object.keys(dispatches[1]!.questions)).toEqual(['q-200'])
    expect(callbackHistory).toHaveLength(3)
    expect(callbackHistory.map(records => records.map(record => ({ status: record.status, questions: record.questionIds.length })))).toEqual([
      [{ status: 'succeeded', questions: 200 }],
      [{ status: 'succeeded', questions: 200 }, { status: 'pending', questions: 1 }],
      [{ status: 'succeeded', questions: 200 }, { status: 'succeeded', questions: 1 }],
    ])
    if (result.kind !== 'ok') throw new Error('OpenRouter prepared-packet fixture did not succeed')
    const detail = await runtime.ctx.jev.getRecord(result.operationId)
    expect(detail?.attemptRecords[0]?.networkRecords).toHaveLength(2)
    expect(detail?.attemptRecords[0]?.networkRecords?.map(record => record.questionIds.length)).toEqual([200, 1])
  })

  it('snapshots mutable saveNetwork inputs before a queued durable write', async () => {
    const root = await scratch()
    const profile = join(root, 'profile')
    const opened = await openLedger(root, profile)
    const operation = await opened.ledger.create('prepared-packet-fixture', {})
    const attempt = await opened.ledger.startAttempt(operation.id, oneQuestion, {
      baseUrl: 'https://prepared-packet.invalid/jev', model: 'prepared-packet-model', credentialRef: 'JEV_PREPARED_TEST_KEY', connectionId: 'jev',
    })
    const originalRecords = structuredClone(attempt.networkRecords ?? [])
    const records = structuredClone(originalRecords)
    const domain = (opened.ledger as unknown as { domain: { table(name: string): { update: Function } } }).domain
    const table = domain.table('operations')
    const originalUpdate = table.update.bind(table)
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const update = vi.spyOn(table, 'update').mockImplementation(async (id: string, fn: (current: unknown) => unknown) => {
      await held
      return originalUpdate(id, fn)
    })
    try {
      const pending = opened.ledger.saveNetwork(operation.id, attempt.id, records)
      records[0]!.status = 'succeeded'
      records[0]!.questionIds = ['mutated-question']
      ;(records[0]!.requestBody as { model: string }).model = 'mutated-model'
      records.push({ ...records[0]!, id: 'mutated-second-packet' })
      release()
      await pending
    } finally {
      update.mockRestore()
    }
    expect(opened.ledger.get(operation.id)?.attemptRecords[0]?.networkRecords).toEqual(originalRecords)
    await opened.close()
    const reopened = await openLedger(root, profile)
    expect(reopened.ledger.get(operation.id)?.attemptRecords[0]?.networkRecords).toEqual(originalRecords)
  })
})

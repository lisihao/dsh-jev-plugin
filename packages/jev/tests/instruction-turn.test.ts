import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createToolResultMessage, createUserMessage, MessageId, ToolCallId, type UserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { Session, SessionId, type Session as SessionType } from '@deepseek-ai/dsh-session'
import { currentTurnUserMessages } from '../src/instruction-turn.ts'

const contexts: Context[] = []
let sequence = 0

afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
})

async function createSession(): Promise<SessionType> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  contexts.push(ctx)
  return ctx.sessions.create(SessionId('instruction-turn-' + ++sequence))
}

function user(id: string, text: string): UserMessage {
  return { ...createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text }] }), id: MessageId(id) }
}

function hostMessage(id: string, text: string): UserMessage {
  return { ...createUserMessage({ source: { kind: 'system-prompt' }, content: [{ type: 'text', text }] }), id: MessageId(id) }
}

function appendUser(session: SessionType, message: UserMessage): void {
  session.append('user/message', message, { surfaceOp: 'append' })
}

function endTurn(session: SessionType, turn: number): void {
  session.append('turn/start', { turn })
  session.append('turn/end', { turn, reason: { kind: 'completed' } })
}

describe('currentTurnUserMessages', () => {
  it('excludes ended turns, keeps all current additions, filters host and tool messages, and deduplicates pending input', async () => {
    const session = await createSession()
    appendUser(session, user('old-1', 'old round one'))
    endTurn(session, 1)
    appendUser(session, user('old-2', 'old round two'))
    endTurn(session, 2)

    session.append('turn/start', { turn: 3 })
    const initial = user('current-1', 'current request')
    const supplement = user('current-2', 'current supplement')
    appendUser(session, initial)
    appendUser(session, hostMessage('host-1', 'workspace context'))
    session.append('tool/result', { turn: 3, step: 1, message: createToolResultMessage({
      callId: ToolCallId('tool-1'), content: [{ type: 'text', text: 'tool output' }], isError: false,
    }) }, { surfaceOp: 'append' })
    appendUser(session, supplement)

    const pending = [
      { ...supplement, content: [{ type: 'text', text: 'duplicate pending body' }] },
      user('current-3', 'pending supplement'),
      hostMessage('host-2', 'pending host context'),
    ] as const
    const result = currentTurnUserMessages(session, pending)

    expect(result.map(message => message.id)).toEqual([MessageId('current-1'), MessageId('current-2'), MessageId('current-3')])
    expect(result.map(message => message.content)).toEqual([
      [{ type: 'text', text: 'current request' }],
      [{ type: 'text', text: 'current supplement' }],
      [{ type: 'text', text: 'pending supplement' }],
    ])
    expect(result.every(message => message.source.kind === 'user')).toBe(true)
    expect(result.some(message => message.id === MessageId('old-1') || message.id === MessageId('old-2'))).toBe(false)
    expect(result.some(message => message.id === MessageId('host-1') || message.id === MessageId('host-2'))).toBe(false)
  })

  it('uses real logged events after reload and keeps a message appended before turn/start when no turn ended', async () => {
    const session = await createSession()
    const beforeStart = user('before-start', 'appended before turn start')
    appendUser(session, beforeStart)
    session.append('turn/start', { turn: 1 })
    const inTurn = user('in-turn', 'visible current body')
    appendUser(session, inTurn)
    const events = session.snapshotEvents()
    const reloaded = Session.create(SessionId('instruction-turn-reloaded-' + ++sequence), events)

    const result = currentTurnUserMessages(reloaded, [])

    expect(result.map(message => message.id)).toEqual([MessageId('before-start'), MessageId('in-turn')])
    expect(result.map(message => message.content)).toEqual([
      [{ type: 'text', text: 'appended before turn start' }],
      [{ type: 'text', text: 'visible current body' }],
    ])
  })
})

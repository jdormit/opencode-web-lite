import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { startMockOpenCode } from './mock-opencode'

let fixture: ReturnType<typeof startMockOpenCode>

beforeAll(() => { fixture = startMockOpenCode({ port: 0 }) })
afterAll(() => void fixture.server.stop(true))

describe('stateful OpenCode fixture', () => {
  test('serves deterministic bootstrap, bounded performance data, files and diffs', async () => {
    expect(await fetch(`${fixture.url}/global/health`).then((value) => value.json())).toEqual({ healthy: true, version: '1.18.4-fixture' })
    expect(await fetch(`${fixture.url}/session/ses_equal/message?limit=400`).then((value) => value.json())).toHaveLength(320)
    expect(await fetch(`${fixture.url}/file`).then((value) => value.json())).toHaveLength(100)
    expect(await fetch(`${fixture.url}/session/ses_equal/diff`).then((value) => value.json())).toHaveLength(20)
    const identities = await fetch(`${fixture.url}/__fixture/equal-identities`).then((value) => value.json()) as Record<string, { id: string; title: string }>
    expect(identities.server_alpha?.id).toBe('ses_equal')
    expect(identities.server_beta?.id).toBe('ses_equal')
    expect(identities.server_alpha?.title).not.toBe(identities.server_beta?.title)
  })

  test('mutates sessions, prompts, requests, provider auth and one-use tickets', async () => {
    await fetch(`${fixture.url}/session`, { method: 'POST', body: JSON.stringify({ title: 'Created' }) })
    await fetch(`${fixture.url}/session/ses_equal/prompt_async`, { method: 'POST', body: JSON.stringify({ messageID: 'msg_00000000000000000000000999', parts: [{ type: 'text', text: 'steer' }] }) })
    await fetch(`${fixture.url}/permission/per_fixture/reply`, { method: 'POST', body: '{}' })
    await fetch(`${fixture.url}/question/que_fixture/reply`, { method: 'POST', body: '{}' })
    await fetch(`${fixture.url}/auth/fixture`, { method: 'PUT', body: JSON.stringify({ type: 'api', key: 'test-secret' }) })
    expect(fixture.state.sessions.size).toBe(2)
    expect(fixture.state.prompts).toHaveLength(1)
    expect(fixture.state.permissions).toHaveLength(0)
    expect(fixture.state.questions).toHaveLength(0)
    expect(fixture.state.providerSecrets).toEqual(['test-secret'])
  })

  test('supports repeatable SSE reconnects with 160 deltas', async () => {
    await fetch(`${fixture.url}/__fixture/reset-requests`, { method: 'POST' })
    const first = await fetch(`${fixture.url}/global/event`).then((value) => value.text())
    const messages = await fetch(`${fixture.url}/session/ses_equal/message?limit=500`).then((value) => value.json()) as Array<{ info: { id: string }; parts: Array<{ text?: string }> }>
    const second = await fetch(`${fixture.url}/global/event`).then((value) => value.text())
    expect(first.match(/data:/g)).toHaveLength(164)
    expect(first.match(/message\.part\.delta/g)).toHaveLength(160)
    expect(first).toContain(`"directory":"/workspace/lite","payload"`)
    expect(messages).toHaveLength(320)
    expect(messages.at(-1)?.parts[0]?.text).toHaveLength('stream:'.length + 160)
    expect(second.match(/message\.part\.delta/g)).toHaveLength(160)
    expect(fixture.state.reconnects).toBe(2)
  })
})

type MockOptions = Readonly<{ hostname?: string; port?: number }>

const now = Date.UTC(2026, 6, 25, 12)
const directory = '/workspace/lite'
const equalSessionID = 'ses_equal'
const streamMessageID = 'msg_99999999999999999999999999'
const streamPartID = 'part_99999999999999999999999999'

export type MockState = ReturnType<typeof createMockState>

export function createMockState() {
  const sessions = new Map<string, Record<string, unknown>>()
  sessions.set(equalSessionID, session(equalSessionID, 'Stateful fixture session'))
  const messages = new Map<string, Array<{ info: Record<string, unknown>; parts: Record<string, unknown>[] }>>()
  messages.set(equalSessionID, performanceMessages())
  return {
    equalIdentities: {
      server_alpha: session(equalSessionID, 'Alpha server session'),
      server_beta: session(equalSessionID, 'Beta server session'),
    },
    sessions,
    messages,
    permissions: [{
      id: 'per_fixture', sessionID: equalSessionID, permission: 'edit',
      patterns: ['src/**'], always: ['src/**'], metadata: {},
    }],
    questions: [{
      id: 'que_fixture', sessionID: equalSessionID,
      questions: [
        { header: 'Runtime', question: 'Choose a runtime', multiple: false, custom: false, options: [
          { label: 'Bun', description: 'Use Bun' }, { label: 'Node', description: 'Use Node' },
        ] },
        { header: 'Checks', question: 'Choose checks', multiple: true, custom: true, options: [
          { label: 'Types', description: 'Run TypeScript' }, { label: 'Browser', description: 'Run Playwright' },
        ] },
      ],
    }],
    events: 0,
    reconnects: 0,
    prompts: [] as unknown[],
    providerSecrets: [] as string[],
    terminalTickets: new Set<string>(),
    terminals: new Map<string, Record<string, unknown>>(),
    eventsPaused: false,
    performanceGate: false,
  }
}

export function startMockOpenCode(options: MockOptions = {}) {
  const state = createMockState()
  const server = Bun.serve<{ kind: 'terminal' }>({
    hostname: options.hostname ?? '127.0.0.1',
    port: options.port ?? 4097,
    fetch: (request, bunServer) => handleMockRequest(request, state, bunServer),
    websocket: {
      open(socket) { socket.send('fixture-ready') },
      message(socket, value) { socket.send(`fixture:${String(value)}`) },
    },
  })
  return { server, state, url: `http://${server.hostname}:${server.port}` }
}

export async function handleMockRequest(
  request: Request,
  state: MockState,
  server?: Bun.Server<{ kind: 'terminal' }>,
): Promise<Response | undefined> {
  const url = new URL(request.url)
  const path = url.pathname
  const body = request.method === 'GET' || request.method === 'HEAD'
    ? {} : await request.json().catch(() => ({})) as Record<string, unknown>
  if (path === '/global/health') return json({ healthy: true, version: '1.18.4-fixture' })
  if (path === '/__fixture/reset-requests' && request.method === 'POST') {
    state.permissions = [{ id: 'per_fixture', sessionID: equalSessionID, permission: 'edit', patterns: ['src/**'], always: ['src/**'], metadata: {} }]
    state.questions = [{
      id: 'que_fixture', sessionID: equalSessionID,
      questions: [
        { header: 'Runtime', question: 'Choose a runtime', multiple: false, custom: false, options: [{ label: 'Bun', description: 'Use Bun' }, { label: 'Node', description: 'Use Node' }] },
        { header: 'Checks', question: 'Choose checks', multiple: true, custom: true, options: [{ label: 'Types', description: 'Run TypeScript' }, { label: 'Browser', description: 'Run Playwright' }] },
      ],
    }]
    state.prompts = []
    state.providerSecrets = []
    state.messages.set(equalSessionID, performanceMessages())
    for (const id of [...state.sessions.keys()]) {
      if (id.startsWith('ses_created_')) { state.sessions.delete(id); state.messages.delete(id) }
    }
    state.terminals.clear()
    return json(true)
  }
  if (path === '/__fixture/prepare-events' && request.method === 'POST') {
    state.eventsPaused = true
    state.performanceGate = true
    state.messages.set(equalSessionID, performanceMessages())
    return json(true)
  }
  if (path === '/__fixture/pause-events' && request.method === 'POST') { state.eventsPaused = true; return json(true) }
  if (path === '/__fixture/release-events' && request.method === 'POST') { state.eventsPaused = false; return json(true) }
  if (path === '/project') return json([{ id: 'project_fixture', worktree: directory, sandboxes: [], name: 'Web Lite' }])
  if (path === '/path') return json({ home: '/workspace', directory })
  if (path === '/agent') return json([
    { name: 'build', description: 'Build software', mode: 'primary', builtIn: true, native: true, hidden: false, permission: {} },
    { name: 'plan', description: 'Plan changes', mode: 'primary', builtIn: true, native: true, hidden: false, permission: {} },
  ])
  if (path === '/provider') return json({
    connected: ['fixture'], default: { fixture: 'model' },
    all: [{ id: 'fixture', name: 'Fixture AI', source: 'custom', env: [], options: {}, models: {
      model: { id: 'model', providerID: 'fixture', name: 'Fixture Model', status: 'active', variants: { fast: {} }, capabilities: { input: { text: true, audio: false, image: true, video: false, pdf: true }, output: { text: true, audio: false, image: false, video: false, pdf: false }, reasoning: true, attachment: true, temperature: true, toolcall: true }, cost: {}, limit: { context: 100000, output: 10000 }, options: {}, headers: {} },
    } }, { id: 'spare', name: 'Spare Provider', source: 'custom', env: [], options: {}, models: {} }],
  })
  if (path === '/provider/auth') return json({})
  if (path === '/config') return json({ share: 'manual', model: 'fixture/model' })
  if (path === '/session' && request.method === 'GET') return json([...state.sessions.values()])
  if (path === '/session' && request.method === 'POST') {
    const id = `ses_created_${state.sessions.size}`
    const created = session(id, String(body.title || 'New fixture session'))
    state.sessions.set(id, created)
    state.messages.set(id, [])
    return json(created)
  }
  if (path === '/session/status') return json(Object.fromEntries([...state.sessions.keys()].map((id) => [id, { type: state.performanceGate && id === equalSessionID ? 'busy' : 'idle' }])))
  const sessionMatch = path.match(/^\/session\/([^/]+)$/)
  if (sessionMatch && request.method === 'GET') {
    const found = state.sessions.get(decodeURIComponent(sessionMatch[1]!))
    return found ? json(found) : json({ name: 'NotFoundError' }, 404)
  }
  const messagesMatch = path.match(/^\/session\/([^/]+)\/message$/)
  if (messagesMatch && request.method === 'GET') {
    const all = state.messages.get(decodeURIComponent(messagesMatch[1]!)) ?? []
    const limit = Math.max(1, Number(url.searchParams.get('limit')) || 20)
    const before = url.searchParams.get('before')
    const end = before ? Math.min(all.length, Number(before)) : all.length
    const start = Math.max(0, end - limit)
    return json(all.slice(start, end), 200, start ? { 'X-Next-Cursor': String(start) } : undefined)
  }
  const oneMessage = path.match(/^\/session\/([^/]+)\/message\/([^/]+)$/)
  if (oneMessage) {
    const found = (state.messages.get(decodeURIComponent(oneMessage[1]!)) ?? [])
      .find((message) => message.info.id === decodeURIComponent(oneMessage[2]!))
    return found ? json(found) : json({ name: 'NotFoundError' }, 404)
  }
  if (/^\/session\/[^/]+\/children$/.test(path)) return json([])
  if (/^\/session\/[^/]+\/todo$/.test(path)) return json([
    { content: 'Protect release quality', status: 'in_progress', priority: 'high' },
  ])
  if (/^\/session\/[^/]+\/diff$/.test(path)) return json(diffFiles())
  if (/^\/session\/[^/]+\/prompt_async$/.test(path) && request.method === 'POST') {
    state.prompts.push(body)
    const id = String(body.messageID)
    const sessionID = path.split('/')[2]!
    state.messages.get(sessionID)?.push({
      info: { id, sessionID, role: 'user', time: { created: now + state.prompts.length } },
      parts: Array.isArray(body.parts) ? body.parts as Record<string, unknown>[] : [],
    })
    return json(true)
  }
  if (/^\/session\/[^/]+\/abort$/.test(path)) return json(true)
  if (path === '/permission') return json(state.permissions)
  if (/^\/permission\/[^/]+\/reply$/.test(path)) {
    state.permissions = state.permissions.filter((item) => item.id !== path.split('/')[2])
    return json(true)
  }
  if (path === '/question') return json(state.questions)
  if (/^\/question\/[^/]+\/(reply|reject)$/.test(path)) {
    state.questions = state.questions.filter((item) => item.id !== path.split('/')[2])
    return json(true)
  }
  if (path === '/file') return url.searchParams.get('path') === '.'
    ? json([{ name: 'lite', path: 'lite', absolute: directory, type: 'directory', ignored: false }])
    : json(fileNodes())
  if (path === '/file/content') return json({ type: 'text', content: 'export const fixture = true\n' })
  if (path === '/find/file') return json(fileNodes().filter((item) => item.type === 'file').map((item) => item.path))
  if (path === '/global/event') return eventStream(state)
  if (path === '/pty' && request.method === 'GET') return json([...state.terminals.values()])
  if (path === '/pty' && request.method === 'POST') {
    const id = `pty_fixture_${state.terminals.size + 1}`
    const terminal = { id, title: String(body.title || 'Terminal'), command: String(body.command || 'bash'), args: Array.isArray(body.args) ? body.args : [], cwd: String(body.cwd || directory), status: 'running', pid: 1000 + state.terminals.size }
    state.terminals.set(id, terminal)
    return json(terminal)
  }
  const ptyMatch = path.match(/^\/pty\/([^/]+)$/)
  if (ptyMatch && request.method === 'PUT') return state.terminals.has(ptyMatch[1]!) ? json(true) : json({ error: 'missing' }, 404)
  if (ptyMatch && request.method === 'DELETE') { state.terminals.delete(ptyMatch[1]!); return json(true) }
  if (path.match(/^\/auth\/[^/]+$/) && request.method === 'PUT') {
    const auth = body.auth ?? body
    if (auth && typeof auth === 'object' && 'key' in auth && typeof auth.key === 'string') state.providerSecrets.push(auth.key)
    return json(true)
  }
  if (/^\/provider\/[^/]+\/auth$/.test(path)) return json({ status: 'connected' })
  if (/^\/provider\/[^/]+\/oauth\/authorize$/.test(path)) return json({ url: 'https://auth.example/fixture', method: 'code', instructions: 'Enter the fixture code' })
  if (/^\/provider\/[^/]+\/oauth\/callback$/.test(path)) return json({ status: 'connected' })
  if (path.endsWith('/connect-token') && request.method === 'POST') {
    const ticket = `ticket-${state.terminalTickets.size + 1}`
    state.terminalTickets.add(ticket)
    return json({ ticket, expires_in: 30 })
  }
  if (path.match(/^\/pty\/[^/]+\/connect$/) && server) {
    const ticket = url.searchParams.get('ticket') ?? ''
    if (!state.terminalTickets.delete(ticket)) return json({ error: 'expired' }, 403)
    return server.upgrade(request, { data: { kind: 'terminal' } }) ? undefined : json({ error: 'upgrade' }, 400)
  }
  if (path === '/__fixture/state') return json({
    sessions: state.sessions.size, prompts: state.prompts.length,
    permissions: state.permissions.length, questions: state.questions.length,
    events: state.events, reconnects: state.reconnects,
    providerSecrets: state.providerSecrets.length, terminals: state.terminals.size,
  })
  if (path === '/__fixture/equal-identities') return json(state.equalIdentities)
  return json({ name: 'NotFoundError', path }, 404)
}

function session(id: string, title: string) {
  return { id, slug: id, projectID: 'project_fixture', directory, title, version: '1.18.4', time: { created: now, updated: now } }
}

function performanceMessages() {
  return Array.from({ length: 320 }, (_, index) => {
    const role = index % 2 ? 'assistant' : 'user'
    const id = index === 319 ? streamMessageID : `msg_${String(index).padStart(26, '0')}`
    return {
      info: { id, sessionID: equalSessionID, role, time: { created: now + index }, ...(role === 'user' && index === 318 ? { summary: { diffs: diffFiles() } } : {}) },
      parts: index === 317
        ? [{ id: 'part_tool', sessionID: equalSessionID, messageID: id, type: 'tool', tool: 'read', callID: 'call_fixture', state: { status: 'completed', input: { filePath: 'src/index.ts' }, output: 'fixture output', title: 'Read source', metadata: {}, time: { start: now, end: now + 1 } } }]
        : index === 319
          ? [{ id: streamPartID, sessionID: equalSessionID, messageID: id, type: 'text', text: 'stream:' }]
        : [{ id: `part_${index}`, sessionID: equalSessionID, messageID: id, type: 'text', text: `Fixture turn ${index + 1}` }],
    }
  })
}

function diffFiles() {
  return Array.from({ length: 20 }, (_, index) => ({ file: `src/file-${index}.ts`, status: 'modified', additions: 2, deletions: 1, patch: '@@ -1 +1 @@\n-old\n+new' }))
}

function fileNodes() {
  return Array.from({ length: 100 }, (_, index) => ({ name: `file-${index}.ts`, path: `src/file-${index}.ts`, type: 'file', ignored: false }))
}

function eventStream(state: MockState) {
  state.reconnects += 1
  const encoder = new TextEncoder()
  let index = 0
  const streamedMessage = {
    info: { id: streamMessageID, sessionID: equalSessionID, role: 'assistant', time: { created: now + 321 } },
    parts: [{ id: streamPartID, sessionID: equalSessionID, messageID: streamMessageID, type: 'text', text: `stream:${'x'.repeat(160)}` }],
  }
  const deltas = Array.from({ length: 160 }, () => ({ type: 'message.part.delta', properties: { sessionID: equalSessionID, messageID: streamMessageID, partID: streamPartID, field: 'text', delta: 'x' } }))
  const events = state.performanceGate ? [
    ...deltas,
    { type: 'session.status', properties: { sessionID: equalSessionID, status: { type: 'idle' } } },
  ] : [
    { type: 'session.status', properties: { sessionID: equalSessionID, status: { type: 'busy' } } },
    { type: 'message.updated', properties: { sessionID: equalSessionID, info: { id: streamMessageID, sessionID: equalSessionID, role: 'assistant', time: { created: now + 321 } } } },
    { type: 'message.part.updated', properties: { sessionID: equalSessionID, part: { id: streamPartID, sessionID: equalSessionID, messageID: streamMessageID, type: 'text', text: 'stream:' } } },
    ...deltas,
    { type: 'session.status', properties: { sessionID: equalSessionID, status: { type: 'idle' } } },
  ]
  const reconnect = state.reconnects
  return new Response(new ReadableStream({
    async pull(controller) {
      while (state.eventsPaused) await Bun.sleep(10)
      if (index >= events.length) { controller.close(); return }
      const finalDelta = state.performanceGate ? index === events.length - 2 : index === events.length - 1
      if (finalDelta) {
        const messages = state.messages.get(equalSessionID)
        if (messages) {
          const existing = messages.findIndex((message) => message.info.id === streamMessageID)
          if (existing >= 0) messages[existing] = streamedMessage
          else messages.push(streamedMessage)
        }
      }
      state.events += 1
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({
        directory,
        payload: { id: `evt_${reconnect}_${index}`, ...events[index] },
      })}\n\n`))
      index += 1
      if (state.performanceGate && finalDelta) state.eventsPaused = true
    },
  }), { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' } })
}

function json(value: unknown, status = 200, headers?: Record<string, string>) {
  return Response.json(value, { status, ...(headers ? { headers } : {}) })
}

if (import.meta.main) startMockOpenCode()

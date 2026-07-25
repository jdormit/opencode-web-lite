import type { Project, Session } from '@opencode-ai/sdk/v2/client'

import {
  createSdkForConnection,
  getDefaultConnection,
  type ServerConnection,
} from './connections.server'

type CreateClient = {
  project: {
    list(parameters?: undefined, options?: { signal?: AbortSignal }): Promise<{ data: Project[] | undefined }>
  }
  session: {
    create(parameters: {
      directory: string
      title?: string
    }, options?: { signal?: AbortSignal }): Promise<{ data: Session | undefined }>
  }
}

export async function createSession(
  input: { directory: string; title: string },
  connection: ServerConnection = getDefaultConnection(),
  client: CreateClient = createSdkForConnection(connection),
) {
  const directory = input.directory.trim()
  const title = input.title.trim()
  if (!directory || directory.length > 4_096) throw new Error('Choose a valid project')
  if (title.length > 200) throw new Error('Session titles must be 200 characters or fewer')

  const projectSignal = AbortSignal.timeout(5_000)
  const projectResult = await client.project.list(undefined, { signal: projectSignal })
  const project = projectResult.data?.find((candidate) => candidate.worktree === directory)
  if (!project) throw new Error('The selected project is no longer available')

  const result = await client.session.create(
    {
      directory: project.worktree,
      ...(title ? { title } : {}),
    },
  )
  if (!result.data) throw new Error('The session could not be created')

  return { serverKey: connection.key, sessionID: result.data.id }
}

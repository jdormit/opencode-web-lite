import type { Project, Session } from '@opencode-ai/sdk/v2/client'
import type { ComposerOptions } from '~/lib/composer-options'

import {
  createSdkForConnection,
  resolveConnection,
  type ServerConnection,
} from './connections.server'
import { loadComposerOptions } from './composer-options.server'
import { claimWorktree } from './projects.server'

type CreateClient = {
  project: {
    list(parameters?: undefined, options?: { signal?: AbortSignal }): Promise<{ data: Project[] | undefined }>
  }
  session: {
    create(parameters: {
      directory: string
      title?: string
      agent: string
      model: { id: string; providerID: string; variant?: string }
    }, options?: { signal?: AbortSignal }): Promise<{ data: Session | undefined }>
  }
}

export async function createSession(
  input: {
    serverKey: string
    directory: string
    title: string
    agent: string
    providerID: string
    modelID: string
    variant: string
  },
  connection: ServerConnection = resolveConnection(input.serverKey),
  client: CreateClient = createSdkForConnection(connection),
  composerOptions?: ComposerOptions,
) {
  if (input.serverKey !== connection.key) throw new Error('Unknown server')
  const directory = input.directory.trim()
  const title = input.title.trim()
  if (!directory || directory.length > 4_096) throw new Error('Choose a valid project')
  if (title.length > 200) throw new Error('Session titles must be 200 characters or fewer')

  const projectSignal = AbortSignal.timeout(5_000)
  const projectResult = await client.project.list(undefined, { signal: projectSignal })
  const project = projectResult.data?.find((candidate) =>
    candidate.worktree === directory || candidate.sandboxes.includes(directory))
  if (!project) throw new Error('The selected project is no longer available')
  const options = composerOptions ?? (await loadComposerOptions(input.serverKey, directory, connection))
  if (!options.agents.some((agent) => agent.name === input.agent))
    throw new Error('The selected agent is no longer available')
  const model = options.models.find(
    (candidate) =>
      candidate.providerID === input.providerID && candidate.modelID === input.modelID,
  )
  if (!model) throw new Error('The selected model is no longer available')
  if (input.variant && !model.variants.includes(input.variant))
    throw new Error('The selected model variant is no longer available')

  const result = await client.session.create(
    {
      directory,
      ...(title ? { title } : {}),
      agent: input.agent,
      model: {
        id: input.modelID,
        providerID: input.providerID,
        ...(input.variant ? { variant: input.variant } : {}),
      },
    },
  )
  if (!result.data) throw new Error('The session could not be created')

  claimWorktree(input.serverKey, project.worktree, directory)

  return { serverKey: connection.key, sessionID: result.data.id }
}

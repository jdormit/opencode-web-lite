import type { Agent, Command, Project, Provider, Session } from '@opencode-ai/sdk/v2/client'

import type { ComposerOptions } from '~/lib/composer-options'
import {
  createSdkForConnection,
  resolveConnection,
  type ServerConnection,
} from './connections.server'

type OptionsClient = {
  project: { list(parameters?: undefined, options?: { signal?: AbortSignal }): Promise<{ data: Project[] | undefined }> }
  app: { agents(parameters?: undefined, options?: { signal?: AbortSignal }): Promise<{ data: Agent[] | undefined }> }
  provider: {
    list(parameters?: undefined, options?: { signal?: AbortSignal }): Promise<{
      data:
        | { all: Provider[]; connected: string[]; default: Record<string, string> }
        | undefined
    }>
  }
  command?: { list(parameters?: undefined, options?: { signal?: AbortSignal }): Promise<{ data: Command[] | undefined }> }
  session?: { get(parameters: { sessionID: string }, options?: { signal?: AbortSignal }): Promise<{ data: Session | undefined }> }
}

export async function loadComposerOptions(
  serverKey: string,
  directory: string,
  connection: ServerConnection = resolveConnection(serverKey),
  rootClient = createSdkForConnection(connection),
  directoryClient: OptionsClient = createSdkForConnection(connection, { directory }),
  sessionID?: string,
): Promise<ComposerOptions> {
  if (serverKey !== connection.key) throw new Error('Unknown server')
  const signal = AbortSignal.timeout(1_500)
  const projects = await rootClient.project.list(undefined, { signal })
  if (!projects.data?.some((project) =>
    project.worktree === directory || project.sandboxes.includes(directory)))
    throw new Error('The selected project is no longer available')

  const [agentResult, providerResult, commandResult, sessionResult] = await Promise.all([
    directoryClient.app.agents(undefined, { signal }),
    directoryClient.provider.list(undefined, { signal }),
    directoryClient.command?.list(undefined, { signal }).catch(() => ({ data: [] as Command[] })) ?? Promise.resolve({ data: [] as Command[] }),
    sessionID && directoryClient.session
      ? directoryClient.session.get({ sessionID }, { signal }).catch(() => ({ data: undefined }))
      : Promise.resolve({ data: undefined }),
  ])
  if (!agentResult.data || !providerResult.data)
    throw new Error('Agent and model options could not be loaded')

  const agents = agentResult.data
    .filter((agent) => !agent.hidden && (agent.mode === 'primary' || agent.mode === 'all'))
    .slice(0, 64)
    .map((agent) => ({
      name: agent.name,
      ...(agent.description ? { description: agent.description } : {}),
    }))
  const mentionAgents = agentResult.data
    .filter((agent) => !agent.hidden && (agent.mode === 'subagent' || agent.mode === 'all'))
    .slice(0, 64)
    .map((agent) => ({ name: agent.name, ...(agent.description ? { description: agent.description } : {}) }))
  const connected = new Set(providerResult.data.connected)
  const models = providerResult.data.all.flatMap((provider) =>
    connected.has(provider.id)
      ? Object.values(provider.models)
          .filter((model) => model.status !== 'deprecated')
          .map((model) => ({
            providerID: provider.id,
            providerName: provider.name,
            modelID: model.id,
             name: model.name,
            variants: Object.entries(model.variants ?? {}).filter(([, value]) => !('disabled' in value) || !value.disabled).map(([name]) => name),
            capabilities: {
              image: model.capabilities?.input.image ?? false,
              pdf: model.capabilities?.input.pdf ?? false,
              reasoning: model.capabilities?.reasoning ?? false,
              attachment: model.capabilities?.attachment ?? false,
            },
            ...(model.limit?.context ? { contextLimit: model.limit.context } : {}),
            ...(model.limit?.output ? { outputLimit: model.limit.output } : {}),
            ...(model.status === 'alpha' || model.status === 'beta' || model.status === 'active' ? { status: model.status } : {}),
          }))
      : [],
  ).slice(0, 500)
  const defaultModel = providerResult.data.connected.flatMap((providerID) => {
    const modelID = providerResult.data?.default[providerID]
    return modelID && models.some((model) => model.providerID === providerID && model.modelID === modelID)
      ? [{ providerID, modelID }]
      : []
  })[0] ?? models[0]

  return {
    agents,
    models,
    mentionAgents,
    commands: (commandResult.data ?? []).slice(0, 256).map((command) => ({
      name: command.name,
      ...(command.description ? { description: command.description } : {}),
      source: command.source ?? 'command',
      hints: command.hints.slice(0, 20),
    })),
    directory,
    ...(agents[0] ? { defaultAgent: agents[0].name } : {}),
    ...(defaultModel ? { defaultModel } : {}),
    ...(sessionResult.data?.agent ? { currentAgent: sessionResult.data.agent } : {}),
    ...(sessionResult.data?.model ? {
      currentModel: {
        providerID: sessionResult.data.model.providerID,
        modelID: sessionResult.data.model.id,
        ...(sessionResult.data.model.variant ? { variant: sessionResult.data.model.variant } : {}),
      },
    } : {}),
  }
}

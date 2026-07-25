import type { Agent, Project, Provider } from '@opencode-ai/sdk/v2/client'

import type { ComposerOptions } from '~/lib/composer-options'
import {
  createSdkForConnection,
  getDefaultConnection,
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
}

export async function loadComposerOptions(
  directory: string,
  connection: ServerConnection = getDefaultConnection(),
  rootClient = createSdkForConnection(connection),
  directoryClient: OptionsClient = createSdkForConnection(connection, { directory }),
): Promise<ComposerOptions> {
  const signal = AbortSignal.timeout(1_500)
  const projects = await rootClient.project.list(undefined, { signal })
  if (!projects.data?.some((project) => project.worktree === directory))
    throw new Error('The selected project is no longer available')

  const [agentResult, providerResult] = await Promise.all([
    directoryClient.app.agents(undefined, { signal }),
    directoryClient.provider.list(undefined, { signal }),
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
            variants: Object.keys(model.variants ?? {}),
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
    ...(agents[0] ? { defaultAgent: agents[0].name } : {}),
    ...(defaultModel ? { defaultModel } : {}),
  }
}

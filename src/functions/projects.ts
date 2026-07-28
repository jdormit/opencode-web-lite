import { createServerFn } from '@tanstack/react-start'
import { browseDirectories, mutateWorktree, openProject, renameProject } from '~/server/projects.server'
import { assertSameOriginRequest } from '~/server/request-security.server'

const keyPattern = /^server_[A-Za-z0-9_-]{1,64}$/

export const getDirectories = createServerFn({ method: 'GET' }).validator((data: { serverKey: string; directory?: string }) => {
  if (!keyPattern.test(data.serverKey)) throw new Error('Invalid server identity')
  return data
}).handler(({ data }) => browseDirectories(data.serverKey, data.directory))

export const openProjectMutation = createServerFn({ method: 'POST' }).validator((data: { serverKey: string; directory: string }) => {
  if (!keyPattern.test(data.serverKey)) throw new Error('Invalid server identity')
  return data
}).handler(({ data }) => { assertSameOriginRequest(); return openProject(data.serverKey, data.directory) })

export const renameProjectMutation = createServerFn({ method: 'POST' }).validator((data: { serverKey: string; projectID: string; name: string; color?: string }) => {
  if (!keyPattern.test(data.serverKey) || !data.projectID || data.projectID.length > 128) throw new Error('Invalid project identity')
  return data
}).handler(({ data }) => { assertSameOriginRequest(); return renameProject(data.serverKey, data.projectID, data.name, data.color) })

export const worktreeMutation = createServerFn({ method: 'POST' }).validator((data: { serverKey: string; projectDirectory: string; action: 'list' | 'create' | 'reset' | 'remove'; value?: string }) => {
  if (!keyPattern.test(data.serverKey) || !['list', 'create', 'reset', 'remove'].includes(data.action)) throw new Error('Invalid worktree action')
  return data
}).handler(({ data }) => { assertSameOriginRequest(); return mutateWorktree(data.serverKey, data.projectDirectory, data.action, data.value) })

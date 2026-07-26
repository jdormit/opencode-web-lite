import * as v from 'valibot'

const identifierSchema = v.pipe(
  v.string(),
  v.minLength(1),
  v.maxLength(128),
  v.regex(/^[A-Za-z0-9_-]+$/),
)

const directorySchema = v.pipe(v.string(), v.minLength(1), v.maxLength(2_000))

export type RouteIdentity = {
  serverKey: string
  sessionId: string
}

export function parseRouteIdentity(value: unknown): RouteIdentity | undefined {
  const result = v.safeParse(
    v.object({ serverKey: identifierSchema, sessionId: identifierSchema }),
    value,
  )
  return result.success ? result.output : undefined
}

export function parseDirectory(value: unknown): string | undefined {
  const result = v.safeParse(directorySchema, value)
  return result.success ? result.output : undefined
}

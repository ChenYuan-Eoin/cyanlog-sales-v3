export type AsyncRouteParams<T extends Record<string, string> = { id: string }> = {
  params: Promise<T>
}

export async function resolveRouteParams<T extends Record<string, string>>(params: Promise<T> | T): Promise<T> {
  return Promise.resolve(params)
}

export async function resolveIdParam(params: Promise<{ id: string }> | { id: string }): Promise<string> {
  const resolved = await resolveRouteParams(params)
  return resolved.id
}

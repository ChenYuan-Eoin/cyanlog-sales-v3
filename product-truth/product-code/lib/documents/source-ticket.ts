export const SOURCE_DEPENDENCY_TIMEOUT_MS = 8_000

export class SourceDependencyUnavailableError extends Error {
  constructor(message: string = 'Contract source dependency unavailable') {
    super(message)
    this.name = 'SourceDependencyUnavailableError'
  }
}

/** A real deadline even when an upstream client ignores AbortSignal. */
export async function runSourceDependency<T>(
  operation: (signal: AbortSignal) => PromiseLike<T>,
  timeoutMs = SOURCE_DEPENDENCY_TIMEOUT_MS
) {
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | null = null
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      const error = new SourceDependencyUnavailableError('Contract source dependency timed out')
      controller.abort(error)
      reject(error)
    }, timeoutMs)
  })
  try {
    return await Promise.race([operation(controller.signal), timeoutPromise])
  } catch (error) {
    if (error instanceof SourceDependencyUnavailableError) throw error
    throw new SourceDependencyUnavailableError(error instanceof Error ? error.message : undefined)
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

import type { IpcResult } from '../../../shared/types'

/** Unwraps an IpcResult, throwing the error string so callers can try/catch. */
export async function unwrap<T>(p: Promise<IpcResult<T>>): Promise<T> {
  const result = await p
  if (!result.ok) {
    throw new Error(result.error ?? 'Unknown error')
  }
  return result.data as T
}

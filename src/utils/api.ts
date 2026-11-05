// Small helpers for talking to the local Garimpo server.
let cachedBase: string | null = null

export async function apiBase(): Promise<string> {
  if (cachedBase) return cachedBase
  const port = window.electronAPI ? await window.electronAPI.getServerPort() : 6595
  cachedBase = `http://127.0.0.1:${port}`
  return cachedBase
}

async function parse<T>(r: Response): Promise<T> {
  let data: any = null
  try { data = await r.json() } catch { /* empty body */ }
  if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`)
  return data as T
}

export async function apiGet<T = any>(path: string): Promise<T> {
  return parse<T>(await fetch((await apiBase()) + path))
}

export async function apiPost<T = any>(path: string, body: unknown): Promise<T> {
  return parse<T>(await fetch((await apiBase()) + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }))
}

const BASE = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || 'http://localhost:8000/v1'

export class ApiError extends Error {
  constructor(code, key, status) {
    super(code)
    this.code = code
    this.key = key
    this.status = status
  }
}

// ---- session (guests only log in to save a profile) ----
let access = null
let user = null
const subscribers = new Set()

export const session = {
  get user() {
    return user
  },
  subscribe(fn) {
    subscribers.add(fn)
    return () => subscribers.delete(fn)
  },
}

function setSession(a, u) {
  access = a
  user = u
  subscribers.forEach((fn) => fn(u))
}

let refreshing = null
export function refresh() {
  refreshing ||= fetch(BASE + '/auth/refresh', { method: 'POST', credentials: 'include' })
    .then(async (r) => {
      if (!r.ok) {
        setSession(null, null)
        return false
      }
      const d = await r.json()
      setSession(d.access, d.user)
      return true
    })
    .catch(() => false)
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

let sessionReady = null
/** Restore a previous login once per page load (no cost for guests who never logged in). */
export function ensureSession() {
  sessionReady ||= refresh().then(() => user)
  return sessionReady
}

export async function api(path, { method = 'GET', json, form, headers = {}, retry = true } = {}) {
  const head = { ...headers }
  if (json) head['Content-Type'] = 'application/json'
  if (access) head.Authorization = 'Bearer ' + access
  let res
  try {
    res = await fetch(BASE + path, {
      method,
      headers: head,
      body: json ? JSON.stringify(json) : form,
      credentials: 'include',
    })
  } catch {
    throw new ApiError('OFFLINE', 'err.offline', 0)
  }
  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    if (await refresh()) return api(path, { method, json, form, headers, retry: false })
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const e = data.error || {}
    throw new ApiError(e.code || 'GENERIC', e.message_key || 'err.generic', res.status)
  }
  return data
}

export async function sendOtp(phone, channel, lang) {
  return api('/auth/otp/send', { method: 'POST', json: { phone, channel, lang } })
}

export async function login(phone, code) {
  const d = await api('/auth/otp/verify', { method: 'POST', json: { phone, code } })
  setSession(d.access, d.user)
  sessionReady = Promise.resolve(d.user)
  return d
}

export async function logout() {
  await api('/auth/logout', { method: 'POST' }).catch(() => {})
  setSession(null, null)
  sessionReady = Promise.resolve(null)
}

/** POST a zip request, poll until ready, return the download URL. */
export async function runZip(path) {
  const { job_id } = await api(path, { method: 'POST' })
  for (let i = 0; i < 200; i++) {
    await new Promise((r) => setTimeout(r, 1500))
    const job = await api(`/public/jobs/${job_id}`)
    if (job.status === 'done') return job.url
    if (job.status === 'failed') throw new ApiError('ZIP_FAILED', 'err.generic', 500)
  }
  throw new ApiError('ZIP_TIMEOUT', 'err.generic', 504)
}

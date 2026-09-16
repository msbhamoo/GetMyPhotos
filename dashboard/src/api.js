const BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/v1'
export const GUEST_URL = import.meta.env.VITE_GUEST_URL || 'http://localhost:5173'

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

export class ApiError extends Error {
  constructor(code, status) {
    super(code)
    this.code = code
    this.status = status
  }
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

export async function api(path, { method = 'GET', json, blob = false, retry = true } = {}) {
  const headers = {}
  if (json) headers['Content-Type'] = 'application/json'
  if (access) headers.Authorization = 'Bearer ' + access
  let res
  try {
    res = await fetch(BASE + path, {
      method,
      headers,
      body: json ? JSON.stringify(json) : undefined,
      credentials: 'include',
    })
  } catch {
    throw new ApiError('OFFLINE', 0)
  }
  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    if (await refresh()) return api(path, { method, json, blob, retry: false })
  }
  if (!res.ok) {
    const d = await res.json().catch(() => ({}))
    throw new ApiError(d.error?.code || 'GENERIC', res.status)
  }
  return blob ? res.blob() : res.json()
}

export async function login(phone, code) {
  const d = await api('/auth/otp/verify', { method: 'POST', json: { phone, code } })
  setSession(d.access, d.user)
  return d
}

export async function logout() {
  await api('/auth/logout', { method: 'POST' }).catch(() => {})
  setSession(null, null)
}

const MESSAGES = {
  OFFLINE: navigator.onLine
    ? "Can't reach the GetMyPhotos server. Is the API running?"
    : 'No internet. Please check your connection.',
  RATE_LIMITED: 'Too many attempts — please wait a little and try again.',
  BAD_PHONE: 'Enter a valid 10-digit mobile number.',
  OTP_WRONG: 'Wrong OTP.',
  OTP_EXPIRED: 'OTP expired, please request a new one.',
  OTP_SEND_FAILED: "Couldn't send the OTP. Try SMS instead.",
  FREE_EVENT_LIMIT: 'The free plan allows one active event. Get an annual plan for unlimited events.',
  EVENT_CLOSED: 'This event is closed.',
  FORBIDDEN: 'Only the event owner can do this.',
  PAYMENT_CANCELLED: 'Payment cancelled. You can try again any time.',
  PAYMENT_SIGNATURE_INVALID: "Payment couldn't be confirmed. If you were charged, we'll fix it within 24 hours.",
  PAYMENTS_DISABLED: 'Payments are unavailable right now. Please try again later.',
  PAYMENT_PROVIDER_ERROR: "Couldn't reach the payment service. Please try again.",
  ALREADY_UPGRADED: 'This event is already upgraded.',
  EXTEND_NOT_ALLOWED: "This event's validity can't be extended.",
  SUBSCRIPTION_EVENT_LIMIT: 'You have used all the events in your annual plan.',
  NO_SUBSCRIPTION: 'No active annual plan.',
  UPLOADER_LIMIT: "This plan can't add more photographers. Please upgrade.",
  INVITE_NOT_FOUND: 'This invite link is not valid.',
  INVITE_EXPIRED: 'This invite link has expired. Ask for a new one.',
  INVITE_PHONE_MISMATCH: 'This invite is for a different number. Log in with that number.',
}
export const errorText = (e) => MESSAGES[e?.code] || 'Something went wrong. Please try again.'

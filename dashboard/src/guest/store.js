// Tab-scoped state that survives a reload (sessionStorage), with an in-memory fallback.
const mem = {}

export const store = {
  get(key) {
    if (key in mem) return mem[key]
    try {
      const v = sessionStorage.getItem('gmp_' + key)
      return v ? JSON.parse(v) : null
    } catch {
      return null
    }
  },
  set(key, value) {
    mem[key] = value
    try {
      sessionStorage.setItem('gmp_' + key, JSON.stringify(value))
    } catch {}
  },
}

export function deviceId() {
  try {
    let id = localStorage.getItem('gmp_dev')
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)
      localStorage.setItem('gmp_dev', id)
    }
    return id
  } catch {
    return ''
  }
}

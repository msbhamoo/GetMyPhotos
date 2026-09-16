/**
 * Offline-tolerant upload queue.
 *
 * Stage 1 (compress): picked File → 1600px web + 400px thumb + SHA-1, in a Web Worker.
 *   Results are saved to IndexedDB, so compressed photos survive reloads and network loss.
 *   Original files are NOT persisted (would duplicate GBs); only un-compressed picks are lost on close.
 * Stage 2 (upload): presign → PUT web + thumb directly to storage → complete.
 *   Retries forever with capped backoff; resumes on `online` and when the tab becomes visible.
 */
import { api, ApiError } from '../api.js'
import { compressImage, domCanvas } from './imaging.js'

const DB_NAME = 'gmp-uploads'
const STORE = 'ready'
const COMPRESS_CONCURRENCY = Math.min(2, navigator.hardwareConcurrency || 2)
const FATAL_STATUS = [400, 403, 404, 409, 413, 422]

let dbPromise
function db() {
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' }).createIndex('event', 'eventId')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

async function tx(mode, fn) {
  const d = await db()
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode)
    const req = fn(t.objectStore(STORE))
    t.oncomplete = () => resolve(req?.result)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
}

// ---- state ----
let eventId = null
let fresh = [] // picked, not yet compressed (memory only)
let ready = [] // compressed, waiting for upload (persisted)
let compressing = 0
let uploading = 0
let stats = { done: 0, duplicate: 0 }
let failed = []
let limitHit = false
const busy = new Set()
const listeners = new Set()

function uploadConcurrency() {
  const c = navigator.connection
  if (c?.saveData || /2g/.test(c?.effectiveType || '')) return 1
  if (c?.effectiveType === '3g') return 2
  return 3
}

function snapshot() {
  return {
    compressing: fresh.length + compressing,
    waiting: ready.filter((r) => !busy.has(r.id)).length,
    uploading,
    done: stats.done,
    duplicate: stats.duplicate,
    failed: [...failed],
    limitHit,
    online: navigator.onLine,
  }
}

function emit() {
  const s = snapshot()
  listeners.forEach((fn) => fn(s))
}

export function subscribe(fn) {
  listeners.add(fn)
  fn(snapshot())
  return () => listeners.delete(fn)
}

export function hasUnsaved() {
  return fresh.length + compressing > 0
}

export async function openEvent(id) {
  if (eventId !== id) {
    eventId = id
    fresh = []
    stats = { done: 0, duplicate: 0 }
    failed = []
    limitHit = false
  }
  try {
    const stored = (await tx('readonly', (s) => s.index('event').getAll(id))) || []
    const known = new Set(ready.map((r) => r.id))
    ready = [...ready.filter((r) => r.eventId === id), ...stored.filter((r) => !known.has(r.id))]
  } catch {
    // IndexedDB unavailable (private mode): queue works in memory only
  }
  emit()
  pump()
}

export function addFiles(id, fileList) {
  const accepted = [...fileList].filter(
    (f) => /^image\/(jpeg|png|webp)$/.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name)
  )
  for (const file of accepted) fresh.push({ id: crypto.randomUUID(), eventId: id, file, name: file.name })
  emit()
  pump()
  return accepted.length
}

// ---- compression ----
let worker = null
let seq = 0
const pendingJobs = new Map()

function compressInWorker(file) {
  if (!worker) {
    worker = new Worker(new URL('./compress.worker.js', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }) => {
      const job = pendingJobs.get(data.id)
      pendingJobs.delete(data.id)
      data.error ? job.reject(new Error(data.error)) : job.resolve(data)
    }
  }
  return new Promise((resolve, reject) => {
    const id = ++seq
    pendingJobs.set(id, { resolve, reject })
    worker.postMessage({ id, file })
  })
}

async function runCompress(item) {
  let result
  try {
    result = await compressInWorker(item.file)
  } catch (e) {
    try {
      if (e.message !== 'NO_OFFSCREEN') throw e
      result = await compressImage(item.file, domCanvas)
    } catch {
      failed.push({ name: item.name, reason: "couldn't open the photo" })
      return
    }
  }
  const { id: _jobId, ...data } = result
  const record = { id: item.id, eventId: item.eventId, name: item.name, attempts: 0, nextTry: 0, ...data }
  try {
    await tx('readwrite', (s) => s.put(record))
  } catch {
    // Storage full or unavailable — keep it in memory
  }
  if (record.eventId === eventId) ready.push(record)
}

// ---- upload ----
async function putBlob(url, blob, type) {
  const res = await fetch(url, { method: 'PUT', body: blob, headers: { 'Content-Type': type } })
  if (!res.ok) throw new Error('PUT ' + res.status)
}

async function finish(record) {
  ready = ready.filter((r) => r.id !== record.id)
  try {
    await tx('readwrite', (s) => s.delete(record.id))
  } catch {}
}

async function runUpload(record) {
  try {
    const { files } = await api(`/events/${record.eventId}/uploads/presign`, {
      method: 'POST',
      json: {
        files: [
          { client_hash: record.hash, mime: record.mime, size_web: record.web.size, size_thumb: record.thumb.size },
        ],
      },
    })
    const f = files[0]
    if (f.duplicate) {
      stats.duplicate++
      return finish(record)
    }
    if (f.error === 'PHOTO_LIMIT') {
      limitHit = true
      return
    }
    await putBlob(f.web_url, record.web, record.mime)
    await putBlob(f.thumb_url, record.thumb, record.mime)
    await api(`/events/${record.eventId}/uploads/complete`, {
      method: 'POST',
      json: { photos: [{ photo_id: f.photo_id, width: record.width, height: record.height }] },
    })
    stats.done++
    await finish(record)
  } catch (e) {
    if (e instanceof ApiError && FATAL_STATUS.includes(e.status)) {
      failed.push({ name: record.name, reason: e.code })
      if (e.code === 'EVENT_CLOSED') limitHit = true
      return finish(record)
    }
    record.attempts++
    record.nextTry = Date.now() + Math.min(60000, 2000 * 2 ** Math.min(record.attempts, 5))
  }
}

// ---- scheduler ----
let retryTimer = null

function pump() {
  while (fresh.length && compressing < COMPRESS_CONCURRENCY) {
    const item = fresh.shift()
    compressing++
    runCompress(item).finally(() => {
      compressing--
      emit()
      pump()
    })
  }

  if (navigator.onLine && !limitHit) {
    const now = Date.now()
    for (const record of ready) {
      if (uploading >= uploadConcurrency()) break
      if (busy.has(record.id) || record.nextTry > now) continue
      busy.add(record.id)
      uploading++
      runUpload(record).finally(() => {
        busy.delete(record.id)
        uploading--
        emit()
        pump()
      })
    }
  }

  clearTimeout(retryTimer)
  const waits = ready.filter((r) => !busy.has(r.id) && r.nextTry > Date.now()).map((r) => r.nextTry)
  if (waits.length) retryTimer = setTimeout(pump, Math.max(500, Math.min(...waits) - Date.now()))
  emit()
}

addEventListener('online', pump)
addEventListener('offline', emit)
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) pump()
})

import { useEffect, useRef, useState } from 'preact/hooks'
import { api } from '../api.js'
import * as queue from '../upload/queue.js'

export function UploadPanel({ ev, onProgress }) {
  const [q, setQ] = useState(null)
  const [server, setServer] = useState(null)
  const [drag, setDrag] = useState(false)
  const filesRef = useRef(null)
  const folderRef = useRef(null)
  const closed = ev.status === 'expired'

  useEffect(() => {
    const off = queue.subscribe(setQ)
    queue.openEvent(ev.id)
    const warn = (e) => {
      if (queue.hasUnsaved()) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    addEventListener('beforeunload', warn)
    return () => {
      off()
      removeEventListener('beforeunload', warn)
    }
  }, [ev.id])

  // Server-side processing progress
  useEffect(() => {
    let stop = false
    const tick = async () => {
      try {
        const p = await api(`/events/${ev.id}/uploads/progress`)
        if (stop) return
        setServer(p)
        if (p.event_status !== ev.status) onProgress()
      } catch {}
      if (!stop) setTimeout(tick, 5000)
    }
    tick()
    return () => {
      stop = true
    }
  }, [ev.id, ev.status])

  const add = (files) => {
    if (!files?.length || closed) return
    queue.addFiles(ev.id, files)
  }

  if (!q) return null
  const c = server?.counts || {}
  const scanned = c.done || 0
  const scanning = (c.uploaded || 0) + (c.processing || 0)
  const inQueue = q.compressing + q.waiting + q.uploading

  return (
    <div class="stack">
      {closed ? (
        <div class="banner red">This event has expired. New photos can't be uploaded.</div>
      ) : (
        <div
          class={drag ? 'dropzone on' : 'dropzone'}
          onDragOver={(e) => {
            e.preventDefault()
            setDrag(true)
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDrag(false)
            add(e.dataTransfer.files)
          }}
        >
          <div class="drop-icon">🖼️</div>
          <p>
            <b>Drop photos here</b> or choose them
          </p>
          <div class="row wrap center">
            <button class="btn primary" onClick={() => filesRef.current.click()}>
              Choose photos
            </button>
            <button class="btn ghost" onClick={() => folderRef.current.click()}>
              Choose a whole folder
            </button>
          </div>
          <p class="muted small">JPG / PNG / WebP · Photos are shrunk on your device, so they use less data</p>
          <input
            ref={filesRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            hidden
            onChange={(e) => {
              add(e.currentTarget.files)
              e.currentTarget.value = ''
            }}
          />
          <input
            ref={folderRef}
            type="file"
            webkitdirectory
            multiple
            hidden
            onChange={(e) => {
              add(e.currentTarget.files)
              e.currentTarget.value = ''
            }}
          />
        </div>
      )}

      {!q.online && <div class="banner amber">📶 No internet — your photos are safe and will upload as soon as you're back online.</div>}
      {q.limitHit && (
        <div class="banner red">
          This plan's photo limit is full ({ev.limits.max_photos.toLocaleString('en-IN')}).{' '}
          {ev.role === 'owner' ? (
            <a href={`/events/${ev.id}?tab=plan`}>Upgrade the plan →</a>
          ) : (
            'Ask the event owner to upgrade the plan.'
          )}
        </div>
      )}

      <div class="stats">
        <Stat n={q.done} label="Uploaded (this session)" />
        <Stat n={inQueue} label="In queue" tone={inQueue ? 'amber' : ''} />
        <Stat n={scanned} label="Face scan done" tone="green" />
        <Stat n={scanning} label="Scanning now" />
      </div>

      {inQueue > 0 && (
        <p class="muted small">
          ⏳ {q.compressing > 0 && `${q.compressing} being shrunk · `}
          {q.uploading} uploading · {q.waiting} waiting.
          {q.compressing > 0 && ' Please keep this tab open until “being shrunk” reaches zero.'}
        </p>
      )}
      {q.duplicate > 0 && <p class="muted small">{q.duplicate} photos were already uploaded, so they were skipped.</p>}
      {q.failed.length > 0 && (
        <details class="panel">
          <summary class="error">{q.failed.length} photos could not be uploaded</summary>
          <ul class="small">
            {q.failed.slice(0, 50).map((f, i) => (
              <li key={i}>
                {f.name} — {f.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function Stat({ n, label, tone = '' }) {
  return (
    <div class={`stat ${tone}`}>
      <b>{n}</b>
      <span>{label}</span>
    </div>
  )
}

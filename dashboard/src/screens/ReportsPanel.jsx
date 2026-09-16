import { useEffect, useState } from 'preact/hooks'
import { api, errorText } from '../api.js'

const REASONS = {
  not_me: 'Guest: “Not me” (wrong match)',
  remove_me: 'Guest: “Remove me from this photo”',
  inappropriate: 'Inappropriate photo',
  other: 'Other',
}

export function ReportsPanel({ ev, onChanged }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState(null)

  const load = () => api(`/events/${ev.id}/reports`).then(setRows).catch(setErr)
  useEffect(() => {
    load()
  }, [ev.id])

  const act = async (path) => {
    try {
      await api(path, { method: 'POST' })
      load()
      onChanged()
    } catch (e) {
      setErr(e)
    }
  }

  if (err) return <p class="error">{errorText(err)}</p>
  if (!rows) return <p class="muted">Loading…</p>

  // "Not me" reports are mostly match-quality signals; privacy requests need action
  const open = rows.filter((r) => r.status === 'open' && r.reason !== 'not_me')
  const notMe = rows.filter((r) => r.reason === 'not_me').length

  return (
    <div class="stack">
      <p class="muted small">
        Guests tapped “Not me” {notMe} times. If that number is high, set face matching to “Strict” in Settings.
      </p>
      {open.length === 0 ? (
        <div class="panel center">
          <p>✓ No pending requests</p>
        </div>
      ) : (
        <div class="reports">
          {open.map((r) => (
            <div key={r.id} class="report">
              {r.thumb && r.photo_status !== 'hidden' ? <img src={r.thumb} alt="" loading="lazy" /> : <div class="thumb-gone">Photo removed</div>}
              <div class="stack">
                <b>{REASONS[r.reason] || r.reason}</b>
                {r.note && <p class="small">“{r.note}”</p>}
                <span class="muted small">{new Date(r.created_at).toLocaleString('en-IN')}</span>
                <div class="row">
                  {r.photo_id && r.photo_status !== 'hidden' && (
                    <button class="btn danger" onClick={() => act(`/events/${ev.id}/photos/${r.photo_id}/hide`)}>
                      Hide photo from everyone
                    </button>
                  )}
                  <button class="btn ghost" onClick={() => act(`/events/${ev.id}/reports/${r.id}/dismiss`)}>
                    It's fine, keep it
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

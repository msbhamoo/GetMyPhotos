import { useEffect, useState } from 'preact/hooks'
import { api, errorText } from '../api.js'
import { navigate } from '../router.js'

export const STATUS = {
  draft: ['Upload photos', 'gray'],
  processing: ['Scanning photos', 'amber'],
  live: ['Live — guests can find their photos', 'green'],
  expired: ['Expired', 'red'],
}

export function daysLeft(expiresAt) {
  if (!expiresAt) return null
  return Math.max(0, Math.ceil((new Date(expiresAt) - Date.now()) / 86400000))
}

export function Events() {
  const [events, setEvents] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    api('/events').then(setEvents).catch(setErr)
  }, [])

  if (err) return <p class="error">{errorText(err)}</p>
  if (!events) return <p class="muted">Loading…</p>

  if (events.length === 0) {
    return (
      <div class="empty">
        <div class="empty-icon">💐</div>
        <h1>Create your first event</h1>
        <p class="muted">Upload photos, share the QR code — guests take a selfie and get their photos.</p>
        <button class="btn primary big" onClick={() => navigate('/new')}>
          + Create an event
        </button>
      </div>
    )
  }

  return (
    <div class="stack">
      <div class="page-head">
        <h1>My events</h1>
        <button class="btn primary" onClick={() => navigate('/new')}>
          + New event
        </button>
      </div>
      <div class="cards">
        {events.map((ev) => {
          const [label, tone] = STATUS[ev.status] || [ev.status, 'gray']
          const days = daysLeft(ev.expires_at)
          return (
            <button key={ev.id} class="event-card" onClick={() => navigate(`/events/${ev.id}`)}>
              <div class="event-cover">
                {ev.cover_thumb ? <img src={ev.cover_thumb} alt="" loading="lazy" /> : <span>💐</span>}
              </div>
              <div class="event-body">
                <h2>{ev.title}</h2>
                <p class="muted small">
                  {ev.plan_code !== 'free' && '⭐ '}
                  {ev.photo_count} photos · Code <b>{ev.code}</b>
                  {days !== null && ev.status !== 'expired' && <> · {days} days left</>}
                </p>
                <span class={`badge ${tone}`}>{label}</span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

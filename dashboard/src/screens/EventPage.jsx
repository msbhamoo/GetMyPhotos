import { useEffect, useState } from 'preact/hooks'
import { api, errorText } from '../api.js'
import { navigate } from '../router.js'
import { STATUS, daysLeft } from './Events.jsx'
import { UploadPanel } from './UploadPanel.jsx'
import { SharePanel } from './SharePanel.jsx'
import { PlanPanel, planName } from './PlanPanel.jsx'
import { TeamPanel } from './TeamPanel.jsx'
import { ReportsPanel } from './ReportsPanel.jsx'
import { SettingsPanel } from './SettingsPanel.jsx'
import { PhotosPanel } from './PhotosPanel.jsx'

export function EventPage({ id, tab }) {
  const [ev, setEv] = useState(null)
  const [err, setErr] = useState(null)

  const load = () => api(`/events/${id}`).then(setEv).catch(setErr)
  useEffect(() => {
    load()
  }, [id])

  if (err) return <p class="error">{errorText(err)}</p>
  if (!ev) return <p class="muted">Loading…</p>

  const owner = ev.role === 'owner'
  const reports = ev.stats.open_reports
  const [label, tone] = STATUS[ev.status] || [ev.status, 'gray']
  const days = daysLeft(ev.expires_at)
  const done = ev.stats?.photos?.done || 0

  const tabs = [
    ['upload', '⬆ Upload'],
    ['photos', `🖼 Photos${done > 0 ? ` (${done})` : ''}`],
    ['share', '🔗 QR & Share'],
    ['plan', ev.plan.kind === 'free' ? '⭐ Upgrade' : '💳 Plan'],
    ['team', '👥 Team'],
    owner && ['reports', reports ? `🚩 Reports (${reports})` : '🚩 Reports'],
    owner && ['settings', '⚙ Settings'],
  ].filter(Boolean)
  const active = tabs.some((t) => t[0] === tab) ? tab : 'upload'

  return (
    <div class="stack">
      <div class="page-head">
        <div>
          <h1>{ev.title}</h1>
          <p class="muted small">
            Code <b>{ev.code}</b> · {planName(ev.plan)} · {done.toLocaleString('en-IN')}/
            {ev.limits.max_photos.toLocaleString('en-IN')} photos · {ev.stats.searches} guest searches
            {days !== null && ev.status !== 'expired' && <> · {days} days left</>}
          </p>
        </div>
        <span class={`badge ${tone}`}>{label}</span>
      </div>

      {owner && ev.plan.kind === 'free' && days !== null && days <= 3 && ev.status !== 'expired' && (
        <button class="banner amber clickable" onClick={() => navigate(`/events/${id}?tab=plan`, true)}>
          ⏰ This free event expires in {days} days and the photos will be deleted. Get an Event Pass to keep them 90 days →
        </button>
      )}

      <nav class="tabs">
        {tabs.map(([key, name]) => (
          <button key={key} class={key === active ? 'tab on' : 'tab'} onClick={() => navigate(`/events/${id}?tab=${key}`, true)}>
            {name}
          </button>
        ))}
      </nav>

      {active === 'upload' && <UploadPanel ev={ev} onProgress={load} />}
      {active === 'photos' && <PhotosPanel id={id} />}
      {active === 'share' && <SharePanel ev={ev} />}
      {active === 'plan' && <PlanPanel ev={ev} onChanged={load} />}
      {active === 'team' && <TeamPanel ev={ev} />}
      {active === 'reports' && <ReportsPanel ev={ev} onChanged={load} />}
      {active === 'settings' && <SettingsPanel ev={ev} onSaved={(u) => setEv({ ...ev, ...u })} />}
    </div>
  )
}

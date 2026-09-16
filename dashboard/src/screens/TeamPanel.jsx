import { useEffect, useState } from 'preact/hooks'
import { api, errorText, session } from '../api.js'

export function TeamPanel({ ev }) {
  const [data, setData] = useState(null)
  const [phone, setPhone] = useState('')
  const [created, setCreated] = useState(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const isOwner = ev.role === 'owner'

  const load = () => api(`/events/${ev.id}/members`).then(setData).catch((e) => setMsg({ err: e }))
  useEffect(() => {
    load()
  }, [ev.id])

  const invite = async (e) => {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    try {
      const r = await api(`/events/${ev.id}/invites`, { method: 'POST', json: { phone: phone || null } })
      setCreated(r)
      setPhone('')
      load()
    } catch (err) {
      setMsg({ err })
    } finally {
      setBusy(false)
    }
  }

  const act = async (path) => {
    try {
      await api(path, { method: 'DELETE' })
      load()
    } catch (err) {
      setMsg({ err })
    }
  }

  if (!data) return msg?.err ? <p class="error">{errorText(msg.err)}</p> : <p class="muted">Loading…</p>

  const shareText = created
    ? `Hello! Open this link to upload photos for "${ev.title}" on GetMyPhotos:\n${created.url}`
    : ''

  return (
    <div class="stack narrow">
      {isOwner && (
        <form class="panel stack" onSubmit={invite}>
          <h2>📷 Add a photographer</h2>
          <p class="muted small">
            Added photographers can only upload photos — plan, settings and delete stay with you. This plan allows{' '}
            {ev.plan.max_uploaders} photographers.
          </p>
          <label class="field">
            <span>Photographer's WhatsApp number (optional)</span>
            <div class="row">
              <input
                type="tel"
                inputMode="numeric"
                maxLength={10}
                placeholder="98765 43210"
                value={phone}
                onInput={(e) => setPhone(e.currentTarget.value.replace(/\D/g, ''))}
              />
              <button class="btn primary" disabled={busy || (phone && phone.length !== 10)}>
                Create invite
              </button>
            </div>
          </label>
          {msg?.err && <p class="error">{errorText(msg.err)}</p>}
          {created && (
            <div class="banner green stack">
              <span>
                ✓ Invite created{created.phone ? ' and sent on WhatsApp' : ''}. The link works for 7 days.
              </span>
              <input readOnly value={created.url} onFocus={(e) => e.currentTarget.select()} />
              <a class="btn whatsapp" href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noopener">
                Send link on WhatsApp
              </a>
            </div>
          )}
        </form>
      )}

      <div class="panel stack">
        <h2>Team</h2>
        <ul class="list">
          {data.members.map((m) => (
            <li key={m.id}>
              <div>
                <b>{m.studio_name || m.name || m.phone}</b>
                {m.id === session.user?.id && <span class="muted small"> (you)</span>}
                <div class="muted small">
                  {m.phone} · {m.role === 'owner' ? 'Owner' : 'Photographer'}
                </div>
              </div>
              {isOwner && m.role === 'uploader' && (
                <button class="link danger" onClick={() => confirm('Remove this photographer?') && act(`/events/${ev.id}/members/${m.id}`)}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
        {isOwner && data.invites.length > 0 && (
          <>
            <h3 class="small muted">Pending invites</h3>
            <ul class="list">
              {data.invites.map((i) => (
                <li key={i.id}>
                  <div>
                    <b>{i.phone || 'Link invite'}</b>
                    <div class="muted small">Valid until {new Date(i.expires_at).toLocaleDateString('en-IN')}</div>
                  </div>
                  <button class="link danger" onClick={() => act(`/events/${ev.id}/invites/${i.id}`)}>
                    Cancel
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}

import { useEffect, useState } from 'preact/hooks'
import { api, errorText } from '../api.js'
import { navigate } from '../router.js'

export function InviteAccept({ token }) {
  const [info, setInfo] = useState(null)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api(`/invites/${token}`).then(setInfo).catch(setErr)
  }, [token])

  const accept = async () => {
    setBusy(true)
    try {
      const { event_id } = await api(`/invites/${token}/accept`, { method: 'POST' })
      navigate(`/events/${event_id}?tab=upload`, true)
    } catch (e) {
      setErr(e)
      setBusy(false)
    }
  }

  return (
    <div class="empty">
      <div class="empty-icon">🤝</div>
      {err && <p class="error">{errorText(err)}</p>}
      {!info && !err && <p class="muted">Loading…</p>}
      {info && (
        <>
          <h1>{info.event_title}</h1>
          <p class="muted">
            {info.inviter ? `${info.inviter} has invited you` : "You've been invited"} to upload photos for this event.
          </p>
          {info.valid ? (
            <button class="btn primary big" onClick={accept} disabled={busy}>
              Join and upload photos
            </button>
          ) : (
            <p class="error">This invite has expired or was already used. Ask the owner for a new link.</p>
          )}
        </>
      )}
    </div>
  )
}

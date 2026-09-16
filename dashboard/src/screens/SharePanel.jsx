import { useEffect, useState } from 'preact/hooks'
import { api, errorText } from '../api.js'

export function SharePanel({ ev }) {
  const [qr, setQr] = useState(null)
  const [err, setErr] = useState(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let url
    api(`/events/${ev.id}/qr.png`, { blob: true })
      .then((b) => {
        url = URL.createObjectURL(b)
        setQr(url)
      })
      .catch(setErr)
    return () => url && URL.revokeObjectURL(url)
  }, [ev.id, ev.has_pin, ev.title])

  const message =
    `📸 Get your photos from ${ev.title} — just take a selfie, no app needed:\n${ev.guest_url}` +
    (ev.has_pin ? '\n(Ask the host for the PIN)' : '')

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(ev.guest_url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  return (
    <div class="share">
      <div class="panel center">
        {err && <p class="error">{errorText(err)}</p>}
        {qr ? <img class="qr" src={qr} alt={`QR card for ${ev.code}`} /> : !err && <p class="muted">Making the QR card…</p>}
        {qr && (
          <a class="btn primary" href={qr} download={`GetMyPhotos-${ev.code}.png`}>
            ⬇ Download QR card
          </a>
        )}
        <p class="muted small">Print it and put it at the entrance, near the stage and on the tables.</p>
      </div>

      <div class="panel stack">
        <h2>Share with guests</h2>
        <label class="field">
          <span>Guest link</span>
          <div class="row">
            <input readOnly value={ev.guest_url} onFocus={(e) => e.currentTarget.select()} />
            <button class="btn ghost" onClick={copy}>
              {copied ? '✓ Copied' : 'Copy'}
            </button>
          </div>
        </label>
        <a class="btn whatsapp big" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener">
          Share on WhatsApp
        </a>
        <div class="kv">
          <span>Event code</span>
          <b>{ev.code}</b>
          <span>PIN</span>
          <b>{ev.has_pin ? 'Set 🔒' : 'None (anyone with the link can view)'}</b>
        </div>
        {ev.status !== 'live' && (
          <p class="banner amber small">Guests can only search once at least some photos have been scanned.</p>
        )}
      </div>
    </div>
  )
}

import { useState } from 'preact/hooks'
import { api, errorText } from '../api.js'
import { navigate } from '../router.js'
import { LANGUAGES } from './NewEvent.jsx'

const STRICTNESS = [
  ['strict', 'Strict', 'Fewer photos, very few mistakes'],
  ['normal', 'Normal', 'Best for most events'],
  ['loose', 'Loose', 'More photos, sometimes a wrong match'],
]

export function SettingsPanel({ ev, onSaved }) {
  const isOwner = ev.role === 'owner'
  const [form, setForm] = useState({
    title: ev.title,
    event_date: ev.event_date || '',
    city: ev.city || '',
    lang: ev.lang,
    strictness: ev.strictness,
  })
  const [pin, setPin] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm({ ...form, [k]: e.currentTarget.value })

  const save = async (extra = {}) => {
    setBusy(true)
    setMsg(null)
    try {
      const updated = await api(`/events/${ev.id}`, {
        method: 'PATCH',
        json: { ...form, event_date: form.event_date || null, city: form.city || null, ...extra },
      })
      onSaved({ ...ev, ...updated })
      setPin('')
      setMsg({ ok: 'Saved ✓' })
    } catch (e) {
      setMsg({ err: e })
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    const typed = prompt(`This deletes the event forever — all photos and face data will be erased.\nType the code to confirm: ${ev.code}`)
    if (typed?.trim().toUpperCase() !== ev.code) return
    try {
      await api(`/events/${ev.id}`, { method: 'DELETE' })
      navigate('/', true)
    } catch (e) {
      setMsg({ err: e })
    }
  }

  if (!isOwner) return <p class="muted">Only the event owner can change settings.</p>

  return (
    <div class="stack narrow">
      <form
        class="panel stack"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <h2>Event details</h2>
        <label class="field">
          <span>Name</span>
          <input value={form.title} onInput={set('title')} required minLength={2} />
        </label>
        <div class="row">
          <label class="field">
            <span>Date</span>
            <input type="date" value={form.event_date} onInput={set('event_date')} />
          </label>
          <label class="field">
            <span>City</span>
            <input value={form.city} onInput={set('city')} />
          </label>
        </div>
        <label class="field">
          <span>Language for guests</span>
          <select value={form.lang} onChange={set('lang')}>
            {LANGUAGES.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </label>

        <fieldset class="field">
          <span>How strict should face matching be?</span>
          {STRICTNESS.map(([key, name, hint]) => (
            <label key={key} class="check">
              <input type="radio" name="strictness" checked={form.strictness === key} onChange={() => setForm({ ...form, strictness: key })} />
              <span>
                <b>{name}</b> — {hint}
              </span>
            </label>
          ))}
        </fieldset>

        {msg?.ok && <p class="ok">{msg.ok}</p>}
        {msg?.err && <p class="error">{errorText(msg.err)}</p>}
        <button class="btn primary" disabled={busy}>
          Save
        </button>
      </form>

      <div class="panel stack">
        <h2>🔒 PIN</h2>
        <p class="muted small">{ev.has_pin ? 'A PIN is set.' : 'No PIN yet.'}</p>
        <div class="row">
          <input
            inputMode="numeric"
            maxLength={4}
            placeholder="New 4-digit PIN"
            value={pin}
            onInput={(e) => setPin(e.currentTarget.value.replace(/\D/g, ''))}
          />
          <button class="btn ghost" disabled={busy || pin.length !== 4} onClick={() => save({ pin })}>
            {ev.has_pin ? 'Change PIN' : 'Set PIN'}
          </button>
        </div>
        {ev.has_pin && (
          <button class="link danger" disabled={busy} onClick={() => save({ pin: '' })}>
            Remove PIN
          </button>
        )}
      </div>

      <div class="panel stack danger-zone">
        <h2>Delete event</h2>
        <p class="muted small">All photos, face data and the QR link will be gone forever.</p>
        <button class="btn danger" onClick={remove}>
          Delete event
        </button>
      </div>
    </div>
  )
}

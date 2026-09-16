import { useState } from 'preact/hooks'
import { api, errorText } from '../api.js'
import { navigate } from '../router.js'

export const LANGUAGES = [
  ['en', 'English'],
  ['hi', 'Hindi'],
  ['bn', 'বাংলা (Bengali)'],
]

export function NewEvent() {
  const [form, setForm] = useState({ title: '', event_date: '', city: '', lang: 'en', pin: '' })
  const [usePin, setUsePin] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)
  const set = (k) => (e) => setForm({ ...form, [k]: e.currentTarget.value })

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)
    try {
      const ev = await api('/events', {
        method: 'POST',
        json: {
          title: form.title.trim(),
          event_date: form.event_date || null,
          city: form.city.trim() || null,
          lang: form.lang,
          pin: usePin && form.pin ? form.pin : null,
        },
      })
      navigate(`/events/${ev.id}?tab=upload`, true)
    } catch (e) {
      setErr(e)
      setBusy(false)
    }
  }

  return (
    <form class="panel stack narrow" onSubmit={submit}>
      <h1>New event</h1>
      <label class="field">
        <span>Event name *</span>
        <input value={form.title} onInput={set('title')} placeholder="Rahul weds Priya" required minLength={2} autofocus />
      </label>
      <div class="row">
        <label class="field">
          <span>Date</span>
          <input type="date" value={form.event_date} onInput={set('event_date')} />
        </label>
        <label class="field">
          <span>City</span>
          <input value={form.city} onInput={set('city')} placeholder="Indore" />
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
      <label class="check">
        <input type="checkbox" checked={usePin} onChange={(e) => setUsePin(e.currentTarget.checked)} />
        <span>Add a PIN (only guests who know it can see photos)</span>
      </label>
      {usePin && (
        <label class="field">
          <span>4-digit PIN</span>
          <input
            inputMode="numeric"
            maxLength={4}
            value={form.pin}
            onInput={(e) => setForm({ ...form, pin: e.currentTarget.value.replace(/\D/g, '') })}
            required
            pattern="\d{4}"
          />
        </label>
      )}
      <p class="muted small">
        By creating this event you confirm that guests will be told their photos can be searched by face.
      </p>
      {err && <p class="error">{errorText(err)}</p>}
      <button class="btn primary big" disabled={busy}>
        Create event →
      </button>
    </form>
  )
}

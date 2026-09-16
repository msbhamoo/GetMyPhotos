import { useEffect, useState } from 'preact/hooks'
import { api, ensureSession, logout } from '../api.js'
import { Header, LangBar } from '../components/LangBar.jsx'
import { t, tErr } from '../i18n.js'
import { navigate } from '../router.js'

export function MyEvents() {
  const [ready, setReady] = useState(false)
  const [profile, setProfile] = useState(null)
  const [events, setEvents] = useState([])
  const [code, setCode] = useState('')
  const [pin, setPin] = useState('')
  const [needPin, setNeedPin] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const load = async () => {
    const [p, list] = await Promise.all([api('/guest/profile'), api('/guest/events')])
    setProfile(p)
    setEvents(list)
  }

  useEffect(() => {
    ensureSession().then((user) => {
      if (!user) return navigate('/me/login?next=/me', true)
      load()
        .catch(setErr)
        .finally(() => setReady(true))
    })
  }, [])

  const join = async (e) => {
    e.preventDefault()
    setErr(null)
    setBusy(true)
    try {
      const r = await api('/guest/events', {
        method: 'POST',
        json: { code: code.replace(/[^A-Za-z0-9]/g, '').toUpperCase(), pin: pin || null, via: 'code' },
      })
      setCode('')
      setPin('')
      setNeedPin(false)
      navigate(`/me/e/${r.event_id}`)
    } catch (e) {
      if (e.code === 'PIN_REQUIRED') setNeedPin(true)
      setErr(e)
    } finally {
      setBusy(false)
    }
  }

  const removeFace = async () => {
    if (!confirm(t('me.delete_face_confirm'))) return
    await api('/guest/face', { method: 'DELETE' }).catch(setErr)
    load().catch(setErr)
  }

  const leave = async (ev) => {
    if (!confirm(t('me.leave_confirm', { title: ev.title }))) return
    await api(`/guest/events/${ev.id}`, { method: 'DELETE' }).catch(setErr)
    load().catch(setErr)
  }

  if (!ready) {
    return (
      <main class="screen">
        <Header />
        <p class="center muted">{t('welcome.loading')}</p>
      </main>
    )
  }

  return (
    <main class="screen">
      <Header />
      <LangBar />
      <div class="page-head">
        <h1>{t('me.title')}</h1>
        <button
          class="link"
          onClick={() => logout().then(() => navigate('/', true))}
        >
          {t('me.logout')}
        </button>
      </div>
      {err && <p class="error">{tErr(err)}</p>}

      {profile && !profile.has_face && (
        <div class="card note-card">
          <p>{t('me.no_face')}</p>
          <button class="btn primary" onClick={() => navigate('/me/selfie')}>
            🤳 {t('me.set_face')}
          </button>
        </div>
      )}

      {events.length === 0 ? (
        <p class="muted center">{t('me.empty')}</p>
      ) : (
        <ul class="event-list">
          {events.map((ev) => (
            <li key={ev.id}>
              <button class="event-row" onClick={() => navigate(`/me/e/${ev.id}`)}>
                <div class="event-thumb">
                  {ev.cover_thumb ? <img src={ev.cover_thumb} alt="" loading="lazy" /> : <span>💐</span>}
                </div>
                <div class="event-info">
                  <b>{ev.title}</b>
                  <span class="muted small">
                    {ev.status === 'expired' ? t('me.expired') : t('me.photos', { n: ev.photo_count })}
                    {ev.city ? ` · ${ev.city}` : ''}
                  </span>
                </div>
                {ev.new_count > 0 && <span class="new-badge">{t('me.new', { n: ev.new_count })}</span>}
              </button>
              <button class="link small" onClick={() => leave(ev)}>
                {t('me.leave')}
              </button>
            </li>
          ))}
        </ul>
      )}

      <form class="card stack" onSubmit={join}>
        <h2>{t('me.add')}</h2>
        <input
          class="input code"
          value={code}
          onInput={(e) => setCode(e.currentTarget.value)}
          placeholder={t('me.add_code')}
          autocapitalize="characters"
          autocomplete="off"
          maxLength={12}
        />
        {needPin && (
          <input
            class="input pin"
            inputMode="numeric"
            maxLength={4}
            value={pin}
            onInput={(e) => setPin(e.currentTarget.value.replace(/\D/g, ''))}
            placeholder={t('welcome.pin_label')}
          />
        )}
        <button class="btn primary" disabled={busy || code.replace(/\W/g, '').length < 4}>
          {t('join.cta')}
        </button>
      </form>

      {profile?.has_face && (
        <button class="link danger center" onClick={removeFace}>
          {t('me.delete_face')}
        </button>
      )}
      <footer class="foot">
        <a href="/privacy">{t('privacy.link')}</a>
      </footer>
    </main>
  )
}

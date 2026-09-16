import { useEffect, useState } from 'preact/hooks'
import { api, ensureSession } from '../api.js'
import { Header, LangBar } from '../components/LangBar.jsx'
import { initialLang, savedLang, setLang, t, tErr } from '../i18n.js'
import { navigate } from '../router.js'
import { store } from '../store.js'
import { Join } from './Join.jsx'

export function Welcome({ code }) {
  const [ev, setEv] = useState(store.get('event:' + code))
  const [loadErr, setLoadErr] = useState(null)
  const [hasFace, setHasFace] = useState(false)
  const [pin, setPin] = useState('')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api(`/public/events/${encodeURIComponent(code)}`)
      .then((e) => {
        store.set('event:' + code, e)
        setEv(e)
        if (!savedLang() && !new URLSearchParams(location.search).get('lang')) setLang(initialLang(e.lang))
      })
      .catch(setLoadErr)

    // Returning guests with a saved face code skip the selfie entirely
    ensureSession().then((user) => {
      if (user) api('/guest/profile').then((p) => setHasFace(p.has_face)).catch(() => {})
    })
  }, [code])

  if (loadErr && !ev) {
    return <Join initialCode={code} initialError={loadErr.status === 404 ? 'Event not found. Please double-check the 4-digit code.' : tErr(loadErr)} />
  }
  if (!ev) {
    return (
      <Shell>
        <p class="center muted">{t('welcome.loading')}</p>
      </Shell>
    )
  }

  const needsPin = ev.requires_pin && !store.get('access:' + code)
  const closed = ev.status === 'expired' || ev.status === 'draft'

  const unlock = async () => {
    if (!needsPin) return true
    if (!/^\d{4}$/.test(pin)) {
      setErr({ key: 'err.pin_required' })
      return false
    }
    setBusy(true)
    try {
      const { event_access } = await api(`/public/events/${code}/unlock`, { method: 'POST', json: { pin } })
      store.set('access:' + code, event_access)
      return true
    } catch (e) {
      setErr(e.code === 'PIN_WRONG' ? { key: 'err.pin_wrong' } : e)
      return false
    } finally {
      setBusy(false)
    }
  }

  const start = async () => {
    setErr(null)
    if (!(await unlock())) return
    store.set('consent:' + code, ev.consent_version)
    navigate(`/e/${code}/selfie`)
  }

  const skipSelfie = async () => {
    setErr(null)
    if (!(await unlock())) return
    setBusy(true)
    try {
      const r = await api('/guest/events', { method: 'POST', json: { code, via: 'qr' } })
      navigate(`/me/e/${r.event_id}`)
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell>
      <div class="cover">
        {ev.cover_thumb ? <img src={ev.cover_thumb} alt="" /> : <div class="cover-fallback">💐</div>}
      </div>
      <section class="card">
        <h1 class="title">{ev.title}</h1>
        <p class="muted">
          {[ev.event_date && new Date(ev.event_date).toLocaleDateString(), ev.city].filter(Boolean).join(' · ')}
          {ev.photo_count > 0 && <> · {t('welcome.photos', { n: ev.photo_count })}</>}
        </p>

        {closed ? (
          <p class="big-msg">{ev.status === 'expired' ? t('welcome.expired') : t('welcome.not_ready')}</p>
        ) : (
          <>
            {needsPin && (
              <label class="stack">
                <span class="label">{t('welcome.pin_label')}</span>
                <input
                  class="input pin"
                  inputMode="numeric"
                  pattern="\d*"
                  maxLength={4}
                  value={pin}
                  onInput={(e) => setPin(e.currentTarget.value.replace(/\D/g, ''))}
                  autocomplete="off"
                />
              </label>
            )}
            {err && <p class="error">{tErr(err)}</p>}
            {hasFace ? (
              <>
                <button class="btn primary big" onClick={skipSelfie} disabled={busy}>
                  ⚡ {t('me.shortcut')}
                </button>
                <button class="btn ghost" onClick={start} disabled={busy}>
                  🤳 {t('welcome.cta')}
                </button>
              </>
            ) : (
              <>
                <button class="btn primary big" onClick={start} disabled={busy}>
                  🤳 {t('welcome.cta')}
                </button>
                <p class="consent">{t('welcome.consent')}</p>
              </>
            )}
            <p class="privacy">🔒 {t('welcome.privacy')}</p>
          </>
        )}
      </section>
    </Shell>
  )
}

function Shell({ children }) {
  return (
    <main class="screen">
      <Header />
      <LangBar />
      {children}
      <footer class="foot">
        <a href="/privacy">{t('privacy.link')}</a>
      </footer>
    </main>
  )
}

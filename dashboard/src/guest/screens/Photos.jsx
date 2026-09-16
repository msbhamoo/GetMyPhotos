import { useState } from 'preact/hooks'
import { api } from '../api.js'
import { PhotoActions, PhotoGrid } from '../components/PhotoGrid.jsx'
import { SaveProfile } from '../components/SaveProfile.jsx'
import { t } from '../i18n.js'
import { navigate } from '../router.js'
import { store } from '../store.js'

export function Photos({ code, save }) {
  const [res, setRes] = useState(store.get('results:' + code))
  const [expired, setExpired] = useState(false)

  if (!res) {
    navigate(`/e/${code}`, true)
    return null
  }

  const event = store.get('event:' + code) || {}

  const persist = (next) => {
    store.set('results:' + code, next)
    setRes(next)
  }

  // Hiding/reporting is best-effort: the photo still disappears locally
  const handle = (e) => {
    if (e.code === 'SEARCH_EXPIRED') setExpired(true)
  }

  const notMe = async (photo) => {
    await api(`/public/search/${res.token}/not-me`, { method: 'POST', json: { photo_id: photo.id } }).catch(handle)
    persist({
      ...res,
      matches: res.matches.filter((p) => p.id !== photo.id),
      maybe: res.maybe.filter((p) => p.id !== photo.id),
    })
  }

  const report = (photo) =>
    api('/public/reports', {
      method: 'POST',
      json: { token: res.token, photo_id: photo.id, reason: 'remove_me' },
    }).catch(handle)

  const retry = () => navigate(`/e/${code}/selfie`, true)
  const count = res.matches.length

  if (expired) {
    return (
      <main class="screen">
        <section class="center">
          <p class="big-msg">{t('err.search_expired')}</p>
          <button class="btn primary big" onClick={retry}>
            {t('photos.retry')}
          </button>
        </section>
      </main>
    )
  }

  return (
    <main class="screen photos">
      <header class="top">
        <span class="brand">{res.event.title}</span>
        <button class="link" onClick={retry}>
          🤳 {t('selfie.retake')}
        </button>
      </header>

      {count > 0 ? (
        <h1 class="found">🎉 {t('photos.found', { n: count })}</h1>
      ) : (
        <section class="center">
          <div class="hero-icon">😕</div>
          <p class="big-msg">{t('photos.none')}</p>
          <p class="muted">{t('photos.none_hint')}</p>
          <button class="btn primary big" onClick={retry}>
            {t('photos.retry')}
          </button>
        </section>
      )}

      <PhotoGrid photos={res.matches} onNotMe={notMe} onReport={report} />

      {res.maybe.length > 0 && (
        <details class="maybe">
          <summary>{t('photos.maybe', { n: res.maybe.length })}</summary>
          <PhotoGrid photos={res.maybe} onNotMe={notMe} onReport={report} />
        </details>
      )}

      {count > 0 && (
        <SaveProfile
          code={code}
          token={res.token}
          consentVersion={event.profile_consent_version}
          autoOpen={save}
        />
      )}

      <PhotoActions
        count={count}
        singleUrl={res.matches[0]?.dl}
        zipPath={`/public/search/${res.token}/zip`}
        waPath={`/public/search/${res.token}/whatsapp`}
        waImages={res.event.wa_images || 0}
      />
    </main>
  )
}

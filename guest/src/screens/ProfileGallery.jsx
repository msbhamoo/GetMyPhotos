import { useEffect, useState } from 'preact/hooks'
import { api, ensureSession } from '../api.js'
import { Header } from '../components/LangBar.jsx'
import { PhotoActions, PhotoGrid } from '../components/PhotoGrid.jsx'
import { t, tErr } from '../i18n.js'
import { navigate } from '../router.js'

export function ProfileGallery({ id }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    ensureSession().then((user) => {
      if (!user) return navigate(`/me/login?next=/me/e/${id}`, true)
      api(`/guest/events/${id}/photos`).then(setData).catch(setErr)
    })
  }, [id])

  if (err) {
    return (
      <main class="screen">
        <Header />
        <p class="center error">{tErr(err)}</p>
      </main>
    )
  }
  if (!data) {
    return (
      <main class="screen">
        <Header />
        <p class="center muted">{t('welcome.loading')}</p>
      </main>
    )
  }

  const notMe = async (photo) => {
    await api(`/guest/events/${id}/not-me`, { method: 'POST', json: { photo_id: photo.id } }).catch(() => {})
    setData({ ...data, photos: data.photos.filter((p) => p.id !== photo.id) })
  }

  const count = data.photos.length
  return (
    <main class="screen photos">
      <header class="top">
        <button class="link" onClick={() => navigate('/me')}>
          ←
        </button>
        <span class="brand">{data.event.title}</span>
        <span />
      </header>

      {count > 0 ? (
        <h1 class="found">{t('photos.found', { n: count })}</h1>
      ) : (
        <section class="center">
          <div class="hero-icon">🙂</div>
          <p class="big-msg">{data.event.status === 'expired' ? t('welcome.expired') : t('photos.none')}</p>
          {data.event.status !== 'expired' && <p class="muted">{t('me.none_yet')}</p>}
        </section>
      )}

      <PhotoGrid photos={data.photos} onNotMe={notMe} />
      <PhotoActions
        count={count}
        singleUrl={data.photos[0]?.dl}
        zipPath={`/guest/events/${id}/zip`}
        waPath={`/guest/events/${id}/whatsapp`}
        waImages={data.event.wa_direct ? data.event.wa_images : 0}
      />
    </main>
  )
}

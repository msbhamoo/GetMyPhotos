import { useEffect, useState } from 'preact/hooks'
import { api } from '../api.js'
import { Header } from '../components/LangBar.jsx'
import { PhotoActions, PhotoGrid } from '../components/PhotoGrid.jsx'
import { t, tErr } from '../i18n.js'

/** Opened from a WhatsApp link — no login, no selfie. */
export function SharedGallery({ gid }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    api(`/public/gallery/${gid}`).then(setData).catch(setErr)
  }, [gid])

  if (err) {
    return (
      <main class="screen">
        <Header />
        <section class="center">
          <div class="hero-icon">🔗</div>
          <p class="big-msg">{err.code === 'GALLERY_NOT_FOUND' ? t('gallery.expired') : tErr(err)}</p>
          <a class="btn ghost" href="/">
            {t('join.cta')}
          </a>
        </section>
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

  return (
    <main class="screen photos">
      <header class="top">
        <span class="brand">{data.event.title}</span>
      </header>
      <h1 class="found">{t('gallery.title')} ({data.photos.length})</h1>
      <PhotoGrid photos={data.photos} />
      <PhotoActions count={data.photos.length} singleUrl={data.photos[0]?.dl} zipPath={`/public/gallery/${gid}/zip`} />
    </main>
  )
}

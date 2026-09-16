import { useState } from 'preact/hooks'
import { api, runZip } from '../api.js'
import { t, tErr } from '../i18n.js'
import { Viewer } from './Viewer.jsx'

export function PhotoGrid({ photos, onNotMe, onReport }) {
  const [open, setOpen] = useState(null)
  return (
    <>
      <div class="grid">
        {photos.map((p) => (
          <figure key={p.id} class="tile">
            <button class="tile-img" onClick={() => setOpen(p)}>
              <img src={p.thumb} loading="lazy" decoding="async" alt="" />
            </button>
            {onNotMe ? (
              <button class="not-me" onClick={() => onNotMe(p)}>
                {t('photos.not_me')}
              </button>
            ) : (
              <a class="not-me" href={p.dl}>
                ⬇ {t('photos.download')}
              </a>
            )}
          </figure>
        ))}
      </div>
      {open && (
        <Viewer
          photo={open}
          onClose={() => setOpen(null)}
          onNotMe={onNotMe}
          onReport={onReport}
        />
      )}
    </>
  )
}

/** Sticky bottom bar: Download All + WhatsApp (link or photos). */
export function PhotoActions({ count, zipPath, waPath, waImages = 0, singleUrl }) {
  const [zip, setZip] = useState(null) // null | 'working' | error
  const [wa, setWa] = useState(null)
  const [err, setErr] = useState(null)

  const download = async () => {
    setErr(null)
    if (count === 1 && singleUrl) {
      location.href = singleUrl
      return
    }
    setZip('working')
    try {
      location.href = await runZip(zipPath)
    } catch (e) {
      setErr(e)
    } finally {
      setZip(null)
    }
  }

  const sendWhatsApp = async (mode) => {
    setErr(null)
    setWa(mode)
    try {
      const r = await api(waPath, { method: 'POST', json: { mode } })
      // Opened from the tap itself so mobile browsers don't block it
      location.href = r.wa_link
    } catch (e) {
      setErr(e)
    } finally {
      setWa(null)
    }
  }

  if (!count) return null
  return (
    <div class="sticky-bar">
      {err && <p class="error">{tErr(err)}</p>}
      <button class="btn primary big" onClick={download} disabled={zip === 'working'}>
        {zip === 'working' ? t('photos.preparing') : `⬇ ${t('photos.download_all')} (${count})`}
      </button>
      {waPath && (
        <div class="row">
          <button class="btn whatsapp" onClick={() => sendWhatsApp('link')} disabled={!!wa}>
            {wa === 'link' ? '…' : `💬 ${t('wa.link')}`}
          </button>
          {waImages > 0 && (
            <button class="btn whatsapp ghost-wa" onClick={() => sendWhatsApp('images')} disabled={!!wa}>
              {wa === 'images' ? '…' : `📷 ${t('wa.images', { n: Math.min(waImages, count) })}`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

import { useEffect, useState } from 'preact/hooks'
import { t } from '../i18n.js'

export function Viewer({ photo, onClose, onNotMe, onReport }) {
  const [reported, setReported] = useState(false)

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    addEventListener('keydown', onKey)
    history.pushState({ viewer: true }, '')
    const onPop = () => onClose()
    addEventListener('popstate', onPop, { once: true })
    return () => {
      removeEventListener('keydown', onKey)
      removeEventListener('popstate', onPop)
    }
  }, [])

  return (
    <div class="viewer" role="dialog" aria-modal="true">
      <button class="viewer-close" onClick={() => history.back()} aria-label={t('photos.close')}>
        ✕
      </button>
      <img src={photo.web} alt="" />
      <div class="viewer-bar">
        <a class="btn primary" href={photo.dl}>
          ⬇ {t('photos.download')}
        </a>
        {onNotMe && (
          <button class="btn ghost light" onClick={() => Promise.resolve(onNotMe(photo)).then(() => history.back())}>
            🙅 {t('photos.not_me')}
          </button>
        )}
        {onReport &&
          (reported ? (
            <p class="note">{t('photos.reported')}</p>
          ) : (
            <button class="link" onClick={() => Promise.resolve(onReport(photo)).then(() => setReported(true))}>
              {t('photos.report')}
            </button>
          ))}
      </div>
    </div>
  )
}

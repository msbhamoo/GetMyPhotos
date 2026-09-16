import { useState } from 'preact/hooks'
import { LANGS, setLang, useLang } from '../i18n.js'

export function Header() {
  const lang = useLang()
  const [showLang, setShowLang] = useState(false)

  const currentLabel = LANGS.find(([code]) => code === lang)?.[1] || 'English'

  return (
    <header class="top-nav">
      <div class="top-brand">
        <span class="top-icon">📸</span>
        <span class="top-title">GetMyPhotos</span>
      </div>

      <div class="lang-dropdown-wrapper">
        <button
          type="button"
          class="lang-trigger-btn"
          onClick={() => setShowLang(!showLang)}
          aria-label="Select Language"
        >
          🌐 {currentLabel} ▾
        </button>

        {showLang && (
          <div class="lang-dropdown-menu">
            {LANGS.map(([code, label]) => (
              <button
                key={code}
                type="button"
                class={lang === code ? 'lang-item on' : 'lang-item'}
                onClick={() => {
                  setLang(code, true)
                  setShowLang(false)
                }}
              >
                {label} {lang === code && '✓'}
              </button>
            ))}
          </div>
        )}
      </div>
    </header>
  )
}

// Keep LangBar as empty/no-op so existing imports don't break
export function LangBar() {
  return null
}

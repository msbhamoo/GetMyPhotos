import { useState } from 'preact/hooks'
import { Header } from '../components/LangBar.jsx'
import { t } from '../i18n.js'
import { navigate } from '../router.js'
import { api, store } from '../api.js'

export function Join({ initialError = null, initialCode = '' }) {
  const [code, setCode] = useState(initialCode)
  const [err, setErr] = useState(initialError)
  const [busy, setBusy] = useState(false)
  const clean = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase()

  const submit = async (e) => {
    e.preventDefault()
    if (clean.length < 4) return
    setErr(null)
    setBusy(true)

    try {
      // Validate event existence before navigating
      const ev = await api(`/public/events/${encodeURIComponent(clean)}`)
      store.set('event:' + clean, ev)
      navigate(`/e/${clean}`)
    } catch (e) {
      if (e.status === 404) {
        setErr('Event not found. Please double-check the 4-digit code.')
      } else {
        setErr(e.message || 'Unable to load event. Please try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <main class="guest-app-container">
      <Header />

      <div class="guest-body-centered">
        {/* Visual Hero Header */}
        <div class="hero-sparkle-badge">
          <span class="sparkle-icon">✨</span>
          <span>AI Instant Face Match</span>
        </div>

        {/* Interactive Join Card */}
        <div class="join-card">
          <div class="join-hero-icon-wrap">
            <span class="join-hero-icon">📸</span>
          </div>

          <h1 class="join-title">Find Your Photos</h1>
          <p class="join-subtitle">Enter your 4-digit Event Code or scan the QR code to find all your pictures instantly</p>

          <form onSubmit={submit} class="join-form">
            <div class="code-input-container">
              <label class="code-input-label">Event Code</label>
              <input
                class={`join-input-code ${err ? 'input-error' : ''}`}
                value={code}
                onInput={(e) => {
                  setCode(e.currentTarget.value)
                  if (err) setErr(null)
                }}
                placeholder="e.g. 4D92"
                autocapitalize="characters"
                autocomplete="off"
                maxLength={12}
                autoFocus
              />
            </div>

            {err && (
              <div class="code-inline-error">
                <span class="error-icon">⚠️</span>
                <span>{err}</span>
              </div>
            )}

            <button type="submit" class="btn primary big cta-pulse" disabled={busy || clean.length < 4}>
              {busy ? 'Verifying Code…' : clean.length < 4 ? 'Enter 4-Character Code' : 'Find My Photos →'}
            </button>
          </form>

          {/* Feature Highlights (3 Simple Steps) */}
          <div class="steps-flow">
            <div class="step-item">
              <div class="step-num">1</div>
              <div class="step-text"><b>Enter Code</b> or scan QR</div>
            </div>
            <div class="step-item">
              <div class="step-num">2</div>
              <div class="step-text"><b>Snap Selfie</b> in 2 seconds</div>
            </div>
            <div class="step-item">
              <div class="step-num">3</div>
              <div class="step-text"><b>Get Photos</b> delivered instantly</div>
            </div>
          </div>
        </div>

        {/* Security & Privacy Guarantee */}
        <div class="trust-badge">
          <span>🔒 100% Private · Selfies are never saved or shared</span>
        </div>
      </div>

      <footer class="guest-foot">
        <a href="/privacy">{t('privacy.link')}</a> · <span>GetMyPhotos AI</span>
      </footer>
    </main>
  )
}

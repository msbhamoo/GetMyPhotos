import { useState } from 'preact/hooks'
import { api, ensureSession } from '../api.js'
import { getLang, t, tErr } from '../i18n.js'
import { navigate } from '../router.js'

/**
 * Offers to save a face code after a successful search — reuses the embedding from
 * this search, so the guest never takes a second selfie.
 */
export function SaveProfile({ code, token, consentVersion, autoOpen }) {
  const [step, setStep] = useState(autoOpen ? 'consent' : 'offer')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const start = async () => {
    const user = await ensureSession()
    if (!user) return navigate(`/me/login?next=${encodeURIComponent(`/e/${code}/photos?save=1`)}`)
    setStep('consent')
  }

  const save = async () => {
    setBusy(true)
    setErr(null)
    try {
      await api(`/public/search/${token}/save-profile`, {
        method: 'POST',
        json: { consent_version: consentVersion, lang: getLang() },
      })
      setStep('done')
    } catch (e) {
      setErr(e)
      setBusy(false)
    }
  }

  if (step === 'done') {
    return (
      <div class="card note-card">
        <p class="ok">✓ {t('profile.saved')}</p>
        <button class="btn ghost" onClick={() => navigate('/me')}>
          {t('me.title')} →
        </button>
      </div>
    )
  }

  if (step === 'consent') {
    return (
      <div class="card note-card">
        <h2>{t('profile.consent_title')}</h2>
        <p class="small">{t('profile.consent_body')}</p>
        {err && <p class="error">{tErr(err)}</p>}
        <button class="btn primary" onClick={save} disabled={busy}>
          {t('profile.agree')}
        </button>
        <button class="link" onClick={() => setStep('offer')}>
          {t('profile.cancel')}
        </button>
      </div>
    )
  }

  return (
    <div class="card note-card">
      <h2>🔔 {t('profile.save_title')}</h2>
      <p class="small">{t('profile.save_body')}</p>
      <button class="btn ghost" onClick={start}>
        {t('profile.save_cta')}
      </button>
    </div>
  )
}

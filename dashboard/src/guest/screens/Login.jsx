import { useEffect, useState } from 'preact/hooks'
import { login, sendOtp } from '../api.js'
import { Header } from '../components/LangBar.jsx'
import { getLang, t, tErr } from '../i18n.js'
import { navigate } from '../router.js'

export function Login({ next }) {
  const [step, setStep] = useState('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [wait, setWait] = useState(0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (wait <= 0) return
    const timer = setTimeout(() => setWait(wait - 1), 1000)
    return () => clearTimeout(timer)
  }, [wait])

  const send = async (channel = 'wa') => {
    setErr(null)
    setBusy(true)
    try {
      const r = await sendOtp(phone, channel, getLang())
      setWait(r.resend_after || 30)
      if (r.dev_code) setCode(r.dev_code)
      setStep('otp')
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(false)
    }
  }

  const verify = async (e) => {
    e.preventDefault()
    setErr(null)
    setBusy(true)
    try {
      await login(phone, code)
      navigate(next || '/me', true)
    } catch (e) {
      setErr(e)
      setBusy(false)
    }
  }

  return (
    <main class="screen">
      <Header />
      <section class="card">
        <h1>{t('login.title')}</h1>
        {step === 'phone' ? (
          <form
            class="stack"
            onSubmit={(e) => {
              e.preventDefault()
              send('wa')
            }}
          >
            <div class="phone">
              <span>+91</span>
              <input
                type="tel"
                inputMode="numeric"
                autocomplete="tel-national"
                maxLength={10}
                value={phone}
                onInput={(e) => setPhone(e.currentTarget.value.replace(/\D/g, ''))}
                placeholder="98765 43210"
                autofocus
              />
            </div>
            {err && <p class="error">{tErr(err)}</p>}
            <button class="btn primary big" disabled={busy || phone.length !== 10}>
              {t('login.send')}
            </button>
          </form>
        ) : (
          <form class="stack" onSubmit={verify}>
            <p class="muted">{t('login.otp_sent', { phone: '+91 ' + phone })}</p>
            <input
              class="input pin otp"
              inputMode="numeric"
              autocomplete="one-time-code"
              maxLength={6}
              value={code}
              onInput={(e) => setCode(e.currentTarget.value.replace(/\D/g, ''))}
              autofocus
            />
            {err && <p class="error">{tErr(err)}</p>}
            <button class="btn primary big" disabled={busy || code.length !== 6}>
              {t('login.verify')}
            </button>
            {wait > 0 ? (
              <p class="muted center">{t('login.resend_in', { s: wait })}</p>
            ) : (
              <div class="row">
                <button type="button" class="btn ghost" onClick={() => send('wa')} disabled={busy}>
                  {t('login.resend_wa')}
                </button>
                <button type="button" class="btn ghost" onClick={() => send('sms')} disabled={busy}>
                  {t('login.resend_sms')}
                </button>
              </div>
            )}
          </form>
        )}
        <p class="privacy">🔒 {t('login.privacy')}</p>
      </section>
    </main>
  )
}

import { useEffect, useState } from 'preact/hooks'
import { api, errorText, login } from '../api.js'

export function Login({ note, embedded = false }) {
  const [step, setStep] = useState('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [via, setVia] = useState(null)
  const [wait, setWait] = useState(0)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  useEffect(() => {
    if (wait <= 0) return
    const t = setTimeout(() => setWait(wait - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])

  const send = async (channel = 'wa') => {
    setErr(null)
    setBusy(true)
    try {
      const r = await api('/auth/otp/send', { method: 'POST', json: { phone, channel, lang: 'en' } })
      setVia(r.sent_via)
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
    } catch (e) {
      setErr(e)
      setBusy(false)
    }
  }

  const content = (
    <div class={embedded ? 'auth-card embedded' : 'auth-card'}>
      {!embedded && <div class="auth-logo">📸</div>}
      {!embedded && <h1>GetMyPhotos</h1>}
      {!embedded && <p class="muted">For photographers and couples. No password needed.</p>}
      {note && <p class="banner amber small">{note}</p>}

        {step === 'phone' ? (
          <form
            class="stack"
            onSubmit={(e) => {
              e.preventDefault()
              send('wa')
            }}
          >
            <label class="field">
              <span>Mobile number</span>
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
            </label>
            {err && <p class="error">{errorText(err)}</p>}
            <button class="btn primary big" disabled={busy || phone.length !== 10}>
              Send OTP on WhatsApp
            </button>
          </form>
        ) : (
          <form class="stack" onSubmit={verify}>
            <p>
              OTP sent on {via === 'sms' ? 'SMS' : via === 'dev' ? 'dev mode' : 'WhatsApp'} to <b>+91 {phone}</b>{' '}
              <button type="button" class="link" onClick={() => setStep('phone')}>
                Change
              </button>
            </p>
            <input
              class="otp"
              inputMode="numeric"
              autocomplete="one-time-code"
              maxLength={6}
              value={code}
              onInput={(e) => setCode(e.currentTarget.value.replace(/\D/g, ''))}
              autofocus
            />
            {err && <p class="error">{errorText(err)}</p>}
            <button class="btn primary big" disabled={busy || code.length !== 6}>
              Log in
            </button>
            {wait > 0 ? (
              <p class="muted small center">You can resend in {wait}s</p>
            ) : (
              <div class="row">
                <button type="button" class="btn ghost" onClick={() => send('wa')} disabled={busy}>
                  Resend on WhatsApp
                </button>
                <button type="button" class="btn ghost" onClick={() => send('sms')} disabled={busy}>
                  Send by SMS
                </button>
              </div>
            )}
          </form>
        )}
      </div>
    )

  if (embedded) return content
  return <div class="auth">{content}</div>
}

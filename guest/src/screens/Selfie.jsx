import { useEffect, useRef, useState } from 'preact/hooks'
import { api, ensureSession } from '../api.js'
import { getLang, t, tErr } from '../i18n.js'
import { toJpeg } from '../image.js'
import { navigate } from '../router.js'
import { deviceId, store } from '../store.js'

// mode: starting | live | fallback | preview | searching
export function Selfie({ code, profile = false }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const fileRef = useRef(null)
  const [mode, setMode] = useState('starting')
  const [shot, setShot] = useState(null) // { blob, url }
  const [err, setErr] = useState(null)
  const [consent, setConsent] = useState(profile ? null : store.get('consent:' + code))

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((tr) => tr.stop())
    streamRef.current = null
  }

  const startCamera = async () => {
    setErr(null)
    if (!navigator.mediaDevices?.getUserMedia) return setMode('fallback')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      })
      streamRef.current = stream
      const v = videoRef.current
      v.srcObject = stream
      await v.play()
      setMode('live')
    } catch {
      setMode('fallback')
    }
  }

  useEffect(() => {
    if (profile) {
      ensureSession().then(async (user) => {
        if (!user) return navigate('/me/login?next=/me/selfie', true)
        const p = await api('/guest/profile').catch(() => null)
        setConsent(p?.consent_version || null)
        startCamera()
      })
    } else if (!consent) {
      navigate(`/e/${code}`, true)
    } else {
      startCamera()
    }
    return stopCamera
  }, [])

  const capture = async () => {
    const blob = await toJpeg(videoRef.current)
    stopCamera()
    setShot({ blob, url: URL.createObjectURL(blob) })
    setMode('preview')
  }

  const onFile = async (e) => {
    const file = e.currentTarget.files?.[0]
    if (!file) return
    const blob = await toJpeg(file)
    setShot({ blob, url: URL.createObjectURL(blob) })
    setMode('preview')
  }

  const retake = () => {
    if (shot) URL.revokeObjectURL(shot.url)
    setShot(null)
    setMode('starting')
    startCamera()
  }

  const submit = async () => {
    setMode('searching')
    setErr(null)
    const form = new FormData()
    form.append('selfie', shot.blob, 'selfie.jpg')
    form.append('consent_version', consent)
    form.append('lang', getLang())
    try {
      if (profile) {
        await api('/guest/face', { method: 'POST', form })
        URL.revokeObjectURL(shot.url)
        return navigate('/me', true)
      }
      form.append('device_id', deviceId())
      const access = store.get('access:' + code)
      const res = await api(`/public/events/${code}/search`, {
        method: 'POST',
        form,
        headers: access ? { 'X-Event-Access': access } : {},
      })
      URL.revokeObjectURL(shot.url)
      store.set('results:' + code, { ...res, at: Date.now() })
      navigate(`/e/${code}/photos`, true)
    } catch (e) {
      if (e.code === 'PIN_REQUIRED') {
        store.set('access:' + code, null)
        return navigate(`/e/${code}`, true)
      }
      setErr(e)
      setMode('preview')
    }
  }

  return (
    <main class="screen dark">
      <header class="top light">
        <button class="link light" onClick={() => navigate(profile ? '/me' : `/e/${code}`)}>
          ←
        </button>
        <span class="brand">{profile ? t('me.set_face') : t('selfie.title')}</span>
        <span />
      </header>

      <div class="camera">
        <video
          ref={videoRef}
          playsInline
          muted
          class={mode === 'live' || mode === 'starting' ? 'mirror' : 'hidden'}
        />
        {shot && (mode === 'preview' || mode === 'searching') && <img src={shot.url} alt="" />}
        {(mode === 'live' || mode === 'starting') && <div class="oval" />}
        {mode === 'fallback' && (
          <div class="center light">
            <div class="hero-icon">🤳</div>
            <p>{t('selfie.camera_blocked')}</p>
          </div>
        )}
        {mode === 'searching' && (
          <div class="searching">
            <div class="spinner" />
            <p>{t('selfie.searching')}</p>
          </div>
        )}
      </div>

      <div class="camera-bar">
        {err && <p class="error light">{tErr(err)}</p>}
        {mode !== 'preview' && mode !== 'searching' && <p class="hint">{t('selfie.hint')}</p>}

        {mode === 'live' && (
          <button class="shutter" onClick={capture} aria-label={t('selfie.capture')}>
            <span />
          </button>
        )}
        {mode === 'fallback' && (
          <>
            <input ref={fileRef} type="file" accept="image/*" capture="user" class="hidden" onChange={onFile} />
            <button class="btn primary big" onClick={() => fileRef.current.click()}>
              📷 {t('selfie.open_camera')}
            </button>
          </>
        )}
        {mode === 'preview' && (
          <div class="row">
            <button class="btn ghost light" onClick={retake}>
              {t('selfie.retake')}
            </button>
            <button class="btn primary" onClick={submit} disabled={!consent}>
              {(profile ? t('profile.agree') : t('selfie.use')) + ' →'}
            </button>
          </div>
        )}
        {profile && mode === 'preview' && <p class="hint small">{t('profile.consent_body')}</p>}
      </div>
    </main>
  )
}

import { Header, LangBar } from '../components/LangBar.jsx'
import { t } from '../i18n.js'

export function Privacy() {
  return (
    <main class="screen">
      <Header />
      <LangBar />
      <section class="card prose">
        <h1>🔒 {t('privacy.title')}</h1>
        {['p1', 'p2', 'p3', 'p4'].map((k) => (
          <p key={k}>{t('privacy.' + k)}</p>
        ))}
        <button class="btn ghost" onClick={() => history.back()}>
          ← {t('photos.close')}
        </button>
      </section>
    </main>
  )
}

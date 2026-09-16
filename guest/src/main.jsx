import { render } from 'preact'
import { App } from './app.jsx'
import { initialLang, setLang } from './i18n.js'
import './styles.css'

setLang(initialLang()).finally(() => render(<App />, document.getElementById('app')))

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}

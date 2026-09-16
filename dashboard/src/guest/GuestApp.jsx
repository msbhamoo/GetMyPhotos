import { useLocation } from '../router.js'
import { useLang } from './i18n.js'
import { Join } from './screens/Join.jsx'
import { Welcome } from './screens/Welcome.jsx'
import { Selfie } from './screens/Selfie.jsx'
import { Photos } from './screens/Photos.jsx'
import { Privacy } from './screens/Privacy.jsx'
import { Login } from './screens/Login.jsx'
import { MyEvents } from './screens/MyEvents.jsx'
import { ProfileGallery } from './screens/ProfileGallery.jsx'
import { SharedGallery } from './screens/SharedGallery.jsx'
import './styles.css'

const CODE = '([A-Za-z0-9]{4,12})'

export function GuestApp() {
  const { path, query } = useLocation()
  useLang() // re-render on language change
  let m

  if ((m = path.match(new RegExp(`^/e/${CODE}/selfie/?$`)))) return <Selfie code={m[1].toUpperCase()} />
  if ((m = path.match(new RegExp(`^/e/${CODE}/photos/?$`))))
    return <Photos code={m[1].toUpperCase()} save={query.get('save') === '1'} />
  if ((m = path.match(new RegExp(`^/e/${CODE}/?$`)))) return <Welcome code={m[1].toUpperCase()} />

  if (path === '/me') return <MyEvents />
  if (path === '/me/login') return <Login next={query.get('next')} />
  if (path === '/me/selfie') return <Selfie profile />
  if ((m = path.match(/^\/me\/e\/([0-9a-f-]{36})\/?$/))) return <ProfileGallery id={m[1]} />
  if ((m = path.match(/^\/g\/([A-Za-z0-9_-]{10,})\/?$/))) return <SharedGallery gid={m[1]} />

  if (path === '/privacy') return <Privacy />
  return <Join />
}

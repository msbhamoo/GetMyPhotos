import { useEffect, useState } from 'preact/hooks'
import { logout, refresh, session } from './api.js'
import { navigate, useLocation } from './router.js'
import { Login } from './screens/Login.jsx'
import { Events } from './screens/Events.jsx'
import { NewEvent } from './screens/NewEvent.jsx'
import { EventPage } from './screens/EventPage.jsx'
import { Billing } from './screens/Billing.jsx'
import { InviteAccept } from './screens/InviteAccept.jsx'

import { LandingPage } from './screens/LandingPage.jsx'

function NavLink({ to, children }) {
  return (
    <a
      href={to}
      onClick={(e) => {
        e.preventDefault()
        navigate(to)
      }}
    >
      {children}
    </a>
  )
}

export function App() {
  const [ready, setReady] = useState(false)
  const [user, setUser] = useState(null)
  const { path, query } = useLocation()

  useEffect(() => {
    const off = session.subscribe(setUser)
    refresh().finally(() => setReady(true))
    return off
  }, [])

  if (!ready) return <div class="boot">GetMyPhotos</div>

  const invite = path.match(/^\/invite\/([A-Za-z0-9_-]{20,})\/?$/)
  // When logged out, render the rich Landing Page featuring both Guest and Organizer portals
  if (!user) return <LandingPage />

  let m
  let page
  if (invite) page = <InviteAccept token={invite[1]} />
  else if (path === '/new') page = <NewEvent />
  else if (path === '/billing') page = <Billing />
  else if ((m = path.match(/^\/events\/([0-9a-f-]{36})\/?$/))) page = <EventPage id={m[1]} tab={query.get('tab')} />
  else page = <Events />

  return (
    <div class="layout">
      <header class="nav">
        <NavLink to="/">
          <span class="brand">📸 GetMyPhotos</span>
        </NavLink>
        <div class="nav-right">
          <NavLink to="/billing">💳 Plans</NavLink>
          <span class="muted small hide-sm">{user.name || user.phone}</span>
          <button class="link" onClick={logout}>
            Logout
          </button>
        </div>
      </header>
      <main class="content">{page}</main>
    </div>
  )
}

import { useEffect, useState } from 'preact/hooks'

export function navigate(to, replace = false) {
  history[replace ? 'replaceState' : 'pushState'](null, '', to)
  dispatchEvent(new PopStateEvent('popstate'))
  scrollTo(0, 0)
}

export function useLocation() {
  const read = () => ({ path: location.pathname, query: new URLSearchParams(location.search) })
  const [loc, setLoc] = useState(read)
  useEffect(() => {
    const onPop = () => setLoc(read())
    addEventListener('popstate', onPop)
    return () => removeEventListener('popstate', onPop)
  }, [])
  return loc
}

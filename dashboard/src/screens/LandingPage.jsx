import { useState } from 'preact/hooks'
import { Login } from './Login.jsx'
import { navigate } from '../router.js'

export function LandingPage({ onLoggedIn }) {
  const [role, setRole] = useState('both') // 'both' | 'organizer' | 'guest'
  const [guestCode, setGuestCode] = useState('')

  const handleGuestSubmit = (e) => {
    e.preventDefault()
    const clean = guestCode.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
    if (clean.length >= 4) {
      navigate(`/e/${clean}`)
    }
  }

  return (
    <div class="landing-page">
      {/* Top Navbar */}
      <header class="landing-header">
        <div class="landing-nav-inner">
          <div class="landing-brand">
            <span class="brand-logo">📸</span>
            <span class="brand-name">GetMyPhotos</span>
          </div>

          <div class="landing-nav-actions">
            <button
              class={`nav-role-pill ${role === 'guest' ? 'active' : ''}`}
              onClick={() => setRole(role === 'guest' ? 'both' : 'guest')}
            >
              🙋 I'm a Guest
            </button>
            <button
              class={`nav-role-pill ${role === 'organizer' ? 'active' : ''}`}
              onClick={() => setRole(role === 'organizer' ? 'both' : 'organizer')}
            >
              👑 Organizer / Host
            </button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section class="landing-hero">
        <div class="hero-badge">
          <span>✨ AI-Powered Event Photography</span>
        </div>
        <h1 class="hero-headline">
          Every Guest Finds Their Photos <span class="highlight">In Seconds</span>
        </h1>
        <p class="hero-subheadline">
          Upload thousands of event photos once. Guests take a single selfie and AI matches every picture they appear in instantly.
        </p>

        {/* Dual Portal Container */}
        <div class="portals-grid">
          {/* Guest Portal Card */}
          {(role === 'both' || role === 'guest') && (
            <div class="portal-card guest-portal">
              <div class="portal-header">
                <div class="portal-tag guest">For Guests & Attendees</div>
                <h2>Find Your Event Photos</h2>
                <p>Have an event QR code or 4-digit code? Jump straight to your pictures.</p>
              </div>

              <form onSubmit={handleGuestSubmit} class="portal-form">
                <div class="guest-code-field">
                  <span class="field-icon">🔑</span>
                  <input
                    class="portal-input"
                    placeholder="Enter 4-digit code (e.g. 4D92)"
                    value={guestCode}
                    onInput={(e) => setGuestCode(e.currentTarget.value)}
                    maxLength={10}
                  />
                </div>

                <button
                  type="submit"
                  class="btn guest-btn big"
                  disabled={guestCode.replace(/[^A-Za-z0-9]/g, '').length < 4}
                >
                  Find My Photos →
                </button>
              </form>

              <div class="guest-perks">
                <div class="perk-item">🤳 1 Quick Selfie</div>
                <div class="perk-item">⚡ Instant AI Search</div>
                <div class="perk-item">🔒 100% Private</div>
              </div>
            </div>
          )}

          {/* Organizer / Host Portal Card */}
          {(role === 'both' || role === 'organizer') && (
            <div class="portal-card organizer-portal">
              <div class="portal-header">
                <div class="portal-tag organizer">For Photographers & Hosts</div>
                <h2>Organizer Studio</h2>
                <p>Host events, upload high-res galleries, generate QR cards, and manage AI indexing.</p>
              </div>

              <div class="organizer-login-wrapper">
                <Login embedded={true} />
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Feature Grid */}
      <section class="landing-features">
        <div class="feature-card">
          <div class="feature-icon">⚡</div>
          <h3>Lightning-Fast AI Search</h3>
          <p>Scans facial geometry using high-accuracy neural models in under 100ms per search.</p>
        </div>

        <div class="feature-card">
          <div class="feature-icon">📲</div>
          <h3>Instant WhatsApp Sharing</h3>
          <p>Guests receive high-resolution download packages directly into their WhatsApp chat.</p>
        </div>

        <div class="feature-card">
          <div class="feature-icon">🛡</div>
          <h3>Private & Zero-Install</h3>
          <p>No app download required. Works smoothly on every mobile browser with zero sign-up friction.</p>
        </div>
      </section>

      {/* Footer */}
      <footer class="landing-footer">
        <p>© GetMyPhotos · Private & Secure AI Photo Sharing</p>
      </footer>
    </div>
  )
}

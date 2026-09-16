const APP = process.env.NEXT_PUBLIC_DASHBOARD_URL || 'https://app.getmyphotos.in'
const DEMO = process.env.NEXT_PUBLIC_DEMO_EVENT_URL || 'https://getmyphotos.in/e/DEMO123'
const SUPPORT_WA = process.env.NEXT_PUBLIC_SUPPORT_WHATSAPP || '919999999999'
const waLink = `https://wa.me/${SUPPORT_WA}?text=${encodeURIComponent('Hi! I have a question about GetMyPhotos')}`

const STEPS = [
  { ico: '📷', title: 'Scan the QR code', body: 'Every guest scans the QR card on the table. The page opens in the browser — no app to install.' },
  { ico: '🤳', title: 'Take a selfie', body: 'One tap, one selfie. It is used only to find your face, then deleted straight away.' },
  { ico: '🖼️', title: 'Get your photos', body: 'Every photo of you from the event, ready to download or receive on WhatsApp.' },
]

const VALUES = [
  { ico: '🔒', title: 'Selfie deleted instantly', body: 'We keep no selfie. Face data from one event is never shared with another event.' },
  { ico: '🚫', title: 'No app, no password', body: 'Works in any phone browser. Nothing to download, nothing to remember.' },
  { ico: '📱', title: 'Works on any phone', body: 'Built for budget Android phones and weak networks. The guest page is under 50 KB.' },
  { ico: '💬', title: 'Delivered on WhatsApp', body: 'Guests get their gallery link — or the photos themselves — right in WhatsApp.' },
]

const FAQS = [
  {
    q: 'Is my selfie safe?',
    a: 'Yes. Your selfie is never saved. It is processed in memory to find your face, then discarded immediately. Face data from one event is never used in any other event, and you can tap “Not me” on any photo that is not you.',
  },
  {
    q: "What if it doesn't find my photos?",
    a: 'Take the selfie again in better light, facing the camera. If photos are still missing, the photographer may still be uploading — come back a little later. Event hosts can also loosen the matching from their dashboard.',
  },
  {
    q: 'Do I need to download an app?',
    a: 'No. GetMyPhotos runs entirely in your phone browser. There is no app store, no sign-up and no password for guests.',
  },
  {
    q: 'Will it work on my phone?',
    a: 'If your phone can open a website and take a selfie, it works. The guest page is built for budget Android phones on slow networks, and if the camera is blocked it falls back to your normal camera app.',
  },
  {
    q: 'How do I pay?',
    a: 'Any UPI app — GPay, PhonePe, Paytm — or a card, through Razorpay. Hosts pay once per event; photographers can take an annual plan. Guests never pay anything.',
  },
  {
    q: 'How long are the photos kept?',
    a: 'Free events keep photos for 7 days. An Event Pass keeps them 90 days (extendable to a full year), and annual-plan events keep each event for a year. After that, photos and face data are deleted automatically.',
  },
]

export default function Home() {
  return (
    <>
      <header className="header">
        <div className="wrap">
          <a className="brand" href="#top">📸 GetMyPhotos</a>
          <nav>
            <a className="hide-sm" href="#how">How it works</a>
            <a className="hide-sm" href="#pricing">Pricing</a>
            <a className="btn ghost small" href={APP}>Log in</a>
          </nav>
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="wrap">
            <div className="stack">
              <p className="eyebrow">For weddings &amp; anniversaries</p>
              <h1>
                Scan. Selfie. <span>Every photo of you.</span>
              </h1>
              <p className="lead">
                Guests find every photo of themselves from your event in under 60 seconds — no app, no
                sign-up, no scrolling through 3,000 photos.
              </p>
              <div className="hero-ctas">
                <a className="btn primary" href={`${APP}/new`}>Start free — no app needed</a>
                <a className="btn ghost" href={DEMO}>Try the demo</a>
              </div>
              <div className="hero-points">
                <span>Free for 500 photos</span>
                <span>Selfie deleted instantly</span>
                <span>Pay by UPI</span>
              </div>
            </div>
            <PhoneDemo />
          </div>
        </section>

        <section className="section tint" id="how">
          <div className="wrap stack">
            <div className="center stack">
              <h2>How it works</h2>
              <p className="lead">Three screens. That is the whole thing.</p>
            </div>
            <div className="steps">
              {STEPS.map((s, i) => (
                <div className="step" key={s.title}>
                  <div className="ico">{s.ico}</div>
                  <h3>
                    {i + 1}. {s.title}
                  </h3>
                  <p className="muted">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="section">
          <div className="wrap stack">
            <div className="center stack">
              <h2>Why couples love it</h2>
              <p className="lead">The questions guests ask, answered before they ask them.</p>
            </div>
            <div className="cards">
              {VALUES.map((v) => (
                <div className="card" key={v.title}>
                  <div className="ico">{v.ico}</div>
                  <h3>{v.title}</h3>
                  <p className="muted">{v.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="section tint">
          <div className="wrap split">
            <div>
              <h2>💍 For couples &amp; families</h2>
              <ul>
                <li>Create the event, share one QR card at the venue.</li>
                <li>Every guest gets only their own photos — no endless group albums.</li>
                <li>Invite your photographer to upload; you stay in control.</li>
                <li>Optional PIN so only your guests can search.</li>
              </ul>
              <a className="btn primary block" href={`${APP}/new`}>Create a free event</a>
            </div>
            <div>
              <h2>📷 For photographers</h2>
              <ul>
                <li>Bulk upload thousands of photos — the queue survives a dropped connection.</li>
                <li>Photos are compressed on your device, so uploads use less data.</li>
                <li>Your studio name on every QR card you hand out.</li>
                <li>One annual plan covers a whole season of events.</li>
              </ul>
              <a className="btn ghost block" href={`${APP}/billing`}>See annual plans</a>
            </div>
          </div>
        </section>

        <section className="section" id="pricing">
          <div className="wrap stack">
            <div className="center stack">
              <h2>Simple, honest pricing</h2>
              <p className="lead">Guests never pay. Hosts pay once per event; photographers can pay yearly.</p>
            </div>
            <div className="plans">
              <div className="plan">
                <h3>Free</h3>
                <p className="price">₹0</p>
                <ul>
                  <li>1 event, up to 500 photos</li>
                  <li>Photos kept 7 days</li>
                  <li>QR code, PIN and selfie search</li>
                </ul>
                <a className="btn ghost" href={`${APP}/new`}>Start free</a>
              </div>
              <div className="plan featured">
                <span className="ribbon">Most popular</span>
                <h3>Event Pass</h3>
                <p className="price">
                  ₹499 – ₹999 <small>/ event</small>
                </p>
                <ul>
                  <li>3,000 – 10,000 photos</li>
                  <li>Photos kept 90 days (1 year for ₹199 more)</li>
                  <li>Photos delivered on WhatsApp</li>
                  <li>Original quality downloads</li>
                </ul>
                <a className="btn primary" href={`${APP}/new`}>Get an Event Pass</a>
              </div>
              <div className="plan">
                <h3>Photographer Annual</h3>
                <p className="price">
                  ₹2,999 – ₹4,999 <small>/ year</small>
                </p>
                <ul>
                  <li>25 – 75 events a year</li>
                  <li>Up to 10,000 photos per event</li>
                  <li>Each event kept a full year</li>
                  <li>Your studio branding</li>
                </ul>
                <a className="btn ghost" href={`${APP}/billing`}>See annual plans</a>
              </div>
            </div>
            <div className="center">
              <span className="guarantee">🛡️ 7-day money-back guarantee · Pay by UPI</span>
            </div>
          </div>
        </section>

        <section className="section tint">
          <div className="wrap stack">
            <h2 className="center">Questions people ask</h2>
            <div className="faq">
              {FAQS.map((f, i) => (
                <details key={f.q} open={i === 0}>
                  <summary>{f.q}</summary>
                  <p>{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section className="section">
          <div className="wrap">
            <div className="final">
              <h2>Ready in two minutes</h2>
              <p>Create your event, print the QR card, and let your guests find themselves.</p>
              <a className="btn primary" href={`${APP}/new`}>Start free — no app needed</a>
              <p>No card needed for the free plan.</p>
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap">
          <span>© {new Date().getFullYear()} GetMyPhotos</span>
          <span>
            <a href="/privacy/">Privacy</a> · <a href="/terms/">Terms</a> · <a href={waLink}>Support on WhatsApp</a>
          </span>
        </div>
      </footer>

      <a className="wa-fab" href={waLink} aria-label="Chat with us on WhatsApp">
        💬 Chat with us
      </a>
    </>
  )
}

/** Three phone screens showing the actual flow — inline SVG/CSS, no video download. */
function PhoneDemo() {
  return (
    <div className="demo" aria-hidden="true">
      <div>
        <div className="phone">
          <div className="phone-screen">
            <svg className="qr-mini" viewBox="0 0 24 24" role="img">
              <rect width="24" height="24" fill="#fff" />
              <path
                fill="#2b1a12"
                d="M2 2h7v7H2V2Zm2 2v3h3V4H4Zm11-2h7v7h-7V2Zm2 2v3h3V4h-3ZM2 15h7v7H2v-7Zm2 2v3h3v-3H4Zm9-2h2v2h-2v-2Zm4 0h2v2h-2v-2Zm2 2h2v2h-2v-2Zm-6 2h2v2h-2v-2Zm4 0h2v2h-2v-2Zm2 2h2v2h-2v-2Zm-6 0h2v2h-2v-2ZM11 2h2v4h-2V2Zm0 6h2v2h-2V8ZM2 11h4v2H2v-2Zm6 0h4v2H8v-2Zm6 0h8v2h-8v-2Z"
              />
            </svg>
          </div>
        </div>
        <p className="phone-cap">
          <b>STEP 1</b>Scan
        </p>
      </div>
      <div>
        <div className="phone">
          <div className="phone-screen" style={{ background: '#111' }}>
            <div className="face-ring">🙂</div>
          </div>
        </div>
        <p className="phone-cap">
          <b>STEP 2</b>Selfie
        </p>
      </div>
      <div>
        <div className="phone">
          <div className="phone-screen" style={{ justifyContent: 'flex-start', paddingTop: 14 }}>
            <div className="mini-grid">
              {Array.from({ length: 9 }, (_, i) => (
                <i key={i} />
              ))}
            </div>
          </div>
        </div>
        <p className="phone-cap">
          <b>STEP 3</b>Your photos
        </p>
      </div>
    </div>
  )
}

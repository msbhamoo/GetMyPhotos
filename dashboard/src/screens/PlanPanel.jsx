import { useEffect, useState } from 'preact/hooks'
import { api, errorText } from '../api.js'
import { checkout, getPlans, rupees } from '../billing.js'
import { navigate } from '../router.js'

const PASS_FEATURES = {
  pass_499: ['3,000 photos', 'Photos kept 90 days', 'Photos on WhatsApp', 'Original quality download', '3 photographers'],
  pass_999: ['10,000 photos', 'Photos kept 90 days', 'Photos on WhatsApp', 'Original quality download', '5 photographers'],
}

export function PlanPanel({ ev, onChanged }) {
  const [plans, setPlans] = useState(null)
  const [billing, setBilling] = useState(null)
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)
  const isOwner = ev.role === 'owner'

  useEffect(() => {
    getPlans().then(setPlans).catch((e) => setMsg({ err: e }))
    api('/billing/me').then(setBilling).catch(() => {})
  }, [])

  const run = async (key, fn, success) => {
    setBusy(key)
    setMsg(null)
    try {
      await fn()
      setMsg({ ok: success })
      onChanged()
    } catch (e) {
      setMsg({ err: e })
    } finally {
      setBusy(null)
    }
  }

  if (!plans) return msg?.err ? <p class="error">{errorText(msg.err)}</p> : <p class="muted">Loading…</p>

  const passes = plans.plans.filter((p) => p.kind === 'pass')
  const current = plans.plans.find((p) => p.code === ev.plan.code) || ev.plan
  const sub = billing?.subscription
  const expiry = ev.expires_at ? new Date(ev.expires_at).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : null

  return (
    <div class="stack">
      <div class="panel current-plan">
        <div>
          <p class="muted small">Current plan</p>
          <h2>{planName(current)}</h2>
          <p class="muted small">
            {ev.limits.max_photos.toLocaleString('en-IN')} photos ·{' '}
            {expiry ? `Photos kept until ${expiry}` : `${ev.limits.retention_days} days after going live`}
            {ev.extended && ' · 1-year extension ✓'}
          </p>
        </div>
        {current.kind !== 'free' && <span class="badge green">Paid ✓</span>}
      </div>

      {msg?.ok && <p class="banner green">{msg.ok}</p>}
      {msg?.err && <p class="error">{errorText(msg.err)}</p>}
      {!isOwner && <p class="muted">Only the event owner can change the plan.</p>}

      {isOwner && current.kind === 'free' && sub && (
        <div class="panel stack">
          <h2>Your annual plan is active 🎉</h2>
          <p class="muted small">
            {sub.events_used}/{sub.max_events} events used · valid until{' '}
            {new Date(sub.ends_at).toLocaleDateString('en-IN')}
          </p>
          <button
            class="btn primary"
            disabled={busy}
            onClick={() =>
              run('attach', () => api(`/events/${ev.id}/attach-subscription`, { method: 'POST' }), 'Event moved to your annual plan ✓')
            }
          >
            Use my annual plan for this event
          </button>
        </div>
      )}

      {isOwner && (current.kind === 'free' || current.code === 'pass_499') && (
        <>
          <h2>Get an Event Pass — one-time payment</h2>
          <div class="plans">
            {passes
              .filter((p) => p.price_paise > current.price_paise)
              .map((p) => {
                const diff = current.kind === 'pass' ? p.price_paise - current.price_paise : p.price_paise
                return (
                  <div key={p.code} class={p.code === 'pass_999' ? 'plan-card featured' : 'plan-card'}>
                    {p.code === 'pass_999' && <span class="ribbon">For big weddings</span>}
                    <h3>{planName(p)}</h3>
                    <p class="price">
                      {rupees(diff)}
                      {diff !== p.price_paise && <small> (difference only)</small>}
                    </p>
                    <ul>
                      {(PASS_FEATURES[p.code] || []).map((f) => (
                        <li key={f}>✓ {f}</li>
                      ))}
                    </ul>
                    <button
                      class="btn primary"
                      disabled={busy}
                      onClick={() =>
                        run(p.code, () => checkout({ purpose: 'pass', plan_code: p.code, event_id: ev.id }), 'Payment done! Your event is upgraded 🎉')
                      }
                    >
                      {busy === p.code ? 'Payment in progress…' : `Pay ${rupees(diff)} by UPI`}
                    </button>
                  </div>
                )
              })}
          </div>
          <p class="muted small">
            🔒 Secure payment by Razorpay · GPay, PhonePe, Paytm, card · 7-day money-back guarantee
          </p>
        </>
      )}

      {isOwner && current.kind === 'pass' && !ev.extended && (
        <div class="panel stack">
          <h2>Keep photos for a full year</h2>
          <p class="muted small">Let guests find their photos well past 90 days — for a whole year.</p>
          <button
            class="btn primary"
            disabled={busy}
            onClick={() => run('extend', () => checkout({ purpose: 'extend', event_id: ev.id }), 'Extended to 1 year ✓')}
          >
            {busy === 'extend' ? 'Payment in progress…' : `Extend to 1 year for ${rupees(plans.extend.price_paise)}`}
          </button>
        </div>
      )}

      {isOwner && current.kind === 'free' && !sub && (
        <div class="panel photographer-cta">
          <div>
            <h2>📷 Are you a photographer?</h2>
            <p class="muted small">An annual plan covers a year of events, your own logo and 10,000 photos per event.</p>
          </div>
          <button class="btn ghost" onClick={() => navigate('/billing')}>
            See annual plans
          </button>
        </div>
      )}
    </div>
  )
}

export function planName(p) {
  return (
    {
      free: 'Free',
      pass_499: 'Event Pass',
      pass_999: 'Event Pass Plus',
      annual_2999: 'Photographer Annual',
      annual_4999: 'Photographer Annual Pro',
    }[p.code] || p.code
  )
}

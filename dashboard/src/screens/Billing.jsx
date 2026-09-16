import { useEffect, useState } from 'preact/hooks'
import { api, errorText } from '../api.js'
import { checkout, getPlans, rupees } from '../billing.js'
import { planName } from './PlanPanel.jsx'

const ANNUAL_FEATURES = {
  annual_2999: ['25 events / year', '5,000 photos per event', 'Each event kept 1 year', 'Your studio logo', '5 assistant photographers'],
  annual_4999: ['75 events / year', '10,000 photos per event', 'Each event kept 1 year', 'Your studio logo', '10 assistant photographers'],
}

const PURPOSE = { pass: 'Event Pass', annual: 'Annual plan', extend: '1-year extension' }
const STATUS = { paid: ['Paid', 'green'], refunded: ['Refund', 'amber'], failed: ['Failed', 'red'] }

export function Billing() {
  const [plans, setPlans] = useState(null)
  const [data, setData] = useState(null)
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)

  const load = () => api('/billing/me').then(setData).catch((e) => setMsg({ err: e }))
  useEffect(() => {
    getPlans().then(setPlans).catch((e) => setMsg({ err: e }))
    load()
  }, [])

  const buy = async (code) => {
    setBusy(code)
    setMsg(null)
    try {
      await checkout({ purpose: 'annual', plan_code: code })
      setMsg({ ok: 'Payment done! Your annual plan is active 🎉 New events will use it automatically.' })
      load()
    } catch (e) {
      setMsg({ err: e })
    } finally {
      setBusy(null)
    }
  }

  if (!plans || !data) return msg?.err ? <p class="error">{errorText(msg.err)}</p> : <p class="muted">Loading…</p>
  const sub = data.subscription
  const annuals = plans.plans.filter((p) => p.kind === 'annual')

  return (
    <div class="stack">
      <h1>Plan and payments</h1>
      {msg?.ok && <p class="banner green">{msg.ok}</p>}
      {msg?.err && <p class="error">{errorText(msg.err)}</p>}

      {sub ? (
        <div class="panel current-plan">
          <div>
            <p class="muted small">Active plan</p>
            <h2>{planName(sub)}</h2>
            <p class="muted small">
              {sub.events_used}/{sub.max_events} events used · valid until{' '}
              {new Date(sub.ends_at).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
            </p>
          </div>
          <span class="badge green">Active ✓</span>
        </div>
      ) : (
        <p class="muted">No annual plan yet. You can also buy a one-off Event Pass from any event's “Plan” tab.</p>
      )}

      <h2>{sub ? 'Renew or upgrade your plan' : 'Photographer annual plans'}</h2>
      <div class="plans">
        {annuals.map((p) => (
          <div key={p.code} class={p.code === 'annual_4999' ? 'plan-card featured' : 'plan-card'}>
            {p.code === 'annual_4999' && <span class="ribbon">Most popular</span>}
            <h3>{planName(p)}</h3>
            <p class="price">
              {rupees(p.price_paise)}
              <small> / year</small>
            </p>
            <p class="muted small">Just {rupees(Math.round(p.price_paise / p.max_events))} per event</p>
            <ul>
              {(ANNUAL_FEATURES[p.code] || []).map((f) => (
                <li key={f}>✓ {f}</li>
              ))}
            </ul>
            <button class="btn primary" disabled={busy} onClick={() => buy(p.code)}>
              {busy === p.code ? 'Payment in progress…' : `Pay ${rupees(p.price_paise)} by UPI`}
            </button>
          </div>
        ))}
      </div>
      <p class="muted small">🔒 Secure payment by Razorpay · GST invoice by email/WhatsApp · 7-day money-back guarantee</p>

      {data.payments.length > 0 && (
        <div class="panel">
          <h2>Payment history</h2>
          <table class="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>What</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.payments.map((p) => {
                const [label, tone] = STATUS[p.status] || [p.status, 'gray']
                return (
                  <tr key={p.id}>
                    <td>{new Date(p.paid_at || p.created_at).toLocaleDateString('en-IN')}</td>
                    <td>
                      {PURPOSE[p.purpose]}
                      {p.event_title && <span class="muted small"> · {p.event_title}</span>}
                    </td>
                    <td>{rupees(p.amount_paise)}</td>
                    <td>
                      <span class={`badge ${tone}`}>{label}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

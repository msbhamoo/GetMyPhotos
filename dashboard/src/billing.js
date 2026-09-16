import { api } from './api.js'

let scriptPromise = null

function loadCheckout() {
  scriptPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://checkout.razorpay.com/v1/checkout.js'
    s.onload = () => resolve(window.Razorpay)
    s.onerror = () => {
      scriptPromise = null
      reject(Object.assign(new Error('CHECKOUT_LOAD'), { code: 'OFFLINE' }))
    }
    document.head.appendChild(s)
  })
  return scriptPromise
}

export const rupees = (paise) => '₹' + (paise / 100).toLocaleString('en-IN')

let plansCache = null
export function getPlans() {
  plansCache ||= api('/billing/plans').catch((e) => {
    plansCache = null
    throw e
  })
  return plansCache
}

/** Create an order and open Razorpay Checkout with UPI first. Resolves after the server confirms payment. */
export async function checkout({ purpose, plan_code = null, event_id = null }) {
  const order = await api('/billing/orders', { method: 'POST', json: { purpose, plan_code, event_id } })
  const verify = (resp) => api('/billing/verify', { method: 'POST', json: resp })

  if (order.dev) {
    // Local development without Razorpay keys: simulate a successful payment
    return verify({
      razorpay_order_id: order.order_id,
      razorpay_payment_id: 'dev_pay_' + Date.now(),
      razorpay_signature: 'dev',
    })
  }

  const Razorpay = await loadCheckout()
  return new Promise((resolve, reject) => {
    const rzp = new Razorpay({
      key: order.key_id,
      order_id: order.order_id,
      amount: order.amount,
      currency: 'INR',
      name: 'GetMyPhotos',
      description: order.description,
      prefill: { contact: order.phone },
      theme: { color: '#8c141e' },
      config: {
        display: {
          blocks: { upi: { name: 'Pay by UPI (GPay, PhonePe, Paytm)', instruments: [{ method: 'upi' }] } },
          sequence: ['block.upi'],
          preferences: { show_default_blocks: true },
        },
      },
      handler: (resp) => verify(resp).then(resolve, reject),
      modal: { ondismiss: () => reject(Object.assign(new Error('DISMISSED'), { code: 'PAYMENT_CANCELLED' })) },
    })
    rzp.open()
  })
}

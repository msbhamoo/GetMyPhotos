# GetMyPhotos

> Scan karo, selfie lo, apni saari photos paao.

Browser-only event photo finder. Full product & technical spec: [docs/SPEC.md](docs/SPEC.md).

## What's built (P1 + P2)

| Folder | What | Stack |
|---|---|---|
| `api/` | REST API + background workers + scheduler | FastAPI, PostgreSQL + pgvector, Redis + RQ, InsightFace (ONNX, CPU) |
| `guest/` | Guest PWA: scan → selfie → photos, profiles, My Events, WhatsApp, shared galleries | Preact + Vite (~15 KB gz JS) |
| `dashboard/` | Owner/photographer dashboard: OTP login, events, offline upload queue, QR card, UPI plans, team invites, reports | Preact + Vite |
| `db/migrations/` | SQL schema, applied on API start by `python -m app.migrate` | |

**P1** — events with code + optional PIN, bulk upload with offline queue, CPU face indexing, three-screen guest flow, "Not me", ZIP download, 7-day free retention.
**P2** — Razorpay UPI (Event Pass, annual plans, 1-year extension), photographer invites and roles, opt-in guest face profiles with My Events and new-photo WhatsApp alerts, WhatsApp delivery (gallery link or up to 10 photos), reports queue.

### Languages

English (default), Hindi and Bengali are live. Marathi, Telugu, Tamil and Gujarati are already translated in `guest/src/locales/` — switch one on by adding it to `LANGS` and the `import.meta.glob` list in `guest/src/i18n.js`, and to `LANGS` in `api/app/core/utils.py`.

## Run locally

Prerequisites: Docker Desktop, Node 20+.

```bash
cp .env.example .env
docker compose up --build        # API :8000, MinIO :9000 (console :9001), Postgres, Redis, workers
```

```bash
cd guest && npm install && npm run dev          # http://localhost:5173
cd dashboard && npm install && npm run dev      # http://localhost:5174
```

1. Open the dashboard, enter any 10-digit mobile number. With `DEV_OTP=true` the OTP is auto-filled (and printed in `api` logs).
2. Create an event → upload photos → wait for "Face scan ho gayi".
3. Share tab → open the guest link → take a selfie → see your photos.
4. Payments: with no Razorpay keys in dev, the Plan tab simulates a successful payment so you can test upgrades.

WhatsApp features degrade gracefully: without `WA_BUSINESS_NUMBER` the guest still gets a `wa.me` share link with their gallery URL; with it configured, guests message the business number and the webhook replies with the link and photos.

API docs (dev only): http://localhost:8000/docs

Run backend unit tests:

```bash
docker compose run --rm api pytest -q
```

### MinIO CORS (local)

Browsers upload directly to storage with presigned URLs. MinIO allows all origins by default. For **Cloudflare R2**, add a bucket CORS rule:

```json
[{
  "AllowedOrigins": ["https://app.getmyphotos.in", "https://getmyphotos.in"],
  "AllowedMethods": ["GET", "PUT"],
  "AllowedHeaders": ["Content-Type"],
  "MaxAgeSeconds": 3600
}]
```

## Production checklist

- `ENV=prod`, `DEV_OTP=false`, strong `JWT_SECRET`
- R2: `S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com`, `S3_PUBLIC_ENDPOINT` same, bucket CORS as above
- `FACE_KEY`: 32 random bytes, base64 — encrypts guest face codes. Losing it makes saved profiles unreadable.
- Meta WhatsApp Cloud API: verified business, approved templates `otp_code` (authentication), `event_invite`, `new_photos` → `WA_TOKEN`, `WA_PHONE_NUMBER_ID`, `WA_BUSINESS_NUMBER`, `WA_VERIFY_TOKEN`, `WA_APP_SECRET`
- Razorpay: KYC done → `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, and a webhook on `payment.captured` + `refund.processed` → `RAZORPAY_WEBHOOK_SECRET`
- MSG91 with DLT-registered OTP template → `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID`
- API cookie is `SameSite=None; Secure` in prod — serve API over HTTPS
- Frontends: build with `VITE_API_URL=https://api.getmyphotos.in/v1` and `VITE_GUEST_URL=https://getmyphotos.in`, deploy `dist/` to Cloudflare Pages with SPA fallback (`/* /index.html 200`)
- ⚠️ **Face model license**: InsightFace pretrained weights are non-commercial. Resolve before charging customers (see SPEC §7.1). The model is isolated in `api/app/face/engine.py`.
- Native-speaker review of `guest/src/locales/*.json`

## Architecture notes

- **Selfies never touch disk or storage.** Processed in memory; only the embedding is kept in Redis for 30 minutes to power "Not me" and ZIP download.
- **Every face search is scoped to one event** (`WHERE event_id = …`), exact scan — no cross-event matching is possible.
- **Uploads:** browser compresses to 1600px WebP + 400px thumb (EXIF/GPS stripped), hashes the original for dedupe, and PUTs straight to storage. Compressed photos are kept in IndexedDB until confirmed, so network drops or reloads don't lose work.
- **Workers** run as `rq.worker.SimpleWorker` so the face model loads once per process. Scale with `docker compose up --scale worker=N`.
- **Retention:** scheduler expires events past `expires_at` (Free = 7 days from going live) and purges photos, faces and files.

## Privacy model (P2)

- A **guest profile** stores only an AES-256-GCM encrypted 512-number face code, never the selfie.
- It is matched **only against events the guest joined** by QR or code, never across all events.
- Saving a profile is a separate, explicit consent (logged in `consent_log`); "Delete my face code" wipes the code and every match.
- Replacing a face code deletes previous automatic matches but keeps the guest's own "Not me" choices.

## Not built yet (P3)

Landing page · admin panel · DPDP export/erasure endpoints · expiry warning messages to owners · GST invoices · dashboard translations (Hinglish/English only today).

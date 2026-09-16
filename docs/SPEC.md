# GetMyPhotos — Technical Specification (v1.0)

> "Scan karo, selfie lo, apni saari photos paao."
> Browser-only event photo finder for Tier 2/3 India. No app, no password.

---

## 1. Product Summary

| Actor | Goal | Entry |
|---|---|---|
| **Owner** (couple or photographer) | Create event, pay, share QR | Dashboard, phone OTP |
| **Uploader** (invited photographer) | Bulk-upload photos to an event | WhatsApp invite link → OTP |
| **Guest** | Find own photos | QR scan or event code (+PIN) |
| **Admin** (founder) | Moderation, reports, refunds | Internal admin panel |

**Guest promise:** 3 screens — Scan → Selfie → Photos. Under 60 seconds.

---

## 2. Final Decisions

- **Buyers:** Couples (Event Pass) and photographers (Event Pass or Annual).
- **Roles per event:** `owner`, `uploader`. Guests are not event members, they "join".
- **Login:** Phone + WhatsApp OTP; SMS OTP fallback after 30s or on WA failure.
- **Languages:** `en`, `hi`, `bn`, `mr`, `te`, `ta`, `gu`.
- **Retention:** Free 7 days · Event Pass 90 days (+₹199 → 365 days) · Annual 365 days per event while subscribed (+30 days grace).
- **Guest access:** QR (`/e/{code}`) or manual event code; optional 4-digit PIN.
- **Guest profile:** Opt-in; stores encrypted face embedding only (never the image); matched only against events the guest joined.
- **WhatsApp delivery:** Gallery link (default) + up to 10 images via guest-initiated service window.
- **Compute:** CPU-first (ONNX Runtime), serverless GPU burst later.

---

## 3. Plans & Limits

| Key | Free | Event Pass S | Event Pass L | Annual S | Annual L |
|---|---|---|---|---|---|
| `plan_code` | `free` | `pass_499` | `pass_999` | `annual_2999` | `annual_4999` |
| Price (₹) | 0 | 499 | 999 | 2,999/yr | 4,999/yr |
| Events | 1 active | 1 | 1 | 25/yr | 75/yr |
| Photos / event | 500 | 3,000 | 10,000 | 5,000 | 10,000 |
| Retention (days) | 7 | 90 | 90 | 365 | 365 |
| Extend to 1 yr | ✗ | +₹199 | +₹199 | n/a | n/a |
| WA images / guest | 0 | 10 | 10 | 10 | 10 |
| Original download | ✗ | ✓ | ✓ | ✓ | ✓ |
| Branding | GetMyPhotos | Couple names | Couple names | Studio logo | Studio logo |
| Invite uploaders | 1 | 3 | 5 | 5 | 10 |

Limits live in a `plans` table (config, not code) so prices can be A/B tested.

**Money-back guarantee:** Event Pass refundable within 7 days if < 50% of guests who searched got ≥1 match (auto-computed metric) or on manual review.

---

## 4. Architecture

```
                   Cloudflare (DNS, CDN, WAF)
     ┌──────────────┬─────────────┬──────────────────┐
  landing/        guest/         dashboard/          (all static on Cloudflare Pages)
  Next.js SSG     Preact+Vite    Next.js (static export, client-side)
     └──────────────┴──────┬──────┴──────────────────┘
                           │ HTTPS JSON  api.getmyphotos.in
                    ┌──────▼──────┐
                    │  FastAPI    │  (uvicorn, 2–4 workers)
                    └──┬───┬───┬──┘
          ┌────────────┘   │   └───────────────┐
   PostgreSQL 16       Redis 7             Cloudflare R2
   + pgvector          (RQ queues,         (originals, web, thumbs,
                        rate limits,        zips) — presigned URLs
                        OTP, sessions)
                           │
                    ┌──────▼──────┐
                    │ RQ workers  │  face (ONNX CPU), media, notify, zip, cron
                    └─────────────┘
   External: Meta WhatsApp Cloud API · MSG91 (SMS) · Razorpay (UPI)
```

**Deployment:** single Hetzner VM (8 vCPU / 16–32 GB), Docker Compose: `api`, `worker-face` (×N), `worker-default`, `postgres`, `redis`, `caddy`. Nightly `pg_dump` → R2.

---

## 5. Storage Layout (R2)

```
events/{event_id}/orig/{photo_id}.jpg     # paid plans only (original quality)
events/{event_id}/web/{photo_id}.webp     # 1600px long edge, q80 (~200–400 KB)
events/{event_id}/thumb/{photo_id}.webp   # 400px, q70 (~25–40 KB)
events/{event_id}/zip/{guest_key}.zip     # TTL 24h (lifecycle rule)
selfies/tmp/{uuid}.jpg                    # NEVER stored — selfie is processed in memory
branding/{owner_id}/logo.webp
```

All reads via short-lived presigned URLs (15 min) or signed CDN URLs. Buckets private. Lifecycle rule deletes `zip/` after 1 day.

---

## 6. Database Schema (PostgreSQL + pgvector)

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ---------- Identity ----------
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         text UNIQUE NOT NULL,          -- E.164, +91XXXXXXXXXX
  name          text,
  lang          text NOT NULL DEFAULT 'hi',
  is_admin      boolean NOT NULL DEFAULT false,
  studio_name   text,
  studio_logo   text,                          -- R2 key
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    bytea NOT NULL UNIQUE,         -- sha256(refresh token)
  device        text,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------- Plans & billing ----------
CREATE TABLE plans (
  code              text PRIMARY KEY,          -- free, pass_499, ...
  kind              text NOT NULL CHECK (kind IN ('free','pass','annual')),
  price_paise       int  NOT NULL,
  max_events        int  NOT NULL,
  max_photos        int  NOT NULL,
  retention_days    int  NOT NULL,
  wa_images         int  NOT NULL,
  original_download boolean NOT NULL,
  max_uploaders     int  NOT NULL,
  active            boolean NOT NULL DEFAULT true
);

CREATE TABLE subscriptions (                   -- annual plans
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id),
  plan_code     text NOT NULL REFERENCES plans(code),
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  events_used   int NOT NULL DEFAULT 0
);

CREATE TABLE payments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id),
  event_id           uuid,                     -- for pass / extension
  purpose            text NOT NULL CHECK (purpose IN ('pass','annual','extend')),
  plan_code          text REFERENCES plans(code),
  amount_paise       int NOT NULL,
  razorpay_order_id  text UNIQUE NOT NULL,
  razorpay_payment_id text,
  status             text NOT NULL DEFAULT 'created'
                     CHECK (status IN ('created','paid','failed','refunded')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  paid_at            timestamptz
);

-- ---------- Events ----------
CREATE TABLE events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            citext UNIQUE NOT NULL,      -- e.g. SHR4821 (no 0/O/1/I)
  pin_hash        text,                        -- argon2, NULL = no PIN
  owner_id        uuid NOT NULL REFERENCES users(id),
  plan_code       text NOT NULL REFERENCES plans(code) DEFAULT 'free',
  subscription_id uuid REFERENCES subscriptions(id),
  title           text NOT NULL,               -- "Rahul weds Priya"
  event_date      date,
  city            text,
  lang            text NOT NULL DEFAULT 'hi',  -- default guest language
  cover_photo_id  uuid,
  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','processing','live','expired','deleted')),
  photo_count     int NOT NULL DEFAULT 0,
  face_count      int NOT NULL DEFAULT 0,
  match_threshold real NOT NULL DEFAULT 0.42,  -- cosine distance cutoff
  expires_at      timestamptz,                 -- set when first goes live
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON events (owner_id);
CREATE INDEX ON events (expires_at) WHERE status IN ('live','processing');

CREATE TABLE event_members (
  event_id    uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id),
  role        text NOT NULL CHECK (role IN ('owner','uploader')),
  added_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);

CREATE TABLE event_invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  token_hash  bytea UNIQUE NOT NULL,
  phone       text,                            -- optional target
  role        text NOT NULL DEFAULT 'uploader',
  expires_at  timestamptz NOT NULL,
  used_by     uuid REFERENCES users(id),
  used_at     timestamptz
);

-- ---------- Photos & faces ----------
CREATE TABLE photos (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id      uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  uploaded_by   uuid NOT NULL REFERENCES users(id),
  client_hash   text NOT NULL,                 -- sha1 from browser, dedupe
  width         int, height int,
  bytes_web     int, bytes_orig int,
  has_original  boolean NOT NULL DEFAULT false,
  taken_at      timestamptz,
  status        text NOT NULL DEFAULT 'uploaded'
                CHECK (status IN ('uploaded','processing','done','failed','hidden')),
  face_count    int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, client_hash)
);
CREATE INDEX ON photos (event_id, status);

CREATE TABLE faces (
  id          bigserial PRIMARY KEY,
  event_id    uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  photo_id    uuid NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  bbox        real[4] NOT NULL,                -- x,y,w,h normalized
  det_score   real NOT NULL,
  quality     real,                            -- blur/size score
  embedding   vector(512) NOT NULL
);
CREATE INDEX faces_event_idx ON faces (event_id);
CREATE INDEX faces_hnsw ON faces USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
-- Queries ALWAYS filter by event_id. For large scale, partition by hash(event_id).

-- ---------- Guests ----------
CREATE TABLE guest_faces (                     -- opt-in profile face code
  user_id          uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  embedding_enc    bytea NOT NULL,             -- AES-256-GCM(512 float32), key in KMS/env
  consent_version  text NOT NULL,
  consent_at       timestamptz NOT NULL,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE guest_events (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id    uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  joined_via  text NOT NULL CHECK (joined_via IN ('qr','code')),
  joined_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_photo_count int NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, event_id)
);

CREATE TABLE guest_matches (                   -- cache for profile users only
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id    uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  photo_id    uuid NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  distance    real NOT NULL,
  hidden      boolean NOT NULL DEFAULT false,  -- "Not me" by this guest
  notified    boolean NOT NULL DEFAULT false,
  PRIMARY KEY (user_id, photo_id)
);

-- ---------- Trust & safety ----------
CREATE TABLE reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  photo_id    uuid REFERENCES photos(id) ON DELETE CASCADE,
  reporter_id uuid REFERENCES users(id),
  reason      text NOT NULL CHECK (reason IN ('not_me','remove_me','inappropriate','other')),
  note        text,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','actioned','dismissed')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE consent_log (                     -- DPDP audit trail (append-only)
  id          bigserial PRIMARY KEY,
  user_id     uuid,
  anon_key    text,                            -- for anonymous guest searches
  event_id    uuid,
  action      text NOT NULL,                   -- search_consent, profile_consent, profile_delete, ...
  version     text NOT NULL,
  lang        text NOT NULL,
  ip_hash     bytea,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE wa_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid, phone text NOT NULL,
  event_id    uuid,
  kind        text NOT NULL,                   -- otp, gallery_link, image, invite, expiry_warning, new_photos
  wa_msg_id   text, status text, cost_paise int,
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

---

## 7. Face Pipeline

### 7.1 Models (CPU, ONNX Runtime)
- **Detector:** SCRFD-2.5G (InsightFace `buffalo_s` det) — fast, handles small faces.
- **Recognizer:** ArcFace R50 (`buffalo_l` `w600k_r50.onnx`) — 512-d, L2-normalized.
- Start with `buffalo_l` recognizer + `buffalo_s` detector; benchmark on 200 real Indian wedding photos before launch.
- **License note:** InsightFace pretrained weights are non-commercial by default — **obtain commercial license or switch to a permissively licensed model (e.g. train/finetune, or use a commercially-licensed alternative) before paid launch.** Keep the model behind an interface (`FaceEngine`) so it can be swapped.

### 7.2 Upload → Index
```
Browser: resize (1600px web + 400px thumb, WebP) + SHA-1 → presigned PUT to R2
      → POST /photos/complete
API:  insert photos(status=uploaded) → enqueue face.index(photo_id)
Worker:
  1. GET web.webp from R2
  2. detect faces (input 640px), keep det_score ≥ 0.6, min face side ≥ 40px
  3. quality score (Laplacian blur + size + pose) — drop very poor faces
  4. align (5 landmarks) → embed → L2 normalize
  5. bulk INSERT faces; UPDATE photos SET status=done, face_count
  6. if event has profile guests → enqueue match.profiles(event_id, photo_id) (batched every 60s)
```
Target: ~0.4 s/photo/core → 8 cores ≈ 1,000 photos in ~1 min.

### 7.3 Guest Search
```
POST /events/{code}/search  (multipart selfie, max 2 MB, resized client-side to 720px)
  1. decode in memory — never written to disk/R2
  2. detect: require exactly 1 dominant face (else friendly error: "Sirf apna chehra dikhaiye")
  3. embed → vector q
  4. SELECT photo_id, MIN(embedding <=> q) AS d
       FROM faces WHERE event_id = $1
       GROUP BY photo_id HAVING MIN(embedding <=> q) < $threshold + 0.08
       ORDER BY d LIMIT 500;
     (SET hnsw.ef_search = 100; with event filter use iterative scan, pgvector ≥ 0.8)
  5. bucket: d < threshold → "Aapki photos"; threshold ≤ d < threshold+0.08 → "Shayad aap?"
  6. discard selfie bytes; keep q only in Redis `search:{token}` TTL 30 min (for WhatsApp/ZIP/"Not me")
  7. return result token + photo list (thumb/web signed URLs)
```
If the guest opted into a profile: store encrypted q in `guest_faces` (no image).

### 7.4 Profile Matching
- On guest joining event: run 7.3 step 4 with decrypted profile embedding → write `guest_matches`.
- On new photos in an event: batch job matches only new faces against `guest_faces` of guests in `guest_events` for that event → insert matches → notify (max 1 WA per guest per event per 24h, "12 nayi photos aayi hain").

### 7.5 Accuracy guardrails
- Per-event threshold tunable by owner ("Strict / Normal / Loose") mapped to 0.38 / 0.42 / 0.48.
- "Not me" by a guest hides that photo for them and feeds a false-positive metric.
- Prefer precision: never show "maybe" bucket expanded by default.

---

## 8. API Specification

Base: `https://api.getmyphotos.in/v1` · JSON · Auth: `Authorization: Bearer <access JWT>` (15 min) + httpOnly refresh cookie (60 days).
Errors: `{ "error": { "code": "PIN_REQUIRED", "message_key": "err.pin_required" } }` — client translates `message_key`.

### 8.1 Auth
| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/auth/otp/send` | `{phone, channel?: "wa"\|"sms", lang}` | 6-digit, TTL 5 min, max 3/10min per phone, 10/hr per IP |
| POST | `/auth/otp/verify` | `{phone, code}` | Creates user if new → `{access, user, is_new}` |
| POST | `/auth/refresh` | cookie | Rotates refresh token |
| POST | `/auth/logout` | — | |
| GET | `/me` | — | user + active subscription + limits |
| PATCH | `/me` | `{name, lang, studio_name}` | |
| DELETE | `/me` | — | DPDP erasure: deletes profile, face code, joined events; owned events scheduled for deletion after confirm |

### 8.2 Events (owner / uploader)
| Method | Path | Body / Notes |
|---|---|---|
| POST | `/events` | `{title, event_date, city, lang, pin?}` → free plan by default |
| GET | `/events` | events where user is member |
| GET | `/events/{id}` | details, stats (photos, faces, searches, matches) |
| PATCH | `/events/{id}` | title, date, lang, pin (set/clear), match strictness — owner only |
| DELETE | `/events/{id}` | owner only; hard-deletes photos/faces/R2 within 24h |
| GET | `/events/{id}/qr.png?size=1024&style=card` | printable QR card (couple names + code) |
| POST | `/events/{id}/invites` | `{phone?}` → `{url}`; sends WA invite if phone |
| POST | `/invites/{token}/accept` | logged-in user becomes uploader |
| DELETE | `/events/{id}/members/{user_id}` | owner removes uploader |
| GET | `/events/{id}/reports` | owner sees reports |
| POST | `/events/{id}/photos/{pid}/hide` | owner hides photo globally |

### 8.3 Uploads
| Method | Path | Notes |
|---|---|---|
| POST | `/events/{id}/uploads/presign` | `{files:[{client_hash, size_web, size_thumb, size_orig?}]}` (max 50/batch) → presigned PUT URLs; skips duplicates; enforces plan photo limit |
| POST | `/events/{id}/uploads/complete` | `{photos:[{photo_id, width, height, taken_at}]}` → enqueue indexing |
| GET | `/events/{id}/progress` | `{uploaded, processing, done, failed}` (poll 5s or SSE) |

Originals > 5 MB use R2 multipart (`/uploads/multipart/*`).

### 8.4 Guest (public)
| Method | Path | Notes |
|---|---|---|
| GET | `/public/events/{code}` | `{title, date, cover_thumb, lang, requires_pin, status, branding}` |
| POST | `/public/events/{code}/unlock` | `{pin}` → `event_access` token (JWT, 12h). 5 tries / 15 min per device+IP |
| POST | `/public/events/{code}/search` | multipart `selfie`, `consent_version`, `save_profile?` (needs login) → `{search_token, matches:[...], maybe:[...]}` |
| GET | `/public/search/{token}` | re-fetch results (30 min) |
| POST | `/public/search/{token}/not-me` | `{photo_id}` |
| POST | `/public/search/{token}/zip` | → job id; `GET /public/jobs/{id}` → `{status, url}` |
| POST | `/public/search/{token}/whatsapp` | `{mode: "link"\|"images"}` → returns `wa.me` deep link with prefilled text `PHOTOS <short_id>` (guest sends first → free window) |
| POST | `/public/reports` | `{event_code, photo_id, reason, note}` — "Remove me" |

### 8.5 Guest profile (logged-in guest)
| Method | Path | Notes |
|---|---|---|
| POST | `/guest/face` | multipart selfie + consent → stores encrypted embedding |
| DELETE | `/guest/face` | delete face code |
| GET | `/guest/events` | My Events with `new_count` |
| POST | `/guest/events` | `{code, pin?}` → join + match |
| DELETE | `/guest/events/{event_id}` | leave; deletes matches |
| GET | `/guest/events/{event_id}/photos` | cached matches |

### 8.6 Payments
| Method | Path | Notes |
|---|---|---|
| POST | `/billing/orders` | `{purpose, plan_code, event_id?}` → Razorpay order (UPI intent enabled) |
| POST | `/billing/verify` | client signature verify (optimistic) |
| POST | `/webhooks/razorpay` | source of truth: `payment.captured`, `refund.processed` |
| GET | `/billing/invoices` | GST invoice PDFs (later) |

On pass paid: `events.plan_code = pass_xxx`, `expires_at = max(now, expires_at) + retention`.

### 8.7 WhatsApp
| Method | Path | Notes |
|---|---|---|
| GET/POST | `/webhooks/whatsapp` | verify token; inbound `PHOTOS <id>` → look up search/profile → send gallery link + up to N images (plan limit) inside service window |

Templates (to pre-approve in Meta): `otp_code` (authentication), `event_invite`, `new_photos`, `expiry_warning`, `gallery_link` — each in 7 languages.

---

## 9. Background Jobs (RQ)

| Queue | Job | Trigger |
|---|---|---|
| `face` | `index_photo(photo_id)` | upload complete |
| `face` | `match_profiles(event_id, since_ts)` | debounced 60s after uploads; guest join |
| `media` | `build_zip(search_token)` | guest request |
| `notify` | `send_wa(...)`, `send_sms_otp(...)` | various |
| `cron` | `expire_events` (hourly) | status→expired, delete R2 + faces + matches |
| `cron` | `expiry_warnings` (daily 10:00 IST) | 3 days before expiry |
| `cron` | `purge_deleted` (daily) | hard-delete soft-deleted users/events |
| `cron` | `backup_db` (daily 03:00 IST) | pg_dump → R2 |

Retries: 3 with exponential backoff; dead-letter list visible in admin.

---

## 10. Frontends

### 10.1 Guest PWA — `guest/` (Preact + Vite)
**Budgets:** JS ≤ 50 KB gz, CSS ≤ 10 KB, first screen LCP < 2 s on Moto E-class over 3G. Fonts: system first; Noto subset loaded only for selected script.

**Routes**
| Route | Screen |
|---|---|
| `/e/{code}` | **Screen 1 – Welcome:** cover photo, couple names, language chips, [PIN field if needed], big button *"Selfie lo, apni photos paao"*, one-line consent checkbox (pre-labeled, tap to agree), privacy line *"Selfie turant delete ho jaati hai"* |
| `/e/{code}/selfie` | **Screen 2 – Selfie:** front camera in oval guide, big capture button; fallback `<input capture="user">`; retake/use; loader *"Aapki photos dhoondh rahe hain…"* with progress |
| `/e/{code}/photos` | **Screen 3 – Photos:** count header, grid of thumbs, sticky bottom bar: **[Download All]** **[WhatsApp pe bhejo]**; each photo has visible *"Main nahi hoon"* button; "Shayad aap?" collapsed section; soft prompt *"Agli baar selfie ki zaroorat nahi — number save karein"* |
| `/join` | Enter event code manually |
| `/me` | My Events (login via OTP) |
| `/me/e/{event_id}` | Profile gallery for event |
| `/privacy` | Plain-language privacy page |

**Behaviors**
- Detect in-app browsers (WhatsApp/Instagram/FB UA) → show "Chrome mein kholo" hint only if camera fails.
- Service worker: cache shell + i18n; stale-while-revalidate for thumbs.
- Photo viewer: swipe, download single, pinch zoom (no library, CSS + pointer events).
- All tap targets ≥ 48 px, base font 18 px.

### 10.2 Dashboard — `dashboard/` (Next.js static export)
Screens:
1. **Login** — phone → OTP.
2. **Home** — "Naya event banao" button + event cards (status, photos, days left).
3. **Create event** — title, date, city, language, PIN toggle → done (3 fields).
4. **Event page** tabs:
   - **Upload:** drag/drop or "Photos chuno"; queue list with per-file state; pause/resume; works offline (IndexedDB + retries); "Keep this tab open" note.
   - **Share:** QR preview, download printable card (A5/A6 PDF/PNG), copy link, WhatsApp share, show code + PIN.
   - **Team:** invite photographer (phone or link), remove.
   - **Stats:** photos, faces, guest searches, match rate, downloads.
   - **Settings:** match strictness, PIN, extend retention, delete event.
   - **Reports:** list with hide-photo action.
5. **Billing** — current plan, upgrade (Event Pass / Annual) → Razorpay UPI checkout.
6. **Profile** — name, studio name, logo, language.

**Offline upload queue design**
```
IndexedDB stores: queue(id, event_id, file handle/blob, client_hash, state, attempts, error)
State machine: pending → compressing → hashing → presigning → uploading(web,thumb,orig) → completing → done | failed
Concurrency: 3 (adaptive: drop to 1 on slow uplink via navigator.connection)
Compression in Web Worker: createImageBitmap → OffscreenCanvas → WebP (fallback JPEG)
EXIF: read orientation + DateTimeOriginal before resize; strip GPS
Resume on: online event, visibilitychange, page load; Background Sync where supported
```

### 10.3 Landing — `landing/` (Next.js SSG)
Sections: Header (logo, language switcher, WhatsApp) → Hero (Hinglish headline, English subtitle, CTA "Free mein shuru karo — App nahi chahiye", secondary "Demo try karo", looping MP4/WebM ≤ 400 KB with poster) → How it works (3 icons) → Why couples love us (4 cards) → Who is it for (Couple / Photographer split) → Testimonials (placeholder until real) → Pricing (3 cards, UPI badge, money-back badge) → FAQ (5 core + more) → Final CTA → Footer (privacy, terms, grievance officer).
Sticky bottom WhatsApp button (`wa.me` link, no widget). Counters hidden behind a config flag until real.
Pages per language: `/`, `/hi`, `/bn`, `/mr`, `/te`, `/ta`, `/gu` with `hreflang`.
Budget: total ≤ 150 KB before video, zero third-party JS (analytics via self-hosted Plausible/Umami or Cloudflare Web Analytics).

---

## 11. Internationalization

- Locale files: `packages/i18n/{en,hi,bn,mr,te,ta,gu}.json`, flat keys (`guest.cta.selfie`).
- Tone: warm Hinglish for `hi`; simple colloquial register for others; **reviewed by native speakers**, not only machine translation.
- Guest default language order: `?lang` → saved preference → event.lang → `navigator.language` → `hi`.
- Button text length check in CI: warn if any locale string > 1.6× English length for `*.cta.*` keys.
- Numbers: Indian grouping (`3,50,000`), "lakh" wording in copy.

**Core guest strings (Hindi / Hinglish draft)**
| Key | hi |
|---|---|
| `guest.cta.selfie` | Selfie lo, apni photos paao |
| `guest.consent` | Main manta/manti hoon ki meri selfie sirf photos dhoondhne ke liye use hogi |
| `guest.privacy_line` | Aapki selfie turant delete ho jaati hai |
| `guest.searching` | Aapki photos dhoondh rahe hain… |
| `guest.found` | {n} photos mili! |
| `guest.none` | Koi photo nahi mili. Achhi roshni mein dobara selfie lein |
| `guest.download_all` | Saari photos download karo |
| `guest.whatsapp` | WhatsApp pe bhejo |
| `guest.not_me` | Main nahi hoon |
| `guest.maybe` | Shayad aap? |
| `guest.save_profile` | Agli baar selfie ki zaroorat nahi — number save karein |
| `err.one_face` | Sirf apna chehra camera mein rakhein |
| `err.pin_wrong` | PIN galat hai, dobara try karein |

---

## 12. Privacy, Security & Compliance (DPDP Act 2023)

**Consent**
- Anonymous search: explicit checkbox per search; logged in `consent_log` with `anon_key` (hash of device id + event).
- Profile: separate consent screen with purpose, what's stored (face code, not photo), where used (only joined events), how to delete.
- Owner: at event creation, checkbox "I have informed guests that photos will be searchable by face" + printable notice on QR card.

**Data minimization**
- Selfie image: in-memory only, never logged, never stored.
- Search embedding: Redis TTL 30 min.
- Profile embedding: AES-256-GCM encrypted at rest; key via env/secret manager; rotated yearly.
- No cross-event face search, ever — enforced in code (repository layer requires `event_id`) and tests.

**Rights**
- Access/export: `/me/export` (JSON + photo links).
- Erasure: `DELETE /me`, "Remove me from this event" report → owner/admin action; faces of reported person can be purged by admin.
- Grievance officer name + email + WhatsApp published on `/privacy`; response SLA 72h.

**Security**
- Rate limits (Redis): OTP, PIN unlock, search (10/event/device/hour), public event lookup.
- Event codes: 7 chars from 31-char alphabet (~27 bn combos) + optional PIN.
- Signed, short-lived R2 URLs; no public bucket listing.
- Uploads validated: MIME sniff, max dimensions, max bytes, decode check in worker.
- CSP strict on all frontends; no third-party scripts.
- Admin actions audited.
- Razorpay/WhatsApp webhooks verified by signature.

---

## 13. Observability & Metrics

- Logs: structured JSON (no PII, phone masked `+91XXXXXX1234`).
- Errors: self-hosted GlitchTip (Sentry-compatible) or Sentry free tier.
- Metrics table `daily_stats`: events created, photos processed, searches, search→≥1 match %, downloads, WA sends, not-me rate, conversions free→paid, revenue.
- Web vitals: `web-vitals` lib (1 KB) → `/v1/rum` beacon.

**North-star KPIs:** guest time-to-first-photo < 60s · match success ≥ 80% of searches · not-me rate < 3% · free→paid ≥ 10%.

---

## 14. Repository Layout

```
photos/
├── docs/SPEC.md
├── docker-compose.yml
├── .env.example
├── db/migrations/0001_init.sql
├── api/                    # FastAPI
│   ├── app/main.py
│   ├── app/core/           # config, security, db, redis, r2, i18n errors
│   ├── app/routers/        # auth, events, uploads, public, guest, billing, webhooks
│   ├── app/services/       # otp, whatsapp, sms, razorpay, qr, plans, face_search
│   ├── app/models/         # SQLAlchemy / pydantic schemas
│   └── tests/
├── worker/
│   ├── face_engine.py      # FaceEngine interface + ONNX impl
│   ├── jobs/               # index, match, zip, notify, cron
│   └── models/             # .onnx (gitignored, downloaded by script)
├── packages/i18n/          # shared locale json
├── guest/                  # Preact + Vite PWA
├── dashboard/              # Next.js (static export)
└── landing/                # Next.js SSG
```

---

## 15. Delivery Plan

| Phase | Weeks | Deliverables | Exit criteria |
|---|---|---|---|
| **P1 Core loop** | 1–6 | DB, auth (WA+SMS OTP), events/code/PIN, upload queue, face worker, QR, guest 3 screens, download, Not me, 7-day expiry | 1 real wedding (1,000+ photos) end-to-end; guest flow < 60s on budget Android |
| **P2 Money & retention** | 7–10 | Razorpay UPI, plans, invites/roles, guest profile + My Events + new-photo alerts, WhatsApp link+images, 7 languages | 5 paying events; WA delivery working |
| **P3 Growth & polish** | 11–13 | Landing page, server ZIP, branding/QR cards, stats, DPDP export/delete, admin panel | CWV green on 3G; public launch |

**Pre-launch checklist:** commercial face-model license · Meta Business verification + template approvals · Razorpay KYC · DLT registration for SMS · privacy policy + terms legal review · native-speaker translation review · load test (10k-photo event, 500 concurrent searches).

---

## 16. Open Items / Risks

1. **Face model commercial license** (InsightFace weights) — must resolve before paid launch.
2. **DLT template registration** for SMS OTP in India (takes 1–2 weeks).
3. **WhatsApp pricing changes** by Meta — keep link-mode as default fallback.
4. **iOS Safari** background upload limits — dashboard shows "tab khula rakhein".
5. **Veils/ghunghat/low-light accuracy** — collect consented test set early.

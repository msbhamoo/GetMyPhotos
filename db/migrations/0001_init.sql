-- GetMyPhotos — initial schema (P1)
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ---------- Identity ----------
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone         text UNIQUE NOT NULL,
  name          text,
  lang          text NOT NULL DEFAULT 'hi',
  is_admin      boolean NOT NULL DEFAULT false,
  studio_name   text,
  studio_logo   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE TABLE sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    bytea NOT NULL UNIQUE,
  device        text,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON sessions (user_id);

-- ---------- Plans & billing ----------
CREATE TABLE plans (
  code              text PRIMARY KEY,
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

INSERT INTO plans VALUES
  ('free',        'free',        0,   1,   500,   7,  0, false,  1, true),
  ('pass_499',    'pass',    49900,   1,  3000,  90, 10, true,   3, true),
  ('pass_999',    'pass',    99900,   1, 10000,  90, 10, true,   5, true),
  ('annual_2999', 'annual', 299900,  25,  5000, 365, 10, true,   5, true),
  ('annual_4999', 'annual', 499900,  75, 10000, 365, 10, true,  10, true);

CREATE TABLE subscriptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id),
  plan_code     text NOT NULL REFERENCES plans(code),
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  events_used   int NOT NULL DEFAULT 0
);

CREATE TABLE payments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES users(id),
  event_id            uuid,
  purpose             text NOT NULL CHECK (purpose IN ('pass','annual','extend')),
  plan_code           text REFERENCES plans(code),
  amount_paise        int NOT NULL,
  razorpay_order_id   text UNIQUE NOT NULL,
  razorpay_payment_id text,
  status              text NOT NULL DEFAULT 'created'
                      CHECK (status IN ('created','paid','failed','refunded')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  paid_at             timestamptz
);

-- ---------- Events ----------
CREATE TABLE events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            citext UNIQUE NOT NULL,
  pin_hash        text,
  owner_id        uuid NOT NULL REFERENCES users(id),
  plan_code       text NOT NULL REFERENCES plans(code) DEFAULT 'free',
  subscription_id uuid REFERENCES subscriptions(id),
  title           text NOT NULL,
  event_date      date,
  city            text,
  lang            text NOT NULL DEFAULT 'hi',
  cover_photo_id  uuid,
  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','processing','live','expired','deleted')),
  photo_count     int NOT NULL DEFAULT 0,
  face_count      int NOT NULL DEFAULT 0,
  -- cosine distance cutoff for ArcFace embeddings (lower = stricter)
  match_threshold real NOT NULL DEFAULT 0.55,
  expires_at      timestamptz,
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
CREATE INDEX ON event_members (user_id);

CREATE TABLE event_invites (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  token_hash  bytea UNIQUE NOT NULL,
  phone       text,
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
  client_hash   text NOT NULL,
  mime          text NOT NULL DEFAULT 'image/webp',
  width         int,
  height        int,
  bytes_web     int,
  bytes_orig    int,
  has_original  boolean NOT NULL DEFAULT false,
  taken_at      timestamptz,
  status        text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','uploaded','processing','done','failed','hidden')),
  face_count    int NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, client_hash)
);
CREATE INDEX ON photos (event_id, status);

CREATE TABLE faces (
  id          bigserial PRIMARY KEY,
  event_id    uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  photo_id    uuid NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  bbox        real[] NOT NULL,
  det_score   real NOT NULL,
  quality     real,
  embedding   vector(512) NOT NULL
);
-- Searches are always scoped to one event and use an exact scan over that
-- event's faces (tens of thousands of rows at most), which is fast and never
-- misses results the way a filtered HNSW scan can. Add partitioning by
-- event_id if the table grows past ~50M rows.
CREATE INDEX faces_event_idx ON faces (event_id);
CREATE INDEX faces_photo_idx ON faces (photo_id);

-- ---------- Guests (profile tables used from P2) ----------
CREATE TABLE guest_faces (
  user_id          uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  embedding_enc    bytea NOT NULL,
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

CREATE TABLE guest_matches (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id    uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  photo_id    uuid NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  distance    real NOT NULL,
  hidden      boolean NOT NULL DEFAULT false,
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
CREATE INDEX ON reports (event_id, status);

CREATE TABLE consent_log (
  id          bigserial PRIMARY KEY,
  user_id     uuid,
  anon_key    text,
  event_id    uuid,
  action      text NOT NULL,
  version     text NOT NULL,
  lang        text NOT NULL,
  ip_hash     bytea,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE wa_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid,
  phone       text NOT NULL,
  event_id    uuid,
  kind        text NOT NULL,
  wa_msg_id   text,
  status      text,
  cost_paise  int,
  created_at  timestamptz NOT NULL DEFAULT now()
);

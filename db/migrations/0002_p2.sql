-- GetMyPhotos — P2: payments, invites, guest profiles, WhatsApp delivery

ALTER TABLE events ADD COLUMN extended boolean NOT NULL DEFAULT false;
ALTER TABLE events ADD COLUMN went_live_at timestamptz;
UPDATE events SET went_live_at = created_at WHERE status IN ('live', 'expired');

ALTER TABLE event_invites ADD COLUMN created_by uuid REFERENCES users(id);
ALTER TABLE event_invites ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX ON event_invites (event_id);

ALTER TABLE payments ADD COLUMN notes jsonb;
CREATE INDEX ON payments (user_id, created_at DESC);
CREATE INDEX ON subscriptions (user_id, ends_at DESC);

ALTER TABLE guest_events ADD COLUMN last_viewed_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE guest_events ADD COLUMN last_notified_at timestamptz;
CREATE INDEX ON guest_events (event_id);

ALTER TABLE guest_matches ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX ON guest_matches (user_id, event_id);

-- Unguessable links to a person's matched photos (sent over WhatsApp)
CREATE TABLE shared_galleries (
  id          text PRIMARY KEY,
  event_id    uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  photo_ids   uuid[] NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX ON shared_galleries (event_id);
CREATE INDEX ON shared_galleries (expires_at);

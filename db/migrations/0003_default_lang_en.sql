-- English is the default language; the guest UI ships en + hi + bn for now.
ALTER TABLE users ALTER COLUMN lang SET DEFAULT 'en';
ALTER TABLE events ALTER COLUMN lang SET DEFAULT 'en';

-- Move existing rows off languages the UI no longer offers
UPDATE users SET lang = 'en' WHERE lang NOT IN ('en', 'hi', 'bn');
UPDATE events SET lang = 'en' WHERE lang NOT IN ('en', 'hi', 'bn');

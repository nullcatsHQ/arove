ALTER TABLE repos ADD COLUMN webhook_secret TEXT;
ALTER TABLE repos ADD COLUMN last_webhook_at TEXT;

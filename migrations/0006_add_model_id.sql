-- Track which AI model produced each submission for quality analytics
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS model_id TEXT;

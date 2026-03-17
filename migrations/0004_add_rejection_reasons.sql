-- Add rejection feedback column to bounties (for feedback loop)
ALTER TABLE bounties ADD COLUMN IF NOT EXISTS last_rejection_reasons JSONB;

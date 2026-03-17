-- Prevent duplicate consensus results for the same submission (race condition fix)
CREATE UNIQUE INDEX IF NOT EXISTS uq_consensus_submission_id ON consensus_results (submission_id);

-- Add submission_count to bounties for limiting submission attempts
ALTER TABLE bounties ADD COLUMN IF NOT EXISTS submission_count INTEGER NOT NULL DEFAULT 0;

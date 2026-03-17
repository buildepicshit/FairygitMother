-- Indexes for frequently queried columns
CREATE INDEX IF NOT EXISTS idx_bounties_status ON bounties (status);
CREATE INDEX IF NOT EXISTS idx_bounties_owner_repo ON bounties (owner, repo);
CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes (status);
CREATE INDEX IF NOT EXISTS idx_nodes_api_key ON nodes (api_key);
CREATE INDEX IF NOT EXISTS idx_submissions_bounty_id ON submissions (bounty_id);
CREATE INDEX IF NOT EXISTS idx_votes_submission_id ON votes (submission_id);
CREATE INDEX IF NOT EXISTS idx_consensus_submission_id ON consensus_results (submission_id);
CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_log (event);

-- Prevent duplicate votes from the same reviewer on the same submission
CREATE UNIQUE INDEX IF NOT EXISTS uq_votes_submission_reviewer ON votes (submission_id, reviewer_node_id);

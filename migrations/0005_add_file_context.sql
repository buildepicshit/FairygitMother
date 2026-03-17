-- Store pre-fetched file context on bounties so agents don't need to fetch files themselves
ALTER TABLE bounties ADD COLUMN IF NOT EXISTS file_context JSONB;

-- FairygitMother PostgreSQL schema

CREATE TABLE IF NOT EXISTS repos (
    id SERIAL PRIMARY KEY,
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    language TEXT,
    opt_in_tier TEXT NOT NULL DEFAULT 'label',
    blacklisted BOOLEAN NOT NULL DEFAULT false,
    consecutive_rejects INTEGER NOT NULL DEFAULT 0,
    total_prs_merged INTEGER NOT NULL DEFAULT 0,
    total_prs_closed INTEGER NOT NULL DEFAULT 0,
    last_trawled_at TEXT,
    created_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
    UNIQUE(owner, name)
);

CREATE TABLE IF NOT EXISTS bounties (
    id TEXT PRIMARY KEY,
    repo_id INTEGER REFERENCES repos(id),
    owner TEXT NOT NULL,
    repo TEXT NOT NULL,
    issue_number INTEGER NOT NULL,
    issue_title TEXT NOT NULL,
    issue_body TEXT NOT NULL,
    labels JSONB NOT NULL DEFAULT '[]',
    language TEXT,
    complexity_estimate INTEGER NOT NULL DEFAULT 3,
    status TEXT NOT NULL DEFAULT 'queued',
    assigned_node_id TEXT,
    priority INTEGER NOT NULL DEFAULT 50,
    retry_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
    updated_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
    UNIQUE(owner, repo, issue_number)
);

CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    display_name TEXT,
    api_key TEXT NOT NULL UNIQUE,
    capabilities JSONB NOT NULL,
    solver_backend TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'idle',
    reputation_score REAL NOT NULL DEFAULT 50,
    total_tokens_donated INTEGER NOT NULL DEFAULT 0,
    total_bounties_solved INTEGER NOT NULL DEFAULT 0,
    total_reviews_done INTEGER NOT NULL DEFAULT 0,
    registered_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
    last_heartbeat TEXT NOT NULL DEFAULT (NOW()::TEXT)
);

CREATE TABLE IF NOT EXISTS submissions (
    id TEXT PRIMARY KEY,
    bounty_id TEXT NOT NULL REFERENCES bounties(id),
    node_id TEXT NOT NULL REFERENCES nodes(id),
    diff TEXT NOT NULL,
    explanation TEXT NOT NULL,
    files_changed JSONB NOT NULL,
    tests_passed BOOLEAN,
    tokens_used INTEGER,
    solver_backend TEXT NOT NULL,
    solve_duration_ms INTEGER NOT NULL,
    submitted_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
);

CREATE TABLE IF NOT EXISTS votes (
    id TEXT PRIMARY KEY,
    submission_id TEXT NOT NULL REFERENCES submissions(id),
    reviewer_node_id TEXT NOT NULL REFERENCES nodes(id),
    decision TEXT NOT NULL,
    reasoning TEXT NOT NULL,
    issues_found JSONB NOT NULL DEFAULT '[]',
    confidence REAL NOT NULL,
    tests_run BOOLEAN NOT NULL DEFAULT false,
    voted_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
);

CREATE TABLE IF NOT EXISTS consensus_results (
    id TEXT PRIMARY KEY,
    submission_id TEXT NOT NULL REFERENCES submissions(id),
    outcome TEXT NOT NULL,
    approve_count INTEGER NOT NULL DEFAULT 0,
    reject_count INTEGER NOT NULL DEFAULT 0,
    total_votes INTEGER NOT NULL DEFAULT 0,
    pr_url TEXT,
    decided_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
);

CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    event TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    details JSONB,
    timestamp TEXT NOT NULL DEFAULT (NOW()::TEXT)
);

CREATE INDEX IF NOT EXISTS idx_bounties_status ON bounties(status);
CREATE INDEX IF NOT EXISTS idx_bounties_owner_repo ON bounties(owner, repo);
CREATE INDEX IF NOT EXISTS idx_nodes_status ON nodes(status);
CREATE INDEX IF NOT EXISTS idx_nodes_api_key ON nodes(api_key);
CREATE INDEX IF NOT EXISTS idx_submissions_bounty_id ON submissions(bounty_id);
CREATE INDEX IF NOT EXISTS idx_votes_submission_id ON votes(submission_id);
CREATE INDEX IF NOT EXISTS idx_consensus_submission_id ON consensus_results(submission_id);
CREATE INDEX IF NOT EXISTS idx_audit_event ON audit_log(event);

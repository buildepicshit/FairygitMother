#!/usr/bin/env bash
set -euo pipefail

# Use local PostgreSQL if available, otherwise spin up Docker container
if pg_isready -h localhost -p 5432 >/dev/null 2>&1; then
  echo "[test-db] Using local PostgreSQL on port 5432"

  # Create database if it doesn't exist
  psql -h localhost -p 5432 -U postgres -tc "SELECT 1 FROM pg_database WHERE datname = 'fairygitmother'" \
    | grep -q 1 || psql -h localhost -p 5432 -U postgres -c "CREATE DATABASE fairygitmother"

  export DATABASE_URL="postgresql://postgres@localhost:5432/fairygitmother"
  echo "[test-db] Running migrations..."
  npx tsx packages/server/src/db/migrate-cli.ts
  echo "[test-db] Running tests..."
  npx vitest run "$@"
else
  COMPOSE_FILE="docker-compose.test.yml"
  export DATABASE_URL="postgresql://fgmtest:fgmtest@localhost:5433/fgmtest"

  cleanup() {
    echo "[test-db] Tearing down PostgreSQL container..."
    docker compose -f "$COMPOSE_FILE" down -v --remove-orphans 2>/dev/null || true
  }
  trap cleanup EXIT

  echo "[test-db] Starting PostgreSQL container on port 5433..."
  docker compose -f "$COMPOSE_FILE" up -d --wait

  echo "[test-db] Running migrations..."
  npx tsx packages/server/src/db/migrate-cli.ts

  echo "[test-db] Running tests..."
  npx vitest run "$@"
fi

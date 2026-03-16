#!/bin/bash
# Azure App Service startup script
set -e

# Ensure data directory exists for SQLite
mkdir -p /home/data

# Install pnpm if not present
npm install -g pnpm@10.28.2 2>/dev/null || true

# Install deps and rebuild native module
cd /home/site/wwwroot
pnpm install --frozen-lockfile
pnpm rebuild better-sqlite3

# Start the server
exec pnpm start

#!/bin/bash
# Deploy FairygitMother to Azure Container Apps
#
# Prerequisites:
#   - Azure CLI installed and logged in (az login)
#   - Docker installed
#
# Usage:
#   chmod +x infra/deploy.sh
#   ./infra/deploy.sh
#
# Environment variables (optional):
#   AZURE_RESOURCE_GROUP  - Resource group name (default: fairygitmother-rg)
#   AZURE_LOCATION        - Azure region (default: eastus)
#   AZURE_REGISTRY        - Container registry name (default: fairygitmothercr)
#   GITHUB_TOKEN          - GitHub token for the server

set -euo pipefail

# ── Config ──────────────────────────────────────────────────────

RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-fairygitmother-rg}"
LOCATION="${AZURE_LOCATION:-eastus}"
REGISTRY="${AZURE_REGISTRY:-fairygitmothercr}"
APP_NAME="fairygitmother"
ENV_NAME="fairygitmother-env"
IMAGE="${REGISTRY}.azurecr.io/${APP_NAME}:latest"
PG_SERVER_NAME="fairygitmother-pg"
PG_ADMIN_USER="fgmadmin"

echo "=== FairygitMother Azure Deployment ==="
echo "Resource Group: ${RESOURCE_GROUP}"
echo "Location:       ${LOCATION}"
echo "Registry:       ${REGISTRY}"
echo ""

# ── Step 1: Resource Group ──────────────────────────────────────

echo "[1/7] Creating resource group..."
az group create \
  --name "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --output none

# ── Step 2: Container Registry ──────────────────────────────────

echo "[2/7] Creating container registry..."
az acr create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$REGISTRY" \
  --sku Basic \
  --admin-enabled true \
  --output none

# ── Step 3: PostgreSQL Flexible Server ──────────────────────────

echo "[3/7] Creating PostgreSQL Flexible Server..."

# Generate a random password if not provided
PG_PASSWORD="${AZURE_PG_PASSWORD:-$(openssl rand -base64 24)}"

az postgres flexible-server create \
  --name "$PG_SERVER_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --admin-user "$PG_ADMIN_USER" \
  --admin-password "$PG_PASSWORD" \
  --sku-name Standard_B1ms \
  --tier Burstable \
  --storage-size 32 \
  --version 16 \
  --yes \
  --output none

# Create the database
az postgres flexible-server db create \
  --resource-group "$RESOURCE_GROUP" \
  --server-name "$PG_SERVER_NAME" \
  --database-name fairygitmother \
  --output none

# Allow Azure services to connect
az postgres flexible-server firewall-rule create \
  --resource-group "$RESOURCE_GROUP" \
  --name "$PG_SERVER_NAME" \
  --rule-name AllowAzureServices \
  --start-ip-address 0.0.0.0 \
  --end-ip-address 0.0.0.0 \
  --output none

PG_FQDN=$(az postgres flexible-server show \
  --name "$PG_SERVER_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query fullyQualifiedDomainName -o tsv)

DATABASE_URL="postgresql://${PG_ADMIN_USER}:${PG_PASSWORD}@${PG_FQDN}:5432/fairygitmother?sslmode=require"

echo "  PostgreSQL: ${PG_FQDN}"

# ── Step 4: Build and push image ────────────────────────────────

echo "[4/7] Building and pushing Docker image..."
az acr build \
  --registry "$REGISTRY" \
  --image "${APP_NAME}:latest" \
  --file Dockerfile \
  .

# ── Step 5: Container Apps Environment ──────────────────────────

echo "[5/7] Creating Container Apps environment..."
az containerapp env create \
  --name "$ENV_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --output none

# ── Step 6: Create Azure Files share for stats persistence ──────

STORAGE_ACCOUNT="${REGISTRY}storage"
SHARE_NAME="fairygitmother-data"

echo "[6/7] Creating persistent storage for stats..."
az storage account create \
  --name "$STORAGE_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --sku Standard_LRS \
  --output none

STORAGE_KEY=$(az storage account keys list \
  --account-name "$STORAGE_ACCOUNT" \
  --resource-group "$RESOURCE_GROUP" \
  --query '[0].value' -o tsv)

az storage share create \
  --name "$SHARE_NAME" \
  --account-name "$STORAGE_ACCOUNT" \
  --account-key "$STORAGE_KEY" \
  --output none

# Add storage to Container Apps environment
az containerapp env storage set \
  --name "$ENV_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --storage-name "fgmdata" \
  --azure-file-account-name "$STORAGE_ACCOUNT" \
  --azure-file-account-key "$STORAGE_KEY" \
  --azure-file-share-name "$SHARE_NAME" \
  --access-mode ReadWrite \
  --output none

# ── Step 7: Deploy Container App ───────────────────────────────

echo "[7/7] Deploying container app..."

# Get registry credentials
REGISTRY_SERVER="${REGISTRY}.azurecr.io"
REGISTRY_USER=$(az acr credential show --name "$REGISTRY" --query username -o tsv)
REGISTRY_PASS=$(az acr credential show --name "$REGISTRY" --query 'passwords[0].value' -o tsv)

az containerapp create \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --environment "$ENV_NAME" \
  --image "$IMAGE" \
  --registry-server "$REGISTRY_SERVER" \
  --registry-username "$REGISTRY_USER" \
  --registry-password "$REGISTRY_PASS" \
  --target-port 3000 \
  --ingress external \
  --min-replicas 0 \
  --max-replicas 1 \
  --cpu 0.5 \
  --memory 1.0Gi \
  --env-vars \
    "DATABASE_URL=${DATABASE_URL}" \
    "FAIRYGITMOTHER_DATA_DIR=/data" \
    "FAIRYGITMOTHER_HOST=0.0.0.0" \
    "FAIRYGITMOTHER_PORT=3000" \
    "GITHUB_TOKEN=${GITHUB_TOKEN:-}" \
  --output none

# ── Done ────────────────────────────────────────────────────────

FQDN=$(az containerapp show \
  --name "$APP_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query 'properties.configuration.ingress.fqdn' -o tsv)

echo ""
echo "=== Deployment Complete ==="
echo ""
echo "Dashboard:  https://${FQDN}"
echo "Health:     https://${FQDN}/api/v1/health"
echo "API:        https://${FQDN}/api/v1"
echo "PostgreSQL: ${PG_FQDN}"
echo ""
echo "IMPORTANT: Save the DATABASE_URL — it contains the password:"
echo "  ${DATABASE_URL}"
echo ""
echo "Submit a bounty:"
echo "  curl -X POST https://${FQDN}/api/v1/bounties \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"owner\":\"org\",\"repo\":\"project\",\"issueNumber\":42,\"issueTitle\":\"Bug\"}'"
echo ""
echo "To update after code changes:"
echo "  az acr build --registry ${REGISTRY} --image ${APP_NAME}:latest --file Dockerfile ."
echo "  az containerapp update --name ${APP_NAME} --resource-group ${RESOURCE_GROUP} --image ${IMAGE}"

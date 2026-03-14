#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TF_DIR="$ROOT_DIR/infra/terraform"

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI fehlt."
  exit 1
fi

if ! command -v terraform >/dev/null 2>&1; then
  echo "terraform CLI fehlt."
  exit 1
fi

CONTENT_BUCKET="$(terraform -chdir="$TF_DIR" output -raw content_bucket)"
ASSETS_BUCKET="$(terraform -chdir="$TF_DIR" output -raw assets_bucket)"
CDN_DOMAIN="$(terraform -chdir="$TF_DIR" output -raw content_cdn_domain)"
VERSION="${1:-v$(date -u +%Y%m%d%H%M%S)}"

echo "Deploying content version: $VERSION"
echo "content bucket: $CONTENT_BUCKET"
echo "assets bucket: $ASSETS_BUCKET"

# Current/live keys for runtime
aws s3 sync "$ROOT_DIR/content" "s3://$CONTENT_BUCKET/content" --delete
aws s3 sync "$ROOT_DIR/public/content" "s3://$CONTENT_BUCKET/content" --exclude "conversations/*"
aws s3 cp "$ROOT_DIR/public/content-manifest.json" "s3://$CONTENT_BUCKET/content-manifest.json" --content-type "application/json"

# Versioned snapshot keys
aws s3 sync "$ROOT_DIR/content" "s3://$CONTENT_BUCKET/versions/$VERSION/content" --delete
aws s3 sync "$ROOT_DIR/public/content" "s3://$CONTENT_BUCKET/versions/$VERSION/content" --exclude "conversations/*"
aws s3 cp "$ROOT_DIR/public/content-manifest.json" "s3://$CONTENT_BUCKET/versions/$VERSION/content-manifest.json" --content-type "application/json"

# Optional mirror into assets bucket for future split delivery
aws s3 sync "$ROOT_DIR/public/content" "s3://$ASSETS_BUCKET/content" --delete --exclude "conversations/*"

echo "Content deployed."
echo "CloudFront domain: https://$CDN_DOMAIN"
echo "Version snapshot: s3://$CONTENT_BUCKET/versions/$VERSION/"

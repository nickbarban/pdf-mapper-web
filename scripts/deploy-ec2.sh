#!/usr/bin/env bash
# Deploy to AWS EC2: copy app with rsync, then build and run with Docker on the server.
# Same steps as .github/workflows/deploy.yml, run from your machine.
#
# Required env (or export before running):
#   EC2_HOST     - instance public DNS or IP
#   SSH_KEY_PATH - path to .pem key (or set SSH_PRIVATE_KEY to key content)
# Optional:
#   EC2_USER     - default ec2-user
#   DEPLOY_PATH  - default /home/ec2-user/pdf-mapper-web
#
# Example:
#   export EC2_HOST=ec2-3-xx-xx-xx.compute.amazonaws.com
#   export SSH_KEY_PATH=~/.ssh/my-key.pem
#   ./scripts/deploy-ec2.sh

set -e
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

EC2_USER="${EC2_USER:-ec2-user}"
DEPLOY_PATH="${DEPLOY_PATH:-/home/ec2-user/pdf-mapper-web}"

if [ -z "${EC2_HOST}" ]; then
  echo "Error: EC2_HOST is not set (e.g. export EC2_HOST=ec2-xx-xx.compute.amazonaws.com)"
  exit 1
fi

if [ -n "${SSH_PRIVATE_KEY}" ]; then
  KEY_FILE=$(mktemp)
  echo "$SSH_PRIVATE_KEY" > "$KEY_FILE"
  chmod 600 "$KEY_FILE"
  trap "rm -f $KEY_FILE" EXIT
  SSH_OPTS="-i $KEY_FILE"
elif [ -n "${SSH_KEY_PATH}" ] && [ -f "${SSH_KEY_PATH}" ]; then
  SSH_OPTS="-i $SSH_KEY_PATH"
else
  echo "Error: set SSH_KEY_PATH (path to .pem) or SSH_PRIVATE_KEY (key content)"
  exit 1
fi

echo "Copying files to EC2..."
rsync -avz --delete \
  -e "ssh $SSH_OPTS -o StrictHostKeyChecking=accept-new" \
  --exclude=.git \
  --exclude=frontend/node_modules \
  --exclude=backend/build \
  --exclude=backend/.gradle \
  --exclude=data \
  ./ "$EC2_USER@$EC2_HOST:$DEPLOY_PATH/"

echo "Building and starting on EC2..."
ssh $SSH_OPTS -o StrictHostKeyChecking=accept-new "$EC2_USER@$EC2_HOST" \
  "cd $DEPLOY_PATH && docker compose -f docker-compose.prod.yml build --no-cache && docker compose -f docker-compose.prod.yml up -d"

echo "Done. App: http://$EC2_HOST:8080"

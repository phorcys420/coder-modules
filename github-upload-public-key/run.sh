#!/usr/bin/env bash

set -e

CODER_ACCESS_URL="${CODER_ACCESS_URL}"
CODER_OWNER_SESSION_TOKEN="${CODER_OWNER_SESSION_TOKEN}"

if [ -z "$CODER_ACCESS_URL" ]; then
  echo "No coder access url specified!"
  exit 1
fi

if [ -z "$CODER_OWNER_SESSION_TOKEN" ]; then
  echo "No coder owner session token specified!"
  exit 1
fi

if [ -z "$GITHUB_TOKEN" ]; then
  echo "No GITHUB_TOKEN in the workspace environment!"
  exit 1
fi

PUBLIC_KEY_NAME="$CODER_ACCESS_URL Workspaces"

echo "Fetching Coder public SSH key..."
PUBLIC_KEY=$(curl "$CODER_ACCESS_URL/api/v2/users/me/gitsshkey" \
  -H 'accept: application/json' \
  -H "cookie: coder_session_token=$CODER_OWNER_SESSION_TOKEN" \
  --fail \
  -s \
  | jq -r '.public_key'
)

if [ -z "$PUBLIC_KEY" ]; then
  echo "No Coder public SSH key found!"
  exit 1
fi

echo "Fetching GitHub public SSH keys..."
GITHUB_MATCH=$(curl \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  --fail \
  -s \
  https://api.github.com/user/keys \
  | jq -r --arg PUBLIC_KEY "$PUBLIC_KEY" '.[] | select(.key == $PUBLIC_KEY) | .key'
)

if [ "$PUBLIC_KEY" = "$GITHUB_MATCH" ]; then
  echo "Coder public SSH key is already uploaded to GitHub!"
  exit 0
fi
echo "Coder public SSH key not found in GitHub keys!"
echo "Uploading Coder public SSH key to GitHub..."
curl -L \
  -X POST \
  -H "Accept: application/vnd.github+json" \
  -H "Authorization: Bearer $GITHUB_TOKEN" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  https://api.github.com/user/keys \
  -d "{\"title\":\"$PUBLIC_KEY_NAME\",\"key\":\"$PUBLIC_KEY\"}"

echo "Coder public SSH key uploaded to GitHub!"
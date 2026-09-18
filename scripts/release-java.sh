#!/usr/bin/env bash
# Build, sign and upload the Java SDK to Maven Central through the Central Portal API.
#
# Needs, in the environment: MAVEN_CENTRAL_USERNAME / MAVEN_CENTRAL_PASSWORD (a Central Portal
# user token), MAVEN_SIGNING_GNUPGHOME + MAVEN_SIGNING_KEY_ID (where the signing key lives) and
# MAVEN_SIGNING_PASSWORD. Pass --dry-run to build and bundle without uploading.
set -euo pipefail
cd "$(dirname "$0")/../java"

: "${MAVEN_CENTRAL_USERNAME:?}" "${MAVEN_CENTRAL_PASSWORD:?}" "${MAVEN_SIGNING_GNUPGHOME:?}" "${MAVEN_SIGNING_KEY_ID:?}" "${MAVEN_SIGNING_PASSWORD:?}"

ORG_GRADLE_PROJECT_signingKey="$(GNUPGHOME="$MAVEN_SIGNING_GNUPGHOME" gpg --batch --pinentry-mode loopback \
  --passphrase-fd 0 --armor --export-secret-keys "$MAVEN_SIGNING_KEY_ID" <<<"$MAVEN_SIGNING_PASSWORD")"
export ORG_GRADLE_PROJECT_signingKey ORG_GRADLE_PROJECT_signingPassword="$MAVEN_SIGNING_PASSWORD"

rm -rf build/staging-deploy build/central-bundle.zip
./gradlew -q clean publishMavenPublicationToStagingRepository
unset ORG_GRADLE_PROJECT_signingKey ORG_GRADLE_PROJECT_signingPassword

# Central wants an .md5 and .sha1 beside every file; Gradle writes them for all but the signatures.
find build/staging-deploy -type f ! -name '*.md5' ! -name '*.sha1' ! -name '*.sha256' ! -name '*.sha512' ! -name 'maven-metadata*' |
  while read -r f; do
    [ -f "$f.md5" ] || md5sum "$f" | cut -d' ' -f1 > "$f.md5"
    [ -f "$f.sha1" ] || sha1sum "$f" | cut -d' ' -f1 > "$f.sha1"
  done
(cd build/staging-deploy && find . -name 'maven-metadata*' -delete && zip -qr ../central-bundle.zip io)
unzip -l build/central-bundle.zip | awk 'NR>3 {print $4}' | grep -v '^$' | sed '$d'

[ "${1:-}" = "--dry-run" ] && { echo "dry run: bundle at java/build/central-bundle.zip"; exit 0; }

auth=$(printf '%s:%s' "$MAVEN_CENTRAL_USERNAME" "$MAVEN_CENTRAL_PASSWORD" | base64 -w0)
id=$(curl -sf -H "Authorization: Bearer $auth" -F bundle=@build/central-bundle.zip \
  "https://central.sonatype.com/api/v1/publisher/upload?name=zora-coins-$(grep -m1 '^version' build.gradle.kts | cut -d'"' -f2)&publishingType=AUTOMATIC")
echo "deployment $id"
for _ in $(seq 1 60); do
  state=$(curl -sf -X POST -H "Authorization: Bearer $auth" "https://central.sonatype.com/api/v1/publisher/status?id=$id" |
    python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["deploymentState"], json.dumps(d.get("errors") or {}))')
  echo "$state"
  case "$state" in PUBLISHING*|PUBLISHED*|FAILED*) break ;; esac
  sleep 10
done

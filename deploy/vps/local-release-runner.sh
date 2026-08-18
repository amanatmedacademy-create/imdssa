#!/usr/bin/env bash
set -euo pipefail

JOB_ID="${1:?job id required}"
RELEASE_ID="${2:?release id required}"
BASE=/opt/imds-super-admin
STORE="$BASE/release-bundles"
JOBS="$BASE/local-deploy-jobs"
JOB_DIR="$JOBS/$JOB_ID"
STAGE="$STORE/$RELEASE_ID/stage"
STATUS="$JOB_DIR/status.json"
LOG="$JOB_DIR/deploy.log"
DEPLOY="$BASE/deploy-control-plane.sh"
LOCK=/run/lock/imdssa-local-deploy.lock

mkdir -p "$JOB_DIR"
exec >>"$LOG" 2>&1

write_status() {
  local state="$1"
  local exit_code="${2:-null}"
  local current_release="${3:-null}"
  node - "$STATUS" "$JOB_ID" "$RELEASE_ID" "$state" "$exit_code" "$current_release" <<'NODE'
const fs=require('fs');
const [file,id,releaseId,status,exitRaw,currentRaw]=process.argv.slice(2);
let current={id,releaseId,status,createdAt:new Date().toISOString()};
try{current={...current,...JSON.parse(fs.readFileSync(file,'utf8'))}}catch{}
if(status==='running'&&!current.startedAt) current.startedAt=new Date().toISOString();
if(status==='succeeded'||status==='failed') current.finishedAt=new Date().toISOString();
current.status=status;
current.exitCode=exitRaw==='null'?null:Number(exitRaw);
current.currentRelease=currentRaw==='null'?null:currentRaw;
fs.writeFileSync(file,JSON.stringify(current,null,2)+'\n',{mode:0o640});
NODE
}

write_status running

if ! exec 9>"$LOCK"; then
  write_status failed 70
  exit 70
fi
if ! flock -n 9; then
  echo "Another local deployment is already running"
  write_status failed 75
  exit 75
fi

if [ ! -d "$STAGE" ] || [ ! -f "$STAGE/web/index.html" ] || [ ! -f "$STAGE/api/dist/index.js" ]; then
  echo "Release stage is incomplete: $STAGE"
  write_status failed 66
  exit 66
fi

CURRENT="$(basename "$(readlink -f /var/www/imds-super-admin/current 2>/dev/null || true)")"
if [ -n "$CURRENT" ] && [ "$CURRENT" != "$RELEASE_ID" ]; then
  echo "Creating recovery snapshot for $CURRENT"
  "$BASE/snapshot-control-plane.sh" || true
fi

set +e
"$DEPLOY" "$RELEASE_ID" "$STAGE"
RC=$?
set -e

ACTIVE="$(basename "$(readlink -f /var/www/imds-super-admin/current 2>/dev/null || true)")"
if [ "$RC" -eq 0 ]; then
  write_status succeeded 0 "$ACTIVE"
  exit 0
fi

write_status failed "$RC" "$ACTIVE"
exit "$RC"

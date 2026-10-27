#!/usr/bin/env bash
# Run from the repository in Google Cloud Shell as the existing project's owner.
# This creates a dedicated runtime identity and deploys ONLY the account-admin codebase.
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
tbrn_project='nova-claims-system'
tbrn_service_account="tbrn-account-admin@${tbrn_project}.iam.gserviceaccount.com"
tbrn_role='tbrnAccountPasswords'
tbrn_role_file=$(mktemp)
trap 'rm -f -- "$tbrn_role_file"' EXIT
command -v gcloud >/dev/null
command -v npm >/dev/null
node -e 'if(Number(process.versions.node.split(".")[0])<22){console.error("Use Node.js 22 or newer before deploying.");process.exit(1);}'
if [[ ! -f firebase.account-admin.json || ! -f functions-account-admin/package-lock.json ]]; then
  echo 'Run this script from a complete copy of the scheduling repository.' >&2
  exit 1
fi
tbrn_billing=$(gcloud billing projects describe "$tbrn_project" --format='value(billingEnabled)')
if [[ "$tbrn_billing" != 'True' && "$tbrn_billing" != 'true' ]]; then
  echo 'Deployment stopped. Review and enable the Firebase Blaze plan for nova-claims-system first. This script does not enable billing.' >&2
  exit 1
fi
echo "Deploying the account password service to ${tbrn_project}. No claims, passwords or Firestore rules will be changed by deployment."
gcloud services enable cloudfunctions.googleapis.com run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com iam.googleapis.com --project="$tbrn_project"
if ! gcloud iam service-accounts describe "$tbrn_service_account" --project="$tbrn_project" >/dev/null 2>&1; then
  gcloud iam service-accounts create tbrn-account-admin --project="$tbrn_project" --display-name='TBRN account password service'
fi
if gcloud iam roles describe "$tbrn_role" --project="$tbrn_project" --format=json > "$tbrn_role_file" 2>/dev/null; then
  # Do not silently replace a pre-existing custom role with different permissions.
  node - "$tbrn_role_file" <<'JS'
const fs=require('node:fs');
const current=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const wanted=fs.readFileSync('account-admin-role.yaml','utf8').split('\n').filter(line=>line.startsWith('  - ')).map(line=>line.slice(4)).sort();
if(current.deleted||JSON.stringify((current.includedPermissions||[]).sort())!==JSON.stringify(wanted)){
 console.error('The existing tbrnAccountPasswords role differs from this release. Review it before deploying.');process.exit(1);
}
JS
else
  gcloud iam roles create "$tbrn_role" --project="$tbrn_project" --file=account-admin-role.yaml
fi
gcloud projects add-iam-policy-binding "$tbrn_project" --member="serviceAccount:${tbrn_service_account}" --role="projects/${tbrn_project}/roles/${tbrn_role}" --condition=None >/dev/null
npm ci --prefix functions-account-admin --no-audit --no-fund
npm test --prefix functions-account-admin
npx --yes firebase-tools@15.34.1 deploy --project "$tbrn_project" --config firebase.account-admin.json --only functions:account-admin
echo 'Deployment finished. Refresh the scheduling system, then open Staff access or Contractor access → ⋮ → Set password.'

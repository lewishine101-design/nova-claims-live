# Activate direct admin password changes

The account menus are part of the scheduling website. **Set password** also needs the accompanying Firebase function deployed once to the existing `nova-claims-system` project. Until then, the menu explains that direct password changes need activation and does not accept a new password.

After activation, an Admin / Management user opens **Staff access** or **Contractor access**, selects **⋮ → Set password**, confirms their own current password, and enters the selected account's new password twice. No reset email is generated. **Send reset email** remains a separate explicit choice. On your own row, the first choice is **Change my password**.

## One-time setup for the project owner

1. Open the [existing Firebase project](https://console.firebase.google.com/project/nova-claims-system/overview). In its billing/usage section, check the plan. Cloud Functions deployment requires **Blaze**. Review the pay-as-you-go terms and enable it only if you accept them. The deployment script checks billing and never enables it for you. A small function may fall within no-cost allowances, but this is not a spending cap or a guarantee of zero cost.
2. Open [Google Cloud Shell for this project](https://console.cloud.google.com/home/dashboard?project=nova-claims-system) using the same Google account that owns the Firebase project; select **Activate Cloud Shell** in the top bar.
3. Download the repository into a fresh Cloud Shell directory and deploy the prepared service:

```bash
git clone https://github.com/lewishine101-design/nova-claims-live.git tbrn-password-service
cd tbrn-password-service
nvm install 22
nvm use 22
bash deploy-account-admin.sh
```

If that directory already exists, choose a new directory name or update your existing checkout after reviewing local changes. If `nvm` is unavailable, use an installed Node.js version 22 or newer. If the Firebase CLI asks you to authenticate, complete its Google sign-in; if necessary run `npx --yes firebase-tools@15.34.1 login --no-localhost` and repeat the script. You do not need a service-account key, a Firebase plugin, or a credential pasted into website code.

The script creates the dedicated `tbrn-account-admin` service account and its `tbrnAccountPasswords` IAM role, enables the required deployment APIs and deploys only the `account-admin` functions codebase. It does not deploy Firestore rules or hosting, change the domain, edit claims, or change any person's password. It deliberately stops if an existing custom role has different permissions. Run it as the project owner or an administrator with permission to deploy functions and manage that dedicated IAM identity. First-time Google API enablement or IAM propagation can take a few minutes; repeat the same script after those settle if deployment reports a propagation-related permission error.

4. Wait for `Deploy complete`, refresh the scheduling system, and open **⋮ → Set password** on another registered account. A working service shows the password form. Merely opening the form does not change the password. Validate the first actual change using a designated test account that you control before changing a real colleague's account.

## What runs and where information goes

- `adminAccountPassword` is a Firebase callable Cloud Function in `europe-west2`, using Node.js 22. Its dedicated IAM role can read Auth identities and password policy, update Auth users, and read/create/update Firestore documents for its authorization and audit flow. It has no user-deletion, email-sending or Firestore-deletion permission. IAM permissions apply at project/database level; the function's code limits the documents and operations it actually uses.
- Firebase Auth stores the password credential. The new password is sent over HTTPS to the function for that one operation. It is never written into a claim, user profile, browser workspace, backup, audit record or application log. The app cannot display existing passwords. Browser/password-manager behaviour remains outside the app.
- The service verifies the Firebase ID token including revocation, the caller's current verified `@tbrn.co.uk` Auth account, and its email-bound protected `staffAccess/{uid}` admin role. Setting a password also requires authentication within the last five minutes. An informational profile role or a claimed admin level in a request grants no permission.
- The target must be the exact selected UID, with matching registered profile and Auth email, an enabled email/password account, and a different UID from the administrator. Self changes use the existing current-password flow. Project password requirements are checked on the server, with a minimum of 12 characters for admin-set passwords. An unavailable policy lookup stops the operation.
- Server-only Firestore collections `adminAccountActions` and `adminAccountLocks` record the actor UID, target UID, request/status/timestamps and a two-minute per-target cooldown. No password or password hash is stored there. The repository's existing catch-all deny rule prevents browser access; no new rules are required. This assumes those protected rules are published as previously confirmed by the project owner. The records are operational audit data, not an immutable regulatory archive, and no automatic audit-retention deletion is configured.
- The target's refresh tokens are revoked after the update. Already issued ID tokens may remain valid until they expire; this is not immediate remote erasure of browser drafts. Partial revocation/audit failures are reported as such without pretending that the password change failed. An uncertain network result is never shown as a successful change.
- Only the configured custom domain and its `www` alternate receive browser CORS permission. CORS is not authorization. The HTTPS endpoint is publicly reachable so Firebase clients can call it; every privileged request must pass the server checks. App Check is not configured or claimed by this release. `minInstances: 0` and `maxInstances: 2` limit idle provisioning/scaling, not total spend.

## Verification and troubleshooting

This release passed 402 application checks, 34 server-unit tests, and 14 integration checks using local Firebase Auth, Firestore, and the actual callable HTTP handler. Integration checks cover the full admin form, rejecting incorrect admin passwords, invalidating the old target password, accepting the new one, creating no reset-email action, keeping claims/profiles unchanged, rejecting non-admin/revoked tokens, protecting audit data, concurrent changes, and the custom-domain CORS response. The emulator lacks project password-policy configuration; only that adapter is substituted there, with policy enforcement/failure tested separately. No production account password or mailbox was used.

To repeat checks from the repository root:

```bash
node tests/run-app-tests.cjs
npm ci --prefix functions-account-admin
npm test --prefix functions-account-admin
npm ci --prefix tests
npx --yes firebase-tools@15.34.1 emulators:exec --project demo-tbrn-account-admin --config firebase.account-admin.json --only auth,firestore "node tests/account-settings.integration.cjs index.html"
```

The integration test starts its own local callable HTTP listener on port 5007 and refuses non-local Auth/Firestore endpoints or a non-demo project. The emulator command requires Java as described in the Firebase Emulator Suite documentation. None of these test commands deploy the service.

If the menu says the service needs activating after deployment, check that `adminAccountPassword` is present in `europe-west2` in project `nova-claims-system`, the dedicated service account has its custom IAM role, and the function logs show successful startup. If it reports account or admin access changes, refresh the account list/sign-in and verify the protected role and exact `users/{uid}` email in Firebase. An account with no registered profile will need its profile repaired before this action is available. Do not weaken Firestore rules to fix Auth or function deployment errors.

Official references: [Admin user management](https://firebase.google.com/docs/auth/admin/manage-users), [callable functions](https://firebase.google.com/docs/functions/callable), [deployment and the Blaze requirement](https://firebase.google.com/docs/functions/get-started), [custom runtime service accounts](https://firebase.google.com/docs/functions/manage-functions#set_a_service_account), [Auth IAM permissions](https://firebase.google.com/docs/projects/iam/roles-predefined-product#auth), and [Firestore IAM permissions](https://docs.cloud.google.com/firestore/native/docs/security/iam).

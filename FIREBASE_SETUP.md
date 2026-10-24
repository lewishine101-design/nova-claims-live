# TBRN staff access — activation

Staff access uses the app and its Firestore rules together. For a new setup, complete the steps below before enabling staff levels. A Firebase plugin is not required.

Use the existing **nova-claims-system** project. The separate contractor-map project is outside this change.

## 1. Set the first management account

Open [the Firebase project](https://console.firebase.google.com/project/nova-claims-system/overview) in your normal browser with the Google account that manages this project.

1. Open **Authentication → Users**. Find the existing TBRN account that should manage staff access and copy its **User UID**. Use a verified `@tbrn.co.uk` account.
2. Open **Firestore Database → Data** and select the default database.
3. Add a collection named **staffAccess**. For the document ID, paste that exact User UID; do not use Auto ID.
4. Add these two fields, both with type **string**, then save:

| Field | Value |
| --- | --- |
| `email` | That account’s exact TBRN sign-in email, in lowercase |
| `level` | `admin` |

This one-time step must be done by the Firebase project owner. Selecting management on the registration form only requests access; it cannot approve the request.

If other existing staff must keep schedule-editing access immediately, add a document for each of their Authentication UIDs with their email and `level` set to `surveyor` or `admin`. Verified TBRN accounts without a role document receive Claims Concierge access after activation.

## 2. Publish the database rules and release the app

Coordinate these steps in one release window. Existing staff should save their work first. The older app does not understand the new levels and may show actions the new rules reject.

1. In **Firestore Database → Rules**, save a copy of the currently published rules for reference. The deployed rules have not been verified from this development environment.
2. Open [firestore.rules](./firestore.rules) from this update. Copy the entire file, replace the rules editor contents, and click **Publish**.
3. Tell Codex that the first management account is set up and the rules are published. The prepared staff-access branch can then be released to the main app. Publishing the app does not publish Firebase rules automatically.
4. Once the app release is complete, reload it and sign in with the management account. Open **Staff access**, review the requested levels, choose the appropriate level, and select **Save access** for each staff member.
5. Check the account label, all-claim search, and permissions using one account of each level. Rules changes can take up to a minute for new requests and up to ten minutes for existing listeners; reload/sign in again for this check.

These rules do not rewrite existing claims, rates, saved versions or contractor records. The release uses the existing Firebase Authentication accounts.

## Permissions

| Capability | Claims Concierge | Surveyor / Reviewer | Admin / Management |
| --- | --- | --- | --- |
| Search and view all claims, schedules, rates, reports and saved versions | Yes | Yes | Yes |
| View the contractor directory | Yes | Yes | Yes |
| Create blank claims; edit claimant/property details and assignments | Yes | Yes | Yes |
| Build/amend schedules, room dimensions, pricing and construction plans | No | Yes | Yes |
| Submit/approve schedules; start variations; duplicate or import schedules | No | Yes | Yes |
| Edit/import the rate library | No | No | Yes |
| Approve/change staff access | No | No | Yes |
| Delete live claims or change database system settings | No | No | Yes |

Concierges may assign a Draft claim to a contractor; subsequent schedule status changes require a Surveyor / Reviewer or management. New claims still require both a TBRN Claims Concierge and TBRN Reviewer/Surveyor in the assignment section.

Contractors retain their existing access to assigned claims and permitted schedule changes. They cannot create claims, list all claims, change assignments, access the contractor directory or manage staff.

## Contractor access

Admin / Management accounts have a **Contractor access** tab directly below **Staff access**. It lists registered contractor profiles, supports searching by company or sign-in email, and shows the live claims assigned to a selected account. Open a claim from that list to review or change its assignment. The tab and its actions are unavailable to other access levels. This page uses the existing permissions and does not require another rules update.

### Live Hub contact details and availability

Contractor access reads contact email addresses, phone numbers, availability and on-hold notes from the TBRN Hub. Edit these in the Hub; server-confirmed changes appear automatically while the Contractor access page is open. Search also includes Hub contact emails, phone numbers and availability.

- The source is project `tbrn-live-intranet`, document `tbrnSharedState/state`. The reader extracts `tbrn-directory-2-general` and `tbrn-directory-emergency-specialist` from the shared `values` map. The legacy emergency key is used only when the current key is absent. Surveyor and other Hub data is not retained.
- A separate named Firebase app uses the Hub's existing anonymous authentication flow with in-memory persistence. Scheduling does not write Hub records or copy them into the claims database or browser storage. The Hub's existing security rules govern this connection; Scheduling staff-role rules do not apply to the separate Hub project.
- Accounts match by an exact contact email, or by a unique normalised company name when no email matches. Duplicate/conflicting matches and missing matches are shown explicitly. A Hub listing does not register a Scheduling account.
- The four statuses remain distinct: **Available**, **On hold**, **On hold (limited services)** and **On hold (INS & LBG)**. Legacy `hold` and `taking` values are supported. Unrecognised statuses require checking in the Hub.
- The sign-in email and existing claim assignments are not changed by a contact or availability update. On hold is an allocation status, not an account suspension. The existing Contractor directory/map integration is unchanged by this account-page feature.
- Cached snapshots are not described as live. Connection failures show a retry action and label any retained in-memory details as last confirmed. Leaving the page, changing account or losing Admin access closes the listener and clears these details.

No additional Firestore rules publication is needed for this read-only integration. The Hub read path was checked against its existing live data; authenticated Scheduling browser verification still requires an Admin account.

## How staff levels are protected

- `users/{uid}.requestedStaffLevel` records the registration request only. Existing display roles in profiles grant no permissions.
- `staffAccess/{uid}` holds the approved `email` and `level`. Database rules restrict changes to management and bind each role to the account UID and email.
- Role changes made in the app also record `updatedBy` and `updatedAt`. An administrator cannot demote or remove their own role through the app.
- The app checks roles with Firebase before enabling staff edits and listens for changes. If verification fails, editing pauses while viewing remains available.
- Concierge saves write only claim administration fields. Existing schedules, aliases, precision, construction plans and history remain unchanged. The database also rejects direct attempts to bypass these restrictions.

## Existing storage and sign-in behaviour

Live claims remain in Firestore; local drafts and the current rate-library overrides remain in browser storage and backups. This change does not add central synchronisation of browser rate overrides. Signing out hides claim/report content but does not encrypt or erase local drafts.

The dedicated login page, Remember me, password recovery, email verification, claim links, schedule versions and change reports remain available. Verification/reset messages are sent only through the existing Firebase actions; a successful request does not confirm delivery.

If a management user has no `users/{uid}` profile because an older signup failed to save it, that account can still use its protected role. To make it appear in the staff list, the Firebase owner can add a profile using the same UID with string fields `email` (the account email) and `role` (`staff`). Do not put access levels in profile authority fields.

## Validation

213 application checks passed. The unchanged Firestore rules have 121 passing emulator checks from the staff-level release. They cover existing features, role loading, account switching, signup requests, management approvals, legacy metadata saves, direct write bypasses, privilege escalation, contractor isolation, Hub matching, live updates, stale responses and connection failures. Application test claims and profiles are synthetic; no production claims were changed and no real emails were sent. The separate read-only live Hub check used a temporary anonymous session, removed afterwards. The Firebase rules publication was confirmed by the project owner; it has not been independently inspected, and authenticated Scheduling browser verification still requires an Admin account.

Official Firebase guidance: [manage and deploy rules](https://firebase.google.com/docs/rules/manage-deploy), [rules propagation](https://firebase.google.com/docs/firestore/security/get-started), and [manage Firestore data in the console](https://firebase.google.com/docs/firestore/using-console).

To repeat the application checks, run `node tests/run-app-tests.cjs` from the repository root. For database checks, run `npm ci` in `tests`, then `npm run test:rules`. The rules suite uses only the `demo-tbrn-*` emulator projects and requires Java. These commands do not deploy anything.

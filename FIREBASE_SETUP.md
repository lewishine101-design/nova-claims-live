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
| Submit/approve schedules; start variations; duplicate schedules | No | Yes | Yes |
| Edit/import the rate library | No | No | Yes |
| Approve/change staff access | No | No | Yes |
| Open Data & backup; export/import JSON backups; recover browser records | No | No | Yes |
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

## New claim reference format

New claim references use one pair of square brackets: entering `2321678` saves `[2321678]`. The brackets appear when the reference field is left and are also applied before a new draft is first saved live. Duplicate-from-code uses the same format. Already bracketed input is not wrapped again, and an empty reference remains invalid.

Existing live references and document IDs are preserved. Reference lookup accepts the bracketed and unbracketed forms while keeping contractor assignment checks and exact-document opens. New live creation checks for a legacy unbracketed document before writing, and duplicate-reference checks treat the two forms as the same reference. Reports and email links use the stored reference.

## Deleting claims — Admin / Management

Verified TBRN Admin / Management accounts can open the **three-dot Claim settings menu** at the far right of a row in **All claims**, then select **Delete claim**. The same menu sits beside Save in **Claim details**. Delete is hidden until this menu is opened; its existing typed confirmation is still required. The menu supports keyboard operation and closes when clicking elsewhere, pressing Escape, scrolling, changing pages or losing admin access. Other staff levels and contractors have no claim settings or live-claim deletion control. The existing Firestore `claims/{claimId}` rule also permits deletion only through `admin()`; this feature requires no new rules publication.

The confirmation loads the current claim from the server, displays its reference, claimant, property and saved-version count, and requires the displayed reference to be typed. A transaction checks that the exact document has not changed since that confirmation before deleting it. Closing the dialog, changing accounts, losing the admin role, failing a server read or receiving a permission error prevents an unconfirmed deletion. An active live save and duplicate confirmation clicks are guarded.

Deletion removes the live claim document, including its current schedule and saved schedule versions, and clears linked clean copies and unsaved drafts from the current browser by exact document ID. It does not remove unrelated claims that happen to share the same reference. The app returns to All claims; deleting the last cached claim leaves a blank local workspace without creating a new live claim. A stale cached live record cannot recreate a deleted document through Save to live.

Local-only drafts use **Delete draft** and do not delete a separate live document. Deletion has no in-app undo. Downloaded reports, exported backups, legacy browser records and copies on other devices are not remotely erased. If the cloud deletion succeeds but local storage fails during cleanup, the app reports that distinction. Testing uses synthetic claims; production claims are not deleted during release verification.

## Existing storage and sign-in behaviour

### Password help and changes

Admin / Management accounts have a **three-dot Account settings menu** at the far right of each registered account on **Staff access** and **Contractor access**. **Send reset email** remains an explicit choice in that menu. The confirmation identifies the account's sign-in email; contractor Hub contact emails are never substituted. Sending rechecks the protected admin role and the selected `users/{uid}` profile using server reads, then requests a Firebase password reset email. It leaves the administrator signed in and does not assign a temporary password. The recipient chooses their own new password through the secure email link. The app prevents repeated submissions and adds a short retry delay. A successful request does not confirm delivery or the existence of an active Auth account when email enumeration protection is enabled; users may need to check junk and email quarantine.

**Direct password setting needs one-time activation:** the separate **Set password** menu choice is wired to `adminAccountPassword` in the existing Firebase project. It shows no editable password fields until the server confirms that the service, admin role, selected account and password policy are available. See [ACCOUNT_PASSWORD_SETUP.md](ACCOUNT_PASSWORD_SETUP.md) for the prepared deployment script, Blaze requirement, IAM permissions, data handling and tests. The website/menu release alone does not deploy this backend or enable billing. After activation, admins can confirm their own password and set a different account's new password directly, without emailing the account holder. On the administrator's own row, **Change my password** opens the existing self-change form.

All verified signed-in users, including contractors, can select their account at the top right, then **Change password**. They enter their current password, a new password and matching confirmation. The app checks the Firebase project's password policy, reauthenticates the current account and updates that same account's password. Password fields are cleared on completion, cancellation and account changes. Passwords are never added to claim data, Firestore profiles, browser workspace storage or backups. Browser/password-manager behaviour remains outside this app.

Admin reset controls are restricted in the application and recheck the protected role; Firebase's password-reset-email endpoint remains a recovery service also used by **Forgot password**. The separate **Set password** action uses the new trusted server described below; it never sends a reset email or exposes an Admin SDK credential. Existing passwords cannot be viewed. Authentication is managed by Firebase Auth, not Firestore security rules. No rules publication is needed. Reset emails retain Firebase's default action handler, avoiding an unapproved custom return URL. Production password changes and email delivery have not been exercised during release verification.

Live claims remain in Firestore; local drafts and the current rate-library overrides remain in browser storage and backups. This change does not add central synchronisation of browser rate overrides. Signing out hides claim/report content but does not encrypt or erase local drafts.

**Data & backup is restricted to verified TBRN Admin / Management accounts.** The Manage group and navigation entry start hidden and appear only after the protected staff role is confirmed. Navigation, page rendering, workspace and claim JSON exports, backup selection/preview/commit and browser-record recovery all enforce the same requirement. A role downgrade, failed role check or account switch closes an open backup preview and clears the pending import; an asynchronous file read cannot carry an import into another session. Existing schedule/report viewing, CSV exports and PDF printing keep their claim-access permissions. These controls apply to the app's management section; browser-local data is still unencrypted as described above. No database rule changes are required.

### One saved entry per live claim

Opening a live claim refreshes its existing local copy by its exact Firestore document ID. It no longer appends another copy on each open. The **Saved on this device** list and recent claims show one entry per live document, using the most recent confirmed copy. Extra clean cached copies from older app versions are consolidated when signing in or reopening/saving the live claim. Separate document IDs and independent local drafts are not merged merely because they have the same reference.

Unsaved edits are preserved and grouped under **Local drafts** for their claim. They can be reviewed and opened explicitly. Opening the regular claim entry requests the current server version, so an earlier **Ready for review** copy does not replace the subsequently approved schedule. A network or storage failure keeps the saved work and reports the failure; it does not silently open a stale copy as the latest live claim. Existing concurrency and approval checks continue to prevent a stale draft overwriting newer live work.

Schedule history and variations remain inside the live claim, unchanged. This repair changes local caching and display; it does not delete or merge live Firestore documents and requires no rules update.

The dedicated login page, Remember me, password recovery, email verification, claim links, schedule versions and change reports remain available. Verification/reset messages are sent only through the existing Firebase actions; a successful request does not confirm delivery.

If a management user has no `users/{uid}` profile because an older signup failed to save it, that account can still use its protected role. To make it appear in the staff list, the Firebase owner can add a profile using the same UID with string fields `email` (the account email) and `role` (`staff`). Do not put access levels in profile authority fields.

## Validation

402 application checks passed, including 32 direct-password/menu checks and 43 existing password-management checks for account targeting, permissions, password policy, reauthentication, cancellation, account changes, duplicate submissions, failure messages and credential cleanup, plus 23 reference-format checks for new input, first save, duplicates, existing references, legacy collisions, search, links and assigned-contractor lookup. They include 38 claim-deletion checks for permissions, typed confirmation, exact document targeting, concurrent changes, failed reads/writes, role changes, duplicate submissions, local cleanup and stale-copy saves. The 94 staff-role Firestore emulator checks passed again for the preceding deletion release, including allowed management deletion and denied deletion by other staff levels. The unchanged Firestore rules also have 121 passing emulator checks from the staff-level release. They cover existing features, role loading, account switching, signup requests, management approvals, legacy metadata saves, direct write bypasses, privilege escalation, contractor isolation, Hub matching, live updates, stale responses and connection failures. The claim-cache regression reproduces contractor submission followed by approval in separate synthetic browsers, repeated opens, legacy cached duplicates, draft preservation and stale-write rejection. Data & backup checks cover every access level, direct action guards, page restoration, role changes, pending reads and normal admin exports/imports/recovery. Application test claims and profiles are synthetic; no production claims were changed and no real emails were sent. The separate read-only live Hub check used a temporary anonymous session, removed afterwards. The Firebase rules publication was confirmed by the project owner; it has not been independently inspected, and authenticated Scheduling browser verification still requires an Admin account.

Official Firebase guidance: [manage and deploy rules](https://firebase.google.com/docs/rules/manage-deploy), [rules propagation](https://firebase.google.com/docs/firestore/security/get-started), and [manage Firestore data in the console](https://firebase.google.com/docs/firestore/using-console).

To repeat the application checks, run `node tests/run-app-tests.cjs` from the repository root. For database checks, run `npm ci` in `tests`, then `npm run test:rules`. The rules suite uses only the `demo-tbrn-*` emulator projects and requires Java. These commands do not deploy anything.

Password implementation follows the official Firebase [user management](https://firebase.google.com/docs/auth/web/manage-users) and [password validation](https://firebase.google.com/docs/reference/js/auth#validatepassword) APIs.

Five local Firebase Auth emulator checks passed for incorrect current passwords, changing a password, invalidating the old password, sending a reset for the selected user, retaining the admin session and completing that reset. The installed Auth emulator does not implement `getPasswordPolicy`; that call is stubbed only in the emulator test, with validation outcomes covered separately by the application suite. No production users or mailboxes were used.

To repeat these Auth checks from the repository root: `cd tests`, then `npx firebase emulators:exec --only auth --project demo-tbrn-password-tools --config ../firebase.password-tools.json "node password-tools.auth.cjs ../index.html"`. The test refuses any Auth endpoint except the configured local emulator.

The account-admin service also passed 34 server-unit tests and 14 local Auth/Firestore/callable integration checks. These include exact target identity, fresh protected-role checks, revoked tokens, policy enforcement, concurrent operations, server-only audit data, new/old password sign-in behavior and absence of reset-email actions. The emulator policy configuration adapter is substituted because the Auth emulator lacks that endpoint; server enforcement is separately tested. Production backend deployment and production password changes remain unverified until the project owner activates the service.

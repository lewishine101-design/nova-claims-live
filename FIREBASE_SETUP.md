# TBRN claims workspace — Firebase setup

Live app: https://lewishine101-design.github.io/nova-claims-live/

## Publish the replacement rules

The previous Firestore test-mode rule expired on 12 July 2026. The replacement `firestore.rules` removes the date limit and enforces the app permissions.

1. Open the Firebase console and select **nova-claims-system**.
2. Open **Firestore Database → Rules**.
3. Replace the entire editor contents with `firestore.rules` from this repository.
4. Choose **Publish**. Allow up to a minute for new requests to use the new rules.
5. Refresh the live app and sign in. If asked, select **Send verification email**, follow its link, then return and select **I’ve verified my email**.
6. For a new claim, enter both the **TBRN Claims Concierge** and **TBRN Reviewer/Surveyor** in **Assignment & progress**, then choose **Save to live**.

Publishing GitHub Pages updates the app only. It does not publish Firestore rules. These rules must be published in Firebase separately. They target the `nova-claims-system` database, not the separate contractor-map project.

## Login home

The live app opens on a dedicated TBRN sign-in page. It supports staff and contractor sign-in, account creation, password recovery, and email verification. Existing accounts continue to use the same Firebase Authentication project.

- **Remember me** keeps Firebase sign-in across browser restarts. Leave it unticked on shared computers; otherwise the session lasts for the current browser session.
- A verified remembered account restores directly into the workspace. During restoration, claim content stays hidden. Connection failures show a retry action.
- Emailed `?claimRef=` links open the linked claim after successful sign-in and verification, subject to the account’s claim permissions.
- Signing out returns to the login page and clears displayed claim/report content. Existing local drafts remain in browser storage; this UI change does not encrypt or erase the local cache.
- Verification and password-reset messages are requested through Firebase only when the user selects the corresponding button. Request acceptance does not confirm email delivery.

The login page does not replace Firestore rules. Publish and verify the database rules separately as described above.

## Access

After signing in, TBRN staff can open **All claims** to search the shared live claim list by full or partial reference, claimant, address or postcode. The staff view defaults to **All live claims**; results are not restricted to the claim creator, concierge, reviewer or assigned contractor. **Find claim** opens this shared search, and **Refresh** retrieves the latest list.

**Local drafts** are only stored in the current browser. Use **Save to live** before other staff can find a new claim from another computer.

- Verified `@tbrn.co.uk` accounts have staff access to all claims, contractor records, rates and settings.
- Verified contractor accounts can open assigned claims by reference and save permitted schedule changes. They cannot list all claims, create/delete claims, reassign contractors, edit the TBRN team or access the contractor directory.
- New live claims require both TBRN assignments. Existing records that predate both fields can still be saved; once assigned, both roles must stay populated.
- Contractors cannot approve schedules, reopen submitted schedules, change submitted schedule items/pricing or replace an issued copy code.
- Display roles in user profiles do not grant access. Email verification is required before live claims can be read or saved.
- Existing claim records are not rewritten by publishing these rules.

The live app retains the original rate values and claim compatibility fields. Rules and application checks were exercised locally with test records; no production claim writes or contractor emails were used during validation.

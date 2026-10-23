# Nova Scheduling installation

Nova Scheduling can be installed from its HTTPS website and launched in a standalone window. The installed workspace has no normal browser address bar. Opening an ordinary website link can still open a browser tab.

## Install

- **Windows or macOS:** open the website in Chrome or Edge and select **Install app** on the sign-in page or in the workspace menu. Confirm the browser prompt, then launch Nova Scheduling from the desktop, Start menu or applications. If a native prompt is unavailable, the button shows browser-menu instructions.
- **Android:** open the website in Chrome and select **Install app**. Chrome's menu also offers installation or **Add to Home screen → Install**.
- **iPhone or iPad:** open the website in Safari, choose **Share → Add to Home Screen**, keep **Open as Web App** enabled when shown, and tap **Add**. Launch using the new home-screen icon.

The installation is per device. Sign in with the existing account. Live claims, rates and role permissions use the existing system. Unsaved browser-local drafts are not automatically transferred between browser profiles or devices; save a claim live or export a backup before switching.

An internet connection is required to load the system, sign in and access live claims. Installation does not provide offline claim access.

## Implementation

- `manifest.webmanifest` defines the app name, relative identity/start/scope, standalone display and TBRN launcher icons.
- Relative asset URLs work under the current GitHub Pages directory and a renamed directory.
- A native installation prompt is shown only following a user's click. Browsers without that prompt receive instructions. Installation controls are hidden in an app window.
- `sw.js` handles only GET navigations to this app's directory or `index.html`. It fetches the live document on every launch; failed navigation shows a generic connection-help page. It does not use CacheStorage, store the app shell, intercept Firebase/account APIs, or add claim/credential caching. Existing app storage is unchanged.
- There is no forced page reload or automatic installation. Existing claims and rate data are unchanged.

## Verification

Run from the repository root:

```sh
node tests/pwa.cjs
node tests/login-home.cjs
node tests/schedule-versions.cjs
node tests/schedule-changes.cjs
node tests/staff-access.cjs
```

The 24 installation checks cover native-prompt lifecycle, browser guidance, standalone detection, worker scope and navigation failures, asset sizes and relative paths. The 95 existing checks cover login, staff/contractor permissions, schedule versioning and change reports. Authentication, email and claim APIs are mocked; these checks do not sign in to production, send emails or write live claims.

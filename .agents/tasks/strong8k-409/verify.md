# Strong8K IPTV — HTTP 409 Fix Verification

## Root cause

The server returns HTTP 409 because:
1. No session cookie existed — the server requires a session established by a prior `GET /trial`.
2. The server may also require a hidden CSRF `_token` from the GET page HTML echoed back in the POST body.

The previous fix corrected the encoding (JSON → form-encoded, resolving HTTP 400) but did not prime the session, causing HTTP 409.

## What changed

**File:** `backend/src/services/world-services/strong8kiptv.js`

- Updated JSDoc to document the new GET-then-POST flow.
- Added `get` and `extractCsrfToken` to the import from `../../http/cookieClient.js`.
- Added **Step 1**: `GET /trial` to prime session cookies and extract `_token` (if present).
- If no `_token` is found, a note is logged and the POST proceeds without it.
- POST body now conditionally includes `_token` when found.
- All other logic (meta, POST fields, inbox polling, result building) is unchanged.

## Diff summary

```diff
- import { createJar, post } from "../../http/cookieClient.js";
+ import { createJar, get, post, extractCsrfToken } from "../../http/cookieClient.js";

+ // Step 1: GET /trial — prime session cookies and extract CSRF token.
+ const { text: trialPage, status: getStatus } = await get(TRIAL_URL, jar);
+ if (getStatus >= 400)
+   throw new Error(`[${TAG}] Failed to load trial page (HTTP ${getStatus}).`);
+ const token = extractCsrfToken(trialPage);
+ if (!token) log(`[${TAG}] No CSRF _token found — proceeding without it.`);

  // Step 2: Submit the trial form (form-encoded, not JSON).
  const postBody = {
    format: "m3u",
    m3u: "m3u",
    mac: "",
    package: "83106",
    email: email.trim(),
  };
+ if (token) postBody._token = token;

- const { status } = await post(TRIAL_URL, jar, { format: ... }, TRIAL_URL);
+ const { status } = await post(TRIAL_URL, jar, postBody, TRIAL_URL);
```

## Verification evidence

### 1. Syntax check
```
node --check src/services/world-services/strong8kiptv.js
```
**Result:** no output, exit code 0 ✅

### 2. Module load + interface smoke test
```
node -e "import('./src/services/world-services/strong8kiptv.js').then(m=>{const s=m.default; if(s.meta.id!=='strong8kiptv'||typeof s.execute!=='function') throw new Error('bad interface'); console.log('interface ok: '+s.meta.id);})"
```
**Result:** `interface ok: strong8kiptv` ✅

### 3. Import line inspection
```javascript
import { createJar, get, post, extractCsrfToken } from "../../http/cookieClient.js";
```
`get` and `extractCsrfToken` are both present alongside `post` ✅

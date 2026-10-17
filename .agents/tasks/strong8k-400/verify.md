# Strong8K IPTV — Verification Note

## What changed

`backend/src/services/world-services/strong8kiptv.js` was rewritten to use
the form-encoded `post` helper from `cookieClient.js` instead of the JSON
`jsonPost` helper (via `simplePost`).  The trial endpoint at
`https://strong8kiptv.co/trial` is a classic HTML form handler
(`application/x-www-form-urlencoded`); sending a JSON body caused every
required field to be unbound, producing an HTTP 400.

## Checks run (all in `backend/`)

### 1. Syntax / parse

```
node --check src/services/world-services/strong8kiptv.js
```

**Result:** no output, exit code 0 ✅

### 2. Module load + interface contract

```
node -e "import('./src/services/world-services/strong8kiptv.js').then(m=>{const s=m.default; if(s.meta.id!=='strong8kiptv'||typeof s.execute!=='function') throw new Error('bad service interface'); console.log('interface ok: '+s.meta.id);})"
```

**Result:** `interface ok: strong8kiptv`, exit code 0 ✅

### 3. Registry resolves the service

```
node -e "import('./src/engine/registry.js').then(r=>{ if(!r.getService('strong8kiptv')) throw new Error('not registered'); console.log('registered');})"
```

**Result:** `registered`, exit code 0 ✅

### 4. Import check (no simplePost/jsonPost, correct form helpers used)

```
grep -n "simplePost\|jsonPost" backend/src/services/world-services/strong8kiptv.js
```

**Result:** no matches ✅

```
grep -n "cookieClient" backend/src/services/world-services/strong8kiptv.js
```

**Result:** `import { createJar, post } from "../../http/cookieClient.js";` ✅

## What `backend/package.json` provides

Scripts: `start`, `dev` only.  No `test` script.  `vitest` is listed as a
devDependency but there are no `*.test.js` / `*.spec.js` files, so there is
no test suite to run.

## Live-run verification (NOT performed — per task constraints)

Full end-to-end verification requires an outbound request to
`https://strong8kiptv.co/trial`.  The task constraints explicitly forbid
this.  To verify the 400 is resolved, a reviewer should run:

```
# start the backend, then trigger the strong8kiptv service via the UI or API:
cd backend
node src/server.js
# POST a task selecting service id "strong8kiptv" with a valid temp-email provider
```

Expected outcome: no `❌ Strong8K IPTV: HTTP 400` warn line; service proceeds
to poll inbox and either returns a result or times out waiting for the
credentials email (a timeout means the POST was accepted).

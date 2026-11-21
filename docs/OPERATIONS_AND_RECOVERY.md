# आज का प्रहरी (AKP News) — Operations, Storage Safety & Recovery Runbook

This document defines production operational safeguards, fail-closed JSON storage rules, backup/restore procedures, and administrator credential rotation & lockout recovery workflows for **STORAGE_DRIVER=json** deployments.

> **Security Note:** Never store real passwords, `scrypt` hashes, session tokens, API keys, or production database credentials in documentation or Git repositories.

---

## 1. JSON Persistence Architecture & Storage Safety

### Storage Paths & Working Directory Requirement
- **Editorial Data Store:** `<cwd>/data/store.json` (resolved via `path.join(process.cwd(), 'data', 'store.json')` in `server/store.ts`).
- **Admin Auth & Sessions Store:** `<cwd>/data/auth-store.json` (resolved via `path.join(process.cwd(), 'data', 'auth-store.json')` in `server/auth/authStore.ts`).
- **Required Working Directory (`cwd`):** The production Node.js process (`npm start` / `node dist/server.cjs`) **MUST** always be launched from the application root containing both `dist/` and the persistent `data/` mount.
- **Initialization Warnings:** When `<cwd>/data` or `store.json` / `auth-store.json` does not exist on startup, the server logs `[STORAGE_WARNING]` / `[STORAGE_INIT]` / `[AUTH_STORAGE_INIT]` with the resolved path and `process.cwd()`. Operators should treat unexpected initialization warnings in production as a misconfigured working directory or unmounted volume.

### File Permissions & Atomic Writes
- Both `data/store.json` and `data/auth-store.json` use `atomicWriteFileSync()` (`server/utils/atomicFile.ts`): write full payload to a unique temp file in `data/`, call `fs.fsyncSync()`, close the file descriptor, atomically `rename()` over the target file, and enforce `0o600` (`-rw-------`) permissions.
- All `auth-store.json` mutations are serialized via `withAuthWriteLock` to prevent lost writes across concurrent async `scrypt` hashing operations.

### Fail-Closed Corruption Handling
The server strictly distinguishes:
1. **First-install missing file:** Initializes default seed (`store.json`) or empty auth store (`auth-store.json`) with `0600` permissions.
2. **Existing valid JSON:** Validates root schema (`articles` array in `store.json`; `users` and `sessions` arrays in `auth-store.json`) and loads into memory.
3. **Existing malformed JSON or invalid structure:** Sets an internal failed-load lock, preserves the corrupted file untouched on disk, refuses default/empty fallback, refuses to enable `/api/admin/bootstrap`, logs a sanitized error (`StoreStorageError` / `AuthStorageError`, zero file contents or secrets), and aborts startup (`process.exit(1)`).
4. **Filesystem/permission read error:** Fails closed with the same preservation guarantee; scheduled saves, shutdown flushes, and resets will refuse to overwrite the file while in a failed state.

### Single-Instance Limitation & Debounced Write Window
- **Single-Instance Requirement (`max_instances = 1`):** Both `store.ts` and `authStore.ts` maintain in-process memory caches, and `rateLimit.ts` stores brute-force lockout buckets in memory. Do **not** run multiple application replicas against `STORAGE_DRIVER=json`; horizontal scaling requires migrating to PostgreSQL in Phase D.
- **300ms Debounced Editorial Flush:** Content mutations in `server/store.ts` persist via `scheduleSaveStore()` (300ms debounce). A hard crash (`SIGKILL` / power loss) within 300ms of an editorial write can drop that pending change. Always use graceful shutdown (`SIGTERM` / `SIGINT`), which triggers `flushScheduledSave()` before closing.

---

## 2. Safe Service Shutdown

1. Send `SIGTERM` (preferred) or `SIGINT` to the running Node.js process.
2. `server.ts` executes `flushScheduledSave()` synchronously to persist any pending debounced `data/store.json` changes, then closes the HTTP server cleanly (`exit 0`).
3. Verify no `.tmp` files remain in `data/` before taking cold snapshots or updating deployment artifacts.

---

## 3. Data Backup Requirements & Manual Restoration Procedure

### Backup Requirements
- **Critical Files:** Both `data/store.json` and `data/auth-store.json` (plus persistent volume snapshot).
- **Frequency:** Every 6 hours minimum (or hourly during active newsrooms), plus mandatory pre-deploy and pre-reset snapshots.
- **Encryption & Permissions:** `data/auth-store.json` contains `scrypt` password hashes and session hashes. Encrypt all off-host backups at rest (e.g., KMS/AES-256 or GPG) and enforce `0o600` permissions on staging/restored files.
- **Integrity Verification:** Compute and store a `sha256sum` manifest and validate JSON parsability (`JSON.parse`) after every snapshot.

### Manual Restoration Procedure
1. **Stop the service gracefully:** Send `SIGTERM` and confirm the process has exited.
2. **Preserve current state:** Move current `data/store.json` and `data/auth-store.json` to an incident directory with `0600` permissions (never delete immediately in case forensic inspection is required).
3. **Decrypt & validate backup:** Extract the encrypted backup into a restricted `0700` staging directory, verify `sha256sum`, and verify valid JSON (`articles` array in `store.json`; `users`/`sessions` arrays in `auth-store.json`) without printing contents to logs.
4. **Place files & set permissions:** Copy validated files into `<app-root>/data/` and run:
   ```bash
   chmod 600 data/store.json data/auth-store.json
   ```
5. **Start & verify:** Boot `NODE_ENV=production node dist/server.cjs`, verify `GET /healthz` returns HTTP `200`, check public articles and draft protection (`404` for drafts), and verify admin login.

---

## 4. Corrupted JSON Recovery

1. **Do NOT delete the corrupted file.** Stop any crash-looping service supervisor.
2. Inspect the sanitized startup log (`[STORAGE_ERROR]` or `[AUTH_STORAGE_ERROR]`) to identify which file failed (`store.json` vs `auth-store.json`) and whether it is a permission error (`EACCES`) or malformed JSON (`CORRUPTED_JSON`).
3. Copy the corrupted file to an isolated backup path (`0600`) before attempting repair.
4. Either restore the latest verified encrypted backup (Section 3) **or** repair the JSON syntax carefully in an isolated offline check, validate with `node -e 'JSON.parse(require("fs").readFileSync(...))'`, enforce `chmod 600`, and restart cleanly.

---

## 5. Admin Credential Rotation & Lockout Recovery

### Routine Credential Rotation Checklist
1. Ensure every administrator (`chief_admin`) and editor (`senior_editor`) holds a unique account and **never shares passwords or password hashes**.
2. Each active user logs in via `/admin`, opens the **खाता सुरक्षा (Account Security)** tab, and submits a new unique passphrase (>= 14 characters, max 256) via `PUT /api/admin/me/password`.
3. Password change immediately revokes all active sessions for that user and redirects to `/admin/login` for fresh authentication.
4. Periodically audit the Chief Admin user list in **खाता सुरक्षा व उपयोगकर्ता**, deactivate or delete unused/departed accounts (which immediately revokes all their sessions), and verify no plaintext credentials remain in environment files.

### Primary Chief Admin Lockout Recovery
1. **Secondary Chief Admin exists:** Sign in as the second active `chief_admin`, create a replacement account (or deactivate/remove the locked-out account after establishing a new Chief Admin), and confirm access.
2. **All Chief Admins locked out (Server/Secret Manager Access Required):**
   - Stop the Node.js service (`SIGTERM`).
   - Generate a fresh `scrypt` password hash offline using Node `crypto.scrypt` (`scrypt$<16-byte-saltHex>$<64-byte-derivedKeyHex>`) without writing the plaintext password to disk or shell history.
   - Inject `ADMIN_USERNAME` and `ADMIN_PASSWORD_HASH` via the platform secret manager / environment and start the service (`ensureEnvAdminAccountsSynced()` updates/creates the `chief_admin` entry in `data/auth-store.json` safely on boot).
   - Verify sign-in over HTTPS, then optionally remove `ADMIN_PASSWORD_HASH` from startup environment once persisted in `data/auth-store.json` (`0600`) so future in-app password rotations via `PUT /api/admin/me/password` are not overridden on restart.

---

## 6. Logging, Health Checks & Persistent Storage Requirements

- **Public Liveness Probe:** `GET /healthz` returns `HTTP 200` (`{ "status": "ok" }`) with `Cache-Control: no-store` and exposes zero internal metrics, DB status, user counts, or environment details.
- **Admin Diagnostics:** `GET /api/system/health` and `GET /api/system/logs` require `chief_admin` authentication (`Bearer` token). `store.logs` is bounded to the latest 100 audit events in `data/store.json`; security events (`AUTH_FAIL`, `PASSWORD_CHANGE_FAIL`) are emitted to `stderr`/`console.warn` (`[SECURITY]`).
- **Log Shipping & Monitoring:** Forward container/process `stdout` and `stderr` to centralized log storage with retention, alert on `FATAL:` startup exits, `5xx` spikes, `[SECURITY]` auth failure bursts / `429` lockouts, and monitor persistent disk utilization on `<app-root>/data/`.

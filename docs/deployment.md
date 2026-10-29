# Single-VPS deployment

These are inactive templates, not an executed deployment. Assume Ubuntu 24.04 LTS,
systemd, Nginx, **Node 22.17+ at `/usr/bin/node`**, 4 GiB RAM and a real DNS
hostname. Confirm OS/architecture, RAM, domain and SSH access before activation.
The installed stack is SvelteKit 3, Svelte 5 and adapter-node 6. Run one process:
sessions, ownership, jobs and admission limits are process-local.

## Build and package

Use a trusted checkout with the confirmed private August files and validated
August V1 recording. Keep credentials out of the build process. PowerShell:

```powershell
$env:META_HACKATHON_API_KEY = ''
$env:META_API_KEY = ''
npm ci --include=dev
npm test
npm run test:dashboard
npm run check
npm run lint
npm run build
npm run release:package -- hackathon-20261029-2
npm run release:verify -- .releases/hackathon-20261029-2
npm run release:smoke -- .releases/hackathon-20261029-2
scp .releases/hackathon-20261029-2.tar.gz .releases/hackathon-20261029-2.tar.gz.sha256 deploy@YOUR_VPS:/tmp/
```

`npm ci` is for the checkout, not the deployed package. Packaging copies the
lockfile-selected production dependency closure, checking versions and rejecting
native/platform-specific packages, installation scripts and symlinks. Such future
dependencies need target-platform review. No VPS dependency installation is needed.

The allowlist contains `build/` including generated static assets, the compiled
`.analytical-worker/entry.cjs`, package/lock metadata, production dependencies,
listed deployment templates/utilities, validated available recordings (August V1
mandatory), and these exact private `.demo-assets/august8/` inputs:

- `2026-08-08_11.19.56.msl`
- `veTable1_2026-08-08_23.57.53.table`
- `AFR_2026-07-30_19.40.54.table`

April is bundled in the server. August staged files must match original-source
hashes. A clone without private inputs cannot produce this release. No unrelated
source, reports, diagnostics or `.env` is packaged. Known local Meta key bytes are
also checked without printing them; this complements the allowlist and secret review.

Outputs are `.releases/<id>/`, `<id>.tar.gz`, and `<id>.tar.gz.sha256`. Existing
IDs are never overwritten; inspect partial outputs after failure and use a new ID.
The manifest verifies every file's size/hash and rejects extras. Git revision is
informational for a dirty checkout. Archive paths, modes, timestamps and gzip are
deterministic for identical bytes; builds across toolchains are not guaranteed
identical. Checksums detect corruption, not malicious replacement: transfer only
from the trusted builder over authenticated SSH.

The smoke copies into a fresh temporary directory, clears Meta credentials and
Node lookup overrides, runs the actual Node server and a synthetic real worker,
loads April/August, runs the recording and checks isolation, ranges, Origin and 413.
It makes no Meta calls and has no checkout/source fallback. It does not validate
Linux service/proxy behavior or provider authentication.

## Install the trusted release

Install Node from your approved distribution source and verify `/usr/bin/node
--version`. Do not use a home-directory nvm runtime with the hardened unit.
The commands below use explicit reviewed release paths; do not substitute untrusted
archive/path input. On the VPS:

```bash
sudo apt-get update
sudo apt-get install nginx certbot apache2-utils
id agenticefi >/dev/null 2>&1 || sudo useradd --system --home /var/lib/agenticefi --shell /usr/sbin/nologin agenticefi
sudo install -d -o root -g root -m 0755 /opt/agenticefi /opt/agenticefi/releases
sudo install -d -o agenticefi -g agenticefi -m 0700 /var/lib/agenticefi /var/lib/agenticefi/investigation-diagnostics
sudo install -d -o root -g root -m 0700 /etc/agenticefi
cd /tmp
sha256sum -c hackathon-20261029-2.tar.gz.sha256
sudo install -d -o root -g agenticefi -m 0750 /opt/agenticefi/releases/hackathon-20261029-2
sudo tar --no-same-owner -xzf hackathon-20261029-2.tar.gz -C /opt/agenticefi/releases/hackathon-20261029-2
sudo chown -R root:agenticefi /opt/agenticefi/releases/hackathon-20261029-2
sudo find /opt/agenticefi/releases/hackathon-20261029-2 -type d -exec chmod 0750 {} +
sudo find /opt/agenticefi/releases/hackathon-20261029-2 -type f -exec chmod 0640 {} +
sudo /usr/bin/node /opt/agenticefi/releases/hackathon-20261029-2/deploy/verify-release.mjs /opt/agenticefi/releases/hackathon-20261029-2
```

Verify the checksum before privileged extraction. No diagnostic symlink in the
release is required. Never serve the release root with Nginx
`root`/`alias`. All release content remains read-only to the application user.

## Credentials and systemd

First install only (preserve the environment file on upgrades):

```bash
sudo install -o root -g root -m 0600 /opt/agenticefi/releases/hackathon-20261029-2/deploy/agenticefi.env.example /etc/agenticefi/agenticefi.env
sudoedit /etc/agenticefi/agenticefi.env
sudo stat -c '%U %G %a' /etc/agenticefi/agenticefi.env
sudo -u agenticefi test ! -r /etc/agenticefi/agenticefi.env
```

Set `META_HACKATHON_API_KEY` interactively (fallback `META_API_KEY` is supported),
never `PUBLIC_*`. Avoid command arguments, shell history, `set -x`, environment
dumps and build artifacts. The **root systemd system manager** reads EnvironmentFile
before dropping to `User=agenticefi`; the service user does not need file read
permission. Validate this on the VPS. Root and the running service necessarily
can access the runtime secret; do not share that user with unrelated workloads.

The template uses `HOST=127.0.0.1`, `PORT=3000`, `BODY_SIZE_LIMIT=16K`, trusted
forwarded host/protocol headers, adapter shutdown timeout 30 seconds. Production
sets `AGENTICEFI_DIAGNOSTICS_DIR=/var/lib/agenticefi/investigation-diagnostics`,
inside the unit's writable state directory. Add this setting to existing environment
files during upgrade; replacing a release does not update `/etc/agenticefi/agenticefi.env`.
An unset or blank value retains the development default `.investigation-diagnostics`
under the working directory. Explicit recorder directory options take precedence.
New diagnostic directories are mode 0700 and files mode 0600; ensure an existing
directory is owned by the service user with mode 0700.
Production does not load `.env`. The unit clears NODE_OPTIONS to avoid overriding worker heap
limits; starts `/usr/bin/node build` (equivalent to `npm start`) from the release;
verifies integrity before startup; writes only StateDirectory/private temporary
storage. Start behind maintenance:

```bash
sudo touch /etc/nginx/agenticefi-maintenance
sudo ln -s /opt/agenticefi/releases/hackathon-20261029-2 /opt/agenticefi/current.next
sudo mv -Tf /opt/agenticefi/current.next /opt/agenticefi/current
sudo install -o root -g root -m 0644 /opt/agenticefi/current/deploy/agenticefi.service /etc/systemd/system/agenticefi.service
sudo systemd-analyze verify /etc/systemd/system/agenticefi.service
sudo systemctl daemon-reload
sudo systemctl enable --now agenticefi
sudo systemctl status agenticefi --no-pager
curl --fail -H 'X-Forwarded-Proto: http' -H 'X-Forwarded-Host: localhost:3000' http://127.0.0.1:3000/api/demo
```

`MemoryMax=3G` is an initial ceiling, not proven sufficient on every VPS. Measure
RSS and headroom: August previously exceeded 1 GiB RSS; worker old-generation
1024 MiB is not a total-memory ceiling. Preserve one analytical/two total active
jobs, eight sessions and sixteen retained jobs; do not enable clustering. OOM or
restart loses all in-memory state. No database or restart recovery is present.

Sessions/jobs expire after 30 minutes; the eight-hour owner cookie does not extend
their lifetime. Per-tool worker timeout is 120 seconds, analytical run and idle
evidence retention are 180 seconds. Explicit cancellation aborts provider work and
disposes workers; leaving the page only stops polling. Restart recovery means
reloading a demo, not resuming a previous investigation.

## HTTPS and public access

Confirm DNS A/AAAA and firewall SSH/80/443; Node port 3000 must remain private.
Authentication and rate limiting are mandatory before public application proxying.
Choose separate demo credentials; never reuse the Meta key. Replace hostname/email
placeholders with actual reviewed values (hostname characters only):

```bash
DOMAIN=demo.example.com
EMAIL=operator@example.com
sudo htpasswd -c /etc/nginx/agenticefi.htpasswd judge
sudo chown root:www-data /etc/nginx/agenticefi.htpasswd
sudo chmod 0640 /etc/nginx/agenticefi.htpasswd
sudo install -d -o root -g root -m 0755 /var/www/letsencrypt
sudo install -o root -g root -m 0644 /opt/agenticefi/current/deploy/nginx-limits.conf /etc/nginx/conf.d/agenticefi-limits.conf
sed "s/demo.example.com/$DOMAIN/g" /opt/agenticefi/current/deploy/nginx-http.conf | sudo tee /etc/nginx/sites-available/agenticefi >/dev/null
sudo ln -s /etc/nginx/sites-available/agenticefi /etc/nginx/sites-enabled/agenticefi
sudo nginx -t
sudo systemctl reload nginx
sudo certbot certonly --webroot -w /var/www/letsencrypt -d "$DOMAIN" --email "$EMAIL" --agree-tos
sed "s/demo.example.com/$DOMAIN/g" /opt/agenticefi/current/deploy/nginx-https.conf | sudo tee /etc/nginx/sites-available/agenticefi >/dev/null
sudo nginx -t
sudo systemctl reload nginx
sudo certbot renew --dry-run
```

Review conflicting default virtual hosts. Bootstrap exposes only ACME, otherwise
404; never proxies the app. Enable the Certbot renewal timer. Install this
root-owned mode-0750 hook at `/etc/letsencrypt/renewal-hooks/deploy/reload-nginx`:

```sh
#!/bin/sh
/usr/sbin/nginx -t && /usr/bin/systemctl reload nginx
```

Basic auth is HTTPS-only and its Authorization header is stripped upstream.
Forwarded host/protocol/IP are overwritten; existing Origin and owner checks remain.
Do not enable body/header debug logging. The proxy denies private dot/source/data/
report/dependency URLs and uses 16 KiB body limits and 180-second read timeout.
Job creation/polling are short HTTP requests; the independent analytical deadline
remains 180 seconds, legacy 300 seconds. Proxy timeout does not extend either.

The http-context zones apply to **POST only** at `/api/investigations` (2/min,
burst 1) and `/api/demo` (6/min, burst 3), including trailing slashes. Recorded,
legacy and live starts share the start route. GET polling/catalog, cancellation,
telemetry and downloads do not use these zones. Shared judge NAT shares limits.
Maintenance blocks the exact start endpoint (also trailing slash); existing job
polling uses `/api/investigations/<id>` and remains available.

## Drain, upgrade and rollback

**TimeoutStopSec does not drain jobs.** Adapter SIGTERM closes HTTP; background
investigations are not persisted or counted by systemd. Operational drain first
sets a proxy admission gate, verifies both start paths return 503, then waits
**330 seconds**, covering legacy's 300-second deadline plus cleanup margin. HTTP
stays available for polling/cancel/download. This is conservative waiting, not an
application-level active-job census. Inspect any known active jobs before stopping.

Stage/verify the next package using the install procedure. Then:

```bash
sudo bash /opt/agenticefi/current/deploy/drain.sh demo.example.com
# If known jobs still run, leave maintenance closed and investigate before stopping.
sudo systemctl stop agenticefi
sudo /usr/bin/node /opt/agenticefi/releases/hackathon-20261029-3/deploy/smoke-release.mjs /opt/agenticefi/releases/hackathon-20261029-3
sudo ln -s /opt/agenticefi/releases/hackathon-20261029-3 /opt/agenticefi/current.next
sudo mv -Tf /opt/agenticefi/current.next /opt/agenticefi/current
sudo systemctl start agenticefi
curl --fail -H 'X-Forwarded-Proto: http' -H 'X-Forwarded-Host: localhost:3000' http://127.0.0.1:3000/api/demo
curl --fail -u judge https://demo.example.com/api/demo
# Open admission ONLY after successful local and authenticated public checks.
sudo rm /etc/nginx/agenticefi-maintenance
```

Smoke uses extra temporary disk/RAM, so stop production first. It clears Meta
credentials even from the invoking environment. Inspect stale `current.next`
rather than overwriting an unexpected path. Ordinary release updates need no unit,
secret or proxy change. Validate/reload separately if those templates change.

Exact rollback to the retained known-good release:

```bash
sudo bash /opt/agenticefi/current/deploy/drain.sh demo.example.com
sudo systemctl stop agenticefi
sudo /usr/bin/node /opt/agenticefi/releases/hackathon-20261029-2/deploy/verify-release.mjs /opt/agenticefi/releases/hackathon-20261029-2
sudo ln -s /opt/agenticefi/releases/hackathon-20261029-2 /opt/agenticefi/current.next
sudo mv -Tf /opt/agenticefi/current.next /opt/agenticefi/current
sudo systemctl start agenticefi
curl --fail -H 'X-Forwarded-Proto: http' -H 'X-Forwarded-Host: localhost:3000' http://127.0.0.1:3000/api/demo
curl --fail -u judge https://demo.example.com/api/demo
sudo rm /etc/nginx/agenticefi-maintenance
```

Leave maintenance closed on any failed health/start check. Retain old release,
archive/manifest and reviewed service/proxy configs. Reload the browser after any
restart; sessions/evidence cannot resume. Never delete active/rollback releases.

## Operations and manual VPS acceptance

Diagnostics are `/var/lib/agenticefi/investigation-diagnostics/<jobId>.json`; internal runId is
different. Normal retention is 32 JSON files, 160 metadata events each. Provider
status/category, bounded recognized error fields and request IDs are recorded,
not keys/full telemetry. Inspect `journalctl -u agenticefi --since today` and the
protected files; do not publish raw archives.
Persistence remains best effort: a failure retains in-memory diagnostics and emits
one fixed, sanitized server warning per recorder (no error body, path or credentials).
Crashes may leave temporary files:
review/remove only aged `.tmp` files inside this exact diagnostic directory.
Set a host journald quota/retention; the unit also rate-limits log messages.
Monitor RSS, restarts, disk, 429/5xx and certificate expiry.

Before opening maintenance on the VPS:

- Run `systemd-analyze verify`, `nginx -t`, TLS/renewal and `ss -ltnp` checks;
  confirm Node loopback and firewall IPv4/IPv6. These Linux checks cannot run on
  the Windows builder. Validate root-manager environment loading and service-user
  inability to read the root-owned file without printing its contents.
- Confirm unauthenticated app requests are 401, authenticated catalog works,
  oversized requests are 413. Burst **invalid** POST bodies with matching Origin
  to see 429 on both expensive routes; rapid GET polling/downloads must still work.
  Never use valid live bodies for rate-limit tests. Check the trailing-slash path.
- With maintenance set, both start paths must return 503; owner polling, cancel
  and downloads must remain usable. Verify using a recorded job before restart.
- Load August, Reset, navigate evidence and run the recording. Another browser
  cannot poll/download someone else's job. Recorded advisory export unavailability
  is expected: it has no server-owned finalized export snapshot.
- Measure cold-load/worker RSS under actual limits; verify cancel, drained SIGTERM,
  crash restart and stale-session recovery. There is no app shutdown census or
  persistence. Confirm outbound HTTPS separately; key availability is not proof
  of valid provider authentication.
- Genuine live provider verification/export needs separate approval. None is part
  of this preparation. Provider latency/400/503 errors remain possible; partial
  evidence remains explicitly partial.

References: [adapter-node](https://svelte.dev/docs/kit/adapter-node),
[Nginx limiting](https://nginx.org/en/docs/http/ngx_http_limit_req_module.html),
[systemd environment](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html).

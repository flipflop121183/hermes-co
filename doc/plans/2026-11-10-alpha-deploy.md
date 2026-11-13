# Alpha Deploy (hermes-co)

Date: 2026-11-10
Target: a single internet-facing alpha instance on one VM, run from the
compose file `docker/docker-compose.alpha.yml`.
Parent document: `doc/plans/2026-11-06-live-deployment-checklist.md`. This
file narrows that checklist to the shortest path to a running alpha and
records what was verified on 2026-11-10.

## Go / no-go, as of 2026-11-10

**Engineering GO / public deployment NO-GO pending acceptance.** The owner chose
`hermes-co` as the candidate application source on 2026-11-10; that authorizes
reviewable hardening, not DNS/VPS/production/customer-access changes.

Before any public exposure: merge approved PRs in order after green required
checks; use a newly verified image digest; reconcile live Hermes and staged
Paperclip runtimes read-only; validate fresh storage, cross-company/agent
authorization, profile-to-gateway mapping, spend and kill-switch controls, and
a backup/restore drill. Keep the scheduler disabled in alpha by default.
Request a separate owner go/no-go decision for actual deployment.

What is already true on `master` (`5d4e0e0`):

| Item | State | Evidence |
|---|---|---|
| Production image built and published | Done | `.github/workflows/docker.yml` run #2 on master succeeded; `ghcr.io/flipflop121183/hermes-co:sha-5d4e0e0` resolves anonymously to digest `sha256:fbeea65e3b122fa0eb2ae91b280318b4e546233d664bf7d3ece910f8dfab300d` |
| Business Ops safety job | Green | PR workflow, job `Business Ops safety` |
| Business Ops OpenAPI gate (serialized 5/9) | Green on PR #3, red on master | PR #3 CI run: suite 5/9 passed; only the two runner-image failures below remain |
| `Verify Paperclip Runner (static checks)` | Red on master, fixed in this PR | uutils `sleep` fixture; patch verified 3/3 locally on Node 24 |
| `General tests (server 7/12)` | Red on master, fixed in this PR | dash exit code 2; the sandboxed case needs bubblewrap and was skipped locally |
| `review` (commitperclip) | Red, repository setting | Needs Dependency graph enabled and the `COMMITPERCLIP_KEY` secret, or trim the workflow. Not a code gate for alpha |
| Scheduled `Release` workflow | Red on master | Release lanes are not wired to this fork. Not a gate for alpha; disable or wire later |

Merge order that yields a green `master`:

1. PR #3 (Business Ops OpenAPI contract).
2. This PR (two test fixes plus the alpha kit).

After both merge, verify the workflow, resolve the new release's **immutable digest**, and put it in the local `.env`. The example leaves the image blank to prevent deploying the older master image by mistake. Do not use a mutable tag.

## What this PR adds

- `docker/docker-compose.alpha.yml`: Postgres 17 on an internal-only network
  (no published port), the server from an immutable digest in
  `authenticated` + `public` mode with `TRUST_PROXY=1`, migrations applied at
  boot, hourly backups retained 7 days on the `/paperclip` volume, strict
  secrets mode, a node-based healthcheck, and Caddy for TLS.
- `docker/alpha/Caddyfile`: Let's Encrypt for a hostname (internal CA for a
  bare IP), forwarded headers, no buffering for SSE and run streams, 100 MB
  request bodies, HSTS.
- `docker/alpha/.env.example`: every variable the compose file requires.
  `.env` is git-ignored.
- Test fixes for the two runner-image failures named in the parent checklist.

## Run sequence on the VM

Prerequisites on the host: Docker Engine with the compose plugin, inbound
80 and 443 open, a DNS A record for the alpha hostname pointing at the VM,
NTP enabled.

```sh
git clone https://github.com/flipflop121183/hermes-co.git && cd hermes-co
cp docker/alpha/.env.example docker/alpha/.env
chmod 600 docker/alpha/.env
# Fill: HERMES_ALPHA_IMAGE (digest), HERMES_ALPHA_DOMAIN, HERMES_ALPHA_ACME_EMAIL,
#       HERMES_ALPHA_DB_PASSWORD, HERMES_ALPHA_AUTH_SECRET, HERMES_ALPHA_TOOL_SIGNING_SECRET
export COMPOSE_FILE=docker/docker-compose.alpha.yml
export COMPOSE_ENV_FILES=docker/alpha/.env

docker compose pull
docker compose up -d
docker compose logs -f server      # wait for "listening" and migration output
curl -fsS https://<domain>/api/health
```

First admin. Browser claim is disabled in `public` mode by design; use the
invite path:

```sh
docker compose exec server node cli/dist/index.js auth bootstrap-ceo
# open the one-time invite URL immediately, set the password, sign in
```

Then close sign-up and restart the server service:

```sh
sed -i 's/^HERMES_ALPHA_DISABLE_SIGN_UP=.*/HERMES_ALPHA_DISABLE_SIGN_UP=true/' docker/alpha/.env
docker compose up -d server
docker compose exec server node cli/dist/index.js doctor
```

Only after a separately approved deployment and isolation check, create an alpha
company, confirm owner membership, connect provider credentials under Apps ->
Connections, join and approve one isolated Hermes gateway profile, run one
explicit *manual* synthetic task (no scheduler), and create one Business Ops offering,
order, and document as an owner. Confirm an agent API key gets 403 on the
Business Ops routes.

## Hostinger VPS variant (Docker Manager, no SSH)

Hostinger VPS instances built from the "Ubuntu 24.04 with Docker and Traefik"
template run Traefik on host ports 80/443 (host network, Let's Encrypt HTTP
challenge, 80 -> 443 redirect, Docker provider with `exposedByDefault=false`).
Caddy cannot bind there, and the Docker Manager writes only a compose file and
its `.env`, so the Caddyfile bind mount is unavailable. Use
`docker/docker-compose.alpha.hostinger.yml`:

1. In hPanel (VPS -> Docker Manager) or through the VPS API
   `vps_docker_create`, create project `hermes-alpha` from the raw contents of
   that file and paste the same variables listed in `docker/alpha/.env.example`
   into the environment box. Never commit the filled values.
2. Add a DNS `A` record for `HERMES_ALPHA_DOMAIN` pointing at the VM's IPv4
   before `up`, or the HTTP challenge fails and Traefik serves its default
   certificate.
3. Traefik picks up the `hermes-alpha` router from labels; no Traefik change
   is needed. The `traefik.docker.network` label pins it to the project's
   `edge` network.
4. Continue at "First admin" above using
   `docker compose -p hermes-alpha exec server node cli/dist/index.js auth bootstrap-ceo`
   from an SSH session, or the Docker Manager's container terminal.

Verified on 2026-11-13: `docker compose config` parses the file, and the same
fail-closed assertions as the CI preflight pass against it (scheduler off, no
published ports, digest-only image, strict secrets, authenticated mode).
Not verified: a live Traefik route; no container was started.

## Rollback

- Previous digest: record it in `docker/alpha/.env` as a comment before every
  change to `HERMES_ALPHA_IMAGE`.
- App rollback: set `HERMES_ALPHA_IMAGE` back and `docker compose up -d server`.
- Schema rollback: migrations are forward-only. Before any user writes, a
  tested pre-cutover backup may be restored into a **separate** fresh database
  and matched with the prior digest after schema compatibility review. Once
  new writes exist, stop writers, preserve and back up the **current** database,
  reconcile/replay changes and obtain a reviewed recovery decision before any
  rollback; never blindly overwrite them with an older snapshot. Never run
  an old image against a schema it has not been tested to understand.
- Triggers: health red for more than 5 minutes, auth loop or lockout, any 5xx
  on `/api/health`, migration failure at boot, Business Ops routes returning
  500.

## Alpha scope and limits

- One VM, one server replica. `PAPERCLIP_MIGRATION_AUTO_APPLY=true` is only
  correct for one replica.
- Backups live on the same volume as the data. Copy `/paperclip/backups` and
  the secrets master key off the VM daily (rclone, object storage, anything
  durable). A restore drill before inviting external testers is still a gate
  in the parent checklist.
- Sentry and OpenTelemetry are not configured. Container logs and
  `heartbeat_run_events` are the only record. Acceptable for an alpha with a
  handful of testers; not acceptable for paying customers.
- Local stdio MCP runtime slots fail closed in `public` mode. Use remote HTTP
  MCP for the alpha.

## Verified on 2026-11-10

- `docker compose -f docker/docker-compose.alpha.yml config` parses with
  every required variable set.
- `node --test packages/paperclip-runner/scripts/stage-runner-binary.test.mjs`
  on Node 24.22.1: 3 passed.
- `vitest run src/services/native-runtime/runner-bridge-tools.test.ts`:
  8 passed, 7 skipped. The patched case is one of the 7 skipped because the
  session has no bubblewrap. The assertion change follows the dash and bash
  exit-code behaviour documented on PR #2.
- The master image tag and digest were read from GHCR anonymously.

## Not verified

- The Caddyfile was reviewed by hand. No `caddy validate` run was possible
  in this session.
- No container was started: the session has a Docker client but no daemon,
  and no SSH route to a VM. Sections "Run sequence" and "Rollback" are the
  documented contract, not an observed pass.
- The two inherited CI failures are expected to go green on GitHub's
  `ubuntu-26.04` image once this PR's CI runs. Confirm on the PR before merge.

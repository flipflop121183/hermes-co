# Live Deployment Checklist (hermes-co)

Date: 2026-11-06
Target: first internet-facing production instance of this fork (Paperclip core +
Business Ops module + Hermes gateway agents).

Every item below is grounded in what the code and docs in this repo actually
enforce. Items marked **GATE** block go-live. Everything else is ordered by
ROI: cheapest insurance first.

Source of truth for mechanics: `doc/DEPLOYMENT-MODES.md`, `doc/DOCKER.md`,
`doc/DATABASE.md`, `doc/INSTALLING.md`, `doc/observability.md`,
`doc/HERMES_GATEWAY_ONBOARDING.md`, `Dockerfile`, `docker/*`.

---

## 0. Decide the hosting shape (pick one, do not straddle)

| Option | Fit | Pros | Cons | Monthly cost band |
|---|---|---|---|---|
| **A. Single VM + Docker Compose + managed Postgres** (recommended for first 90 days) | 1 operator, <10 agents | Cheapest to run, one `docker compose up`, built-in `tini` + `pids_limit` already in `docker/docker-compose.yml`, trivial rollback (redeploy previous image digest) | Single point of failure, manual TLS/reverse proxy, you own OS patching | $40–120 |
| **B. AWS ECS Fargate + RDS + Secrets Manager** (template shipped in `docker/ecs-task-definition.json`) | Team, compliance asks, want zero-SSH ops | Secrets injected from Secrets Manager (never in env files), task def already sets `authenticated/public`, auto-restart, easy horizontal scale later | 3–5× cost of A, IAM/VPC/ALB setup tax, EFS or equivalent needed for `/paperclip` volume (secrets master key + uploads live there) | $150–400 |
| **C. Managed Paperclip Cloud** | Zero ops | Nothing to operate | Not available for a fork with custom modules (Business Ops routes/migrations do not exist upstream) | n/a |

Decision rule: go with **A** unless you already have an AWS account with VPC,
ALB, and RDS patterns in place. Moving A→B later is a config change, not a
rewrite, because the image is identical.

---

## 1. Code and build readiness

- [ ] **GATE** `master`/release commit is green on the `PR` workflow
      (`.github/workflows/pr.yml`): Business Ops safety job
      (`pnpm --filter @paperclipai/db check:migrations`, permission + fresh-DB +
      prototype-upgrade tests) and `pnpm check:token-gates`.
- [ ] **GATE** Full hand-off check passes locally on the exact commit:
      ```sh
      pnpm -r typecheck
      pnpm test:run
      pnpm build
      ```
- [ ] Build the production image with a **full commit stamp** so the remote
      provider pack is qualified (unstamped builds skip the pack and remote
      OpenCode/ACPX runs fail with `runner_remote_provider_artifact_incompatible`):
      ```sh
      docker build --target production \
        --build-arg PAPERCLIP_BUILD_COMMIT=$(git rev-parse HEAD) \
        --build-arg PAPERCLIP_BUILD_VERSION=$(git describe --tags --always) \
        --build-arg CLI_TOOLS_CACHE_EPOCH=$(date +%G-W%V) \
        -t hermes-co:$(git rev-parse --short HEAD) .
      ```
- [ ] Push to a registry and **record the immutable digest**. Deploy digests,
      never mutable tags (`doc/DOCKER.md` is explicit on this).
- [ ] Confirm `/api/health` on a local run of that image reports the expected
      `PAPERCLIP_BUILD_COMMIT`.

## 2. Database

- [ ] **GATE** Provision Postgres 17 (managed preferred). Connection string
      goes in `DATABASE_URL`; use `DATABASE_MIGRATION_URL` for a direct
      (non-pooled) connection if you front Postgres with PgBouncer/Supabase
      pooler (migrations 0313/0314 run outside a file-wide transaction and
      need a direct session).
- [ ] **GATE** Business Ops migration `0333_business_ops.sql` ships
      `NOT VALID` constraints by design. The migration header says to
      reconcile and validate them on a **disposable restored copy** before
      rollout. Do that:
      1. restore a copy of the target DB (or an empty one for a fresh install)
      2. run `pnpm db:migrate` against it
      3. `ALTER TABLE ... VALIDATE CONSTRAINT` for each NOT VALID constraint
         and confirm zero anomalies
- [ ] Decide migration policy and set it explicitly. The server refuses to
      boot on a stale schema unless one of these is set
      (`server/src/index.ts`):
      - `PAPERCLIP_MIGRATION_AUTO_APPLY=true` (simple, fine for a single
        instance), or
      - `PAPERCLIP_MIGRATION_PROMPT=never` and run `pnpm db:migrate` as a
        separate deploy step before starting the new server (required if you
        ever run more than one server replica).
- [ ] Enable automatic logical backups and verify retention:
      `PAPERCLIP_DB_BACKUP_ENABLED=true`,
      `PAPERCLIP_DB_BACKUP_INTERVAL_MINUTES`, `PAPERCLIP_DB_BACKUP_RETENTION_DAYS`,
      `PAPERCLIP_DB_BACKUP_DIR` (must live on the persistent volume).
- [ ] **GATE** Do one restore drill before go-live. A backup you have never
      restored is not a backup.
- [ ] Back up the non-DB instance files separately (`doc/DATABASE.md`
      "Backups"): `/paperclip` volume holds uploads, workspaces, and the
      secrets master key. DB dump alone cannot restore secrets.

## 3. Secrets and keys

- [ ] **GATE** Generate and store in a secret manager (never in compose files
      or git):
      - `BETTER_AUTH_SECRET` (`openssl rand -hex 32`)
      - `PAPERCLIP_TOOL_ACTION_SIGNING_SECRET` (`openssl rand -hex 32`)
      - `DATABASE_URL`
      - provider keys you actually use (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
        `OPENROUTER_API_KEY`, `GITHUB_TOKEN`)
- [ ] Secrets master key: default provider is `local_encrypted` with the key
      at `/paperclip/instances/default/secrets/master.key`. Either keep that
      file on a backed-up persistent volume with `0600` perms, or inject
      `PAPERCLIP_SECRETS_MASTER_KEY` from the secret manager. For ECS, the
      AWS provider in `doc/SECRETS-AWS-PROVIDER.md` is the cleaner path.
- [ ] Set `PAPERCLIP_SECRETS_STRICT_MODE=true` so nobody pastes an API key
      into an inline agent env ever again.
- [ ] Rotate every value that was ever used in dev or in the `.env.example`
      defaults (`paperclip-dev-secret` must not exist in prod).

## 4. Auth, exposure, and network

- [ ] **GATE** Runtime mode for an internet-facing instance:
      ```
      PAPERCLIP_DEPLOYMENT_MODE=authenticated
      PAPERCLIP_DEPLOYMENT_EXPOSURE=public
      PAPERCLIP_PUBLIC_URL=https://<your-domain>
      ```
      `public` turns on Better Auth rate limiting by default and makes
      `doctor` fail hard on misconfiguration. Do not run `private` on a
      public IP: browser first-admin claim is enabled in `private` and is a
      first-come-wins bootstrap.
- [ ] Bind `loopback` (or container `0.0.0.0` on an internal network only)
      behind a reverse proxy that terminates TLS. Direct `lan`/`custom` bind
      on a public interface is documented as "advanced"; do not do it.
- [ ] Reverse proxy: forward `Host`, `X-Forwarded-Proto`, `X-Forwarded-For`;
      allow long-lived connections for SSE/streams; set body size high
      enough for uploads.
- [ ] `PAPERCLIP_ALLOWED_HOSTNAMES` only if you serve on more than the public
      URL host (for example a tailnet alias). Otherwise leave it derived.
- [ ] **GATE** First admin on a public instance must use the CLI invite, not
      the browser claim:
      ```sh
      docker exec -it <container> node cli/dist/index.js auth bootstrap-ceo
      ```
      (or `pnpm paperclipai auth bootstrap-ceo` from a source checkout
      pointed at the prod DB). Accept the one-time invite URL immediately.
- [ ] After the first admin exists, set `PAPERCLIP_AUTH_DISABLE_SIGN_UP=true`
      and redeploy. Open sign-up on a public URL is an invitation to free
      compute.
- [ ] Leave `PAPERCLIP_ENABLE_COMPANY_DELETION` unset (off) in prod.
- [ ] Local stdio MCP runtime slots fail closed in `public` mode. Only set
      `PAPERCLIP_TRUSTED_MCP_RUNTIME_HOST` if a supervised worker host exists.
      Prefer remote HTTP MCP.
- [ ] HTTP adapters cannot reach private origins by default. Add exact
      origins to `PAPERCLIP_HTTP_ADAPTER_PRIVATE_ENDPOINT_ALLOWLIST` only
      for the internal services you actually call.
- [ ] Firewall: inbound 443 only. Postgres port is never public (the default
      `docker/docker-compose.yml` publishes 5432; remove that mapping in prod).

## 5. Business Ops module (fork-specific)

- [ ] Access model is what you expect (`server/src/routes/business-ops-access.ts`):
      reads require a board actor; writes require an instance admin or a
      company **owner** browser session. Agent API keys and delegated MCP
      sessions get nothing. Confirm this matches your intended operating
      model before customer data lands in it.
- [ ] Run the review stack once from the exact prod image digest using
      `docker/docker-compose.business-ops-review.yml` (fresh project, fresh
      credentials, internal network, `PAPERCLIP_SECRETS_STRICT_MODE=true`)
      and walk the catalog, orders, and knowledge base flows end to end.
- [ ] Decide and document who holds `owner` membership on the production
      company. That list is the Business Ops write ACL.

## 6. Hermes gateway agents

- [ ] Hermes gateway runs on a host the Paperclip **server process** can
      reach (not your laptop loopback). Non-loopback HTTP is denied in the
      join flow; use HTTPS or a private tunnel for a remote gateway.
- [ ] Three distinct credentials, never reused for each other:
      provider key (for example `OPENROUTER_API_KEY`), Hermes `API_SERVER_KEY`
      (Paperclip to Hermes), and the claimed Paperclip agent key
      (Hermes to Paperclip).
- [ ] Join request raised, approved by the board, key claimed exactly once.
- [ ] `HEARTBEAT_SCHEDULER_ENABLED=true` on exactly one server process.
- [ ] Per-agent budgets set so the budget hard-stop auto-pause can actually
      fire. Unbudgeted agents on a public instance are an open tab.

## 7. Observability and alerting

- [ ] Health probe on `GET /api/health` wired to your orchestrator/uptime
      monitor (compose healthcheck, ECS health check, or external pinger).
- [ ] Error monitoring: install `@sentry/node` at the exact peer version in
      `server/package.json` and configure DSN (`doc/observability.md`). The
      self-hosted image does not bundle it; the `cloud` target does.
- [ ] Traces: optional. Set `OTEL_EXPORTER_OTLP_ENDPOINT` plus exactly one
      exporter package if you have a collector; otherwise skip, it is a no-op.
- [ ] Container logs shipped somewhere durable (journald/CloudWatch/Loki).
      Run-log events already persist in `heartbeat_run_events`.
- [ ] Alerts, minimum set: health check failing >2 min, 5xx rate >2% over
      5 min, disk on the `/paperclip` volume >80%, DB connections >80% of max,
      daily spend across provider keys above your ceiling.

## 8. Pre-flight on the production host

- [ ] Persistent volume mounted at `/paperclip`, owned by the runtime UID
      (`USER_UID`/`USER_GID` build args or entrypoint remap).
- [ ] `pids_limit` set on the container (2048 in the shipped compose).
- [ ] Node runtime inside the image is 24.x (the image pins `node:24`).
      If you run from a managed install instead, verify the service's Node
      via `/proc/<pid>/exe`, not an interactive shell.
- [ ] Run doctor against the production config and get a green summary:
      ```sh
      docker exec -it <container> node cli/dist/index.js doctor
      ```
- [ ] Time sync (NTP) on the host. Auth tokens and signed tool actions are
      time-sensitive.

## 9. Go-live sequence

1. Snapshot the DB (even if empty).
2. Start the new image digest with migrations applied (per section 2 policy).
3. `curl -fsS https://<domain>/api/health` returns 200 with the expected commit.
4. Bootstrap the first admin via CLI invite; accept it; sign in.
5. Set `PAPERCLIP_AUTH_DISABLE_SIGN_UP=true`; redeploy.
6. Create the production company; confirm owner membership.
7. Connect provider credentials under Apps → Connections (not env vars where
   avoidable).
8. Join and approve the Hermes gateway agent; run one trivial task end to end.
9. Create one Business Ops offering, order, and document as an owner; confirm
   an agent key gets 403 on the same routes.
10. Watch logs and error monitor for 30 minutes under real traffic.

## 10. Rollback plan (write it down before step 1)

- Previous image digest recorded: `__________`
- Rollback command (compose): change the image digest and `docker compose up -d`.
- DB: migrations are forward-only. If a migration must be reverted, restore
  the pre-deploy snapshot and redeploy the previous digest together.
  Never roll the app back while leaving a newer schema in place.
- Rollback triggers: health check red for >5 min, auth loop or lockout,
  any 5xx on `/api/health`, migration failure at boot, Business Ops routes
  returning 500.

## 11. Post-launch (first 7 days)

- [ ] Verify the first automatic backup exists and restores.
- [ ] Rotate the bootstrap invite and any temporary credentials used on day 0.
- [ ] Review `secret_access_events` and the activity log for anything you did
      not expect.
- [ ] Record actual provider spend per agent vs. budget; tighten budgets.
- [ ] Confirm the canary/nightly release lanes in `doc/RELEASE-CHECKLIST.md`
      are either wired to this fork or consciously disabled.

## Things not verified in this checklist

- The browser e2e and release-smoke suites were not run while authoring this
  document. Run `pnpm test:e2e` and `pnpm test:release-smoke` against the
  release commit if you want browser-level proof before go-live.
- No live Hermes gateway or production host was available to this session;
  sections 6 and 8 are the documented contract, not an observed pass.

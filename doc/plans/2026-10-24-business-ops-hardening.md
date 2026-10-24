# Business Ops hardening and controlled reuse

Status: proposed changes on a review branch. No existing deployment, database,
agent profile, company membership, repository setting, or credential is changed.
This work prepares the existing Paperclip application for reuse. It does not
create a second application or establish which deployed instance is authoritative.

## Scope of this change

- Move the prototype tables into Drizzle migration 0333. Remove request-time DDL.
- Require a company owner session for mutations; deny all agent credentials for
  this module until explicit resource and role grants exist. Ordinary company
  members can read. Owner API keys and delegated MCP sessions cannot mutate.
  Existing `local_trusted` mode remains a trusted development boundary and must
  never be exposed to agents or used as a network authentication mechanism.
- Use transactional activity logging, stale-version rejection, offering archiving,
  document archiving and immutable revision snapshots. Shared activity contains
  metadata only. Order records retain status and evidence-reference history.
- Bound integer amounts and aggregate totals, require same-company active catalog
  references with matching prices and currency, separate currency summaries,
  require evidence references for paid/fulfilled/refunded status records, reject
  invalid transitions, and deduplicate supplied external references per company.
- Show permission and request errors in the UI. Use typed shared input contracts.
  A manual order record does not execute a payment or establish recognized revenue.
- Point PR CI at this repository's reviewed workflow instead of mutable upstream
  master. Add a dedicated Business Ops safety job. Propose the actual repository
  owner as CODEOWNER. These files alone do not enforce branch protection.

## Builder access and ownership gates

The current personal repository can be the application source. Transfer to a
company organization is optional and needs a separate ownership decision; review
webhooks, Actions secrets, installed apps, package names and deployment hooks
before any transfer. Preserve upstream MIT notices and history.

Before granting Builder write access, the owner must configure an active ruleset
on `master`: pull requests only, one human approval, CODEOWNER review, stale review
dismissal, required checks including `Business Ops safety` and the inherited
aggregate CI gate, resolved conversations, no force pushes or branch deletion,
and no Builder bypass. Verify the exact check context after its first run.
The initial owner-authored PR needs independent human review or an explicitly
recorded one-time owner decision; the author cannot approve their own PR.

Prefer a repository-installed GitHub App with only this repository selected,
metadata read, contents write and pull requests write. Keep workflow-file write
permission absent. Do not grant administration, Actions secrets, environments,
organization membership, deployments or broad personal-account tokens. A GitHub
App does not enforce path-level content access: use required owner review for
migrations, authentication, CI and dependency changes. Builder works in feature
branches and can neither merge nor deploy. Revoke any temporary grant after its
approved task. Do not give hosted bots the owner's browser session or board key.

Repository settings and Builder's existing grants have not been changed. The
connected GitHub tools do not expose the necessary settings-write operation.
Audit inherited push/release/publish workflows and environment approvals before
merging: changing PR CI does not disable those separate workflows.

## Six-agent boundary

| Role | Current Business Ops access | Required before access is granted |
| --- | --- | --- |
| Chief | Denied | Verified identity; approved proposal/read scope; human authorization for external commitments |
| Finance | Denied | Field-level financial scope, evidence reconciliation, correction/refund approval rules |
| Builder | Denied | Branch-only repository identity; synthetic test data; no production or customer-data credentials |
| Growth | Denied | Published catalog/public material only; explicit approval before outbound messaging |
| Support | Denied | Ticket-scoped customer access and approved reply authority |
| Logkeeper | Denied | Append-only approved operational records; no policy overwrite authority |

This first patch deliberately provides no role-name-based bypass. Existing agents
remain where they are, with their existing activation state and budgets. The
Hermes adapter and hosted bots are separate systems until their gateway contract,
profile paths, workspaces, secrets and run attribution have been verified.
Business Ops documents do not supersede the approved policy, task or operational
record systems. Synchronization is a separate approved change.

## Migration and preservation contract

The generated Drizzle snapshot is unchanged by hand. The generated SQL is adapted
for both an empty database and tables created by the original Business Ops route.
`IF NOT EXISTS` adds columns/indexes without deleting rows. New company foreign
keys and nonnegative checks use `NOT VALID` when adopting legacy tables: old
orphans and negative records remain for explicit reconciliation, while new writes
are checked. Existing checks in fresh tables validate immediately. Legacy paid
orders are not invented as verified payments and no missing evidence is fabricated.
Document history starts at adoption/first edit; earlier overwritten content cannot
be reconstructed. Supplied external references prevent duplicate records;
clients that omit them still need their own retry discipline.

Before any live change:

1. Inventory the running image digest, git revision, migration journal, database
   engine/major version, mounts, encrypted-secret key location, authentication
   configuration, gateways and six profile identities. Do not print secret values.
   Resolve the staged UI loading fault independently. Do not assume it runs this
   repository merely because both applications are Paperclip-based.
2. Take consistent database and application-volume backups, plus profile and
   configuration backups. Protect encryption keys separately. Prove restore into
   an isolated destination; preserve original identifiers and timestamps.
3. Test a fresh schema and a sanitized restored copy. Compare per-company counts,
   document contents, order values by currency, roles and migration history.
   Review every legacy orphan, negative amount and unsupported currency without
   deleting or silently converting it. Resolve anomalies through an approved
   reconciliation record, then validate the new constraints explicitly.
4. Run the test commands below, database upgrade/replay tests, owner/member/agent
   HTTP tests, browser sign-in and cross-company checks. Verify no scheduler,
   agent run, payment, outbound message or live gateway call occurs.
5. Separately approve the destination, cutover plan and migration. Freeze writes,
   take a final consistent backup, apply reviewed migrations once, verify row
   counts and authentication, then admit traffic. Keep the old environment intact.
6. Roll back by stopping writes/traffic to the new instance and restoring the
   verified old image/database/volumes as a unit. Do not drop the new tables or
   blindly run old code against the new database. Reconcile any new writes before
   switching back. Never attach two applications to a mutable database by accident.

## Disposable review environment

`docker/docker-compose.business-ops-review.yml` is an unstarted review template.
It requires an unused project name, pinned application and Postgres image digests,
fresh hex database password and a fresh auth secret. Use a disposable host;
validate Compose and image behavior there before use. No Docker runtime is
available in the authoring workspace, so this template has not been started.

Build the Dockerfile `production` target at the reviewed commit; do not use the
hosted/cloud target. Use isolated named volumes only. The database has no host
port, the web port binds to loopback, the network has no external route, and no
provider or Hermes credentials are supplied. Heartbeats are disabled. First
schema initialization is a separate deliberate migration step on the disposable
review database; startup must not apply it automatically. Startup may reconcile
migration journal state, so never point this template at an existing database.
No existing profile or application volume should be mounted even for convenience.

After successful checks, rehearse the upgrade using sanitized data and a mock
Hermes gateway. Test disconnect, retry/idempotency, cancellation, session routing
and profile isolation. Real gateway runs require a later explicit approval.
The template is not a claim that the existing VPS is ready for migration.

## Validation

Focused commands:

```sh
pnpm exec vitest run packages/shared/src/validators/business-ops.test.ts packages/db/src/migration-snapshot-drift.test.ts packages/db/src/business-ops-migration.test.ts server/src/routes/business-ops-access.test.ts server/src/routes/business-ops.test.ts
pnpm --filter @paperclipai/db check:migrations
pnpm check:token-gates
pnpm -r typecheck
pnpm test:run
pnpm build
```

The PostgreSQL tests create new temporary clusters/databases and never use a live
`DATABASE_URL`. Run them as an unprivileged user. Keep the PR in draft until
PostgreSQL integration and full CI are green. Exact authoring results are recorded
in the PR; do not interpret partial checks as a deploy approval.

Remaining implementation includes resource-level agent grants, enforced gateway
profile isolation, budget/provider-policy verification, approved workflow/tool
allowlists, customer-scoped support, financial reconciliation, canonical-record
synchronization and an approved deployment pipeline. No automatic production
cutover or agent enablement is part of this patch.

# Customer Command Center

A working full-stack demo for a small team selling AI-agent evaluation and improvement services.

## Live app and access

https://customer-command-center-mu.vercel.app

The deployment is public: anyone with the link can use and edit shared demo data. Do not enter sensitive customer information. The in-app teammate selector is a demo identity for exploring assignment and handoff behavior; it is not authentication or a production permissions system.

## Demo walkthrough

1. Use Assigned to me / All team or choose a named owner. Engineering actions remain visible even when that engineer does not own the account.
2. Northstar: inspect discovery gaps and customer-specific ZDR requirements.
3. Atlas: inspect the conflict introduced by an external grader and the stale technical review. Switch to Leo to record a decision; approval is rejected while the conflict remains.
4. Harbor: open Delivery & success. The accepted scope and technical owner are carried into the handoff. Switch to Leo and accept delivery. A dated milestone already exists. Unresolved access work stays visible as a blocker.
5. Meridian: inspect overdue commitments, the delivery blocker, measured results below the accepted target, and approaching renewal. Mutations automatically reconcile assigned risk-review actions.
6. Cedar: inspect a healthy customer and expansion follow-up.
7. Open Continual grading on a presales account to run the simulated calibration exercise. Use the three fixed synthetic examples, review the two fixed simulated grader judgments, and complete a preliminary discovery brief. Switch the demo teammate to the assigned technical owner to resolve a disagreement with a note. Reopen the exercise and edit evidence to see a resolved review reopen. Repeated ZDR review requests reuse one task.
8. Add an account, log a meeting with a dated follow-up, then open another tab/browser and refresh to see the shared record.

## Architecture

This repository contains the full-stack Cloudflare/Vinext source. The current Vercel deployment serves the Next.js frontend and proxies `/api/*` to the Cloudflare Worker backed by D1. A standalone Vercel deployment needs the equivalent API rewrite or a migrated backend; it is not configured by this repository alone.

- Vinext / React / TypeScript UI with server-side route handlers.
- Cloudflare D1 (SQLite) durable shared storage; not browser localStorage.
- Each account is a versioned document in its own database row. Compare-and-swap updates prevent stale clients from silently overwriting changes. Meeting-plus-action and agreement-plus-handoff are atomic record mutations.
- One pure rules module powers frontend readiness and server checks. Calibration is an optional, backward-compatible field on the same versioned account document; progress and reviews persist in D1. Immutable accepted agreement snapshots remain distinct from draft proposals.
- Migrations are schema-only. An explicitly versioned, one-time demo reset backs up all prior account rows atomically before restoring five fictional scenarios. Its durable marker prevents refreshes from resetting subsequent edits. New seed versions invalidate stale clients.
- Signals are calculated from current data/date. Mutation-triggered risk tasks are deduplicated and close when the underlying issue resolves. There is no scheduler; time-triggered alerts are current on read, and persistent task reconciliation occurs on the next account mutation.

## Source map

- `app/page.tsx`: workspace, account detail, forms and interactions.
- `app/globals.css`: responsive design system.
- `lib/model.ts`: domain types and teammate fixtures.
- `lib/rules.ts`: stage gates, permission checks, signals, automatic tasks.
- `lib/grading.ts`, `app/calibrate/page.tsx`, `app/api/calibration/route.ts`: simulated grading discovery, validated shared saves, and assigned review decisions.
- `lib/seed.ts`: five fictional customer scenarios.
- `app/api/state/route.ts`: shared state and idempotent seeding.
- `app/api/mutate/route.ts`: validated mutations and optimistic concurrency.
- `db/schema.ts`, `drizzle/`: durable table and migration.
- `tests/`: rule and API-handler checks.

## Run and verify

Install with the package manager corresponding to the lockfile (`pnpm install`). Use Node 22.13 or later.

```
pnpm exec tsc --noEmit
node tests/run.cjs
pnpm build
```

For a local D1 preview, build once, then apply `drizzle/0000_freezing_tinkerer.sql` using the starter's Wrangler command:

```
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_freezing_tinkerer.sql
pnpm dev
```

Apply each file in drizzle/*.sql once, in filename order (including the demo-reset backup tables). Hosted deployment applies migrations separately. Hosted and local databases are independent.

## Validation performed

TypeScript check; workflow-rule and calibration validation/deduplication assertions; real API-handler tests with an in-memory D1 adapter covering conflict rejection, agreement snapshot, stage gates, reviewer ownership, meeting-plus-action, handoff deduplication and ZDR conflict rejection. Browser checks covered create account, meeting plus dated action, a second tab reading saved data, wrong-owner handoff rejection, and successful technical-owner handoff. A separate browser profile was not available; shared storage was verified across independent page loads and is backed by server D1.

## Assumptions and deliberate cuts

One current engagement per account; three demo teammates; Pacific date boundaries; all sample metrics are higher-is-better. Stalled means 14 days without customer contact; renewal attention begins 30 days before renewal. The model supports a lower-is-better direction, but that selector is not in the demo UI.

No external communication is sent. The grading exercise is explicitly simulated: it uses fixed synthetic support examples and fixed demo grader judgments, has no model/API integration, and does not learn from customer labels. The site is public by owner request; account-linked exercise URLs can be shared, and all visitors can edit shared demo records. Customer-data uploads are disabled pending current technical and data-policy approval; requesting ZDR creates a deduplicated review task and never approves access. This small exercise does not establish statistical validity. Data-policy fields record customer wording and declared handling; the app does not certify compliance or inspect contracts. Custom requirements require a human review. None stated is not permission for proposed training or external processing.

The production-oriented spec was intentionally reduced: no amendment acceptance UI/history, validation waivers, backward stage movement, multiple concurrent deals, uploads, email/calendar connectors, SSO roles, background scheduler, or AI-generated judgments. A proposed amendment can be recorded and reviewed but does not replace an accepted agreement in this demo. Per-account JSON simplifies the demo at the cost of relational analytics and fine-grained concurrent edits.

## Three submission bullets

- Shared D1 state and atomic, version-checked account updates keep agreements, handoffs, and actions consistent across sessions; per-account documents trade flexible analytics for a compact implementation.
- Deterministic rules identify missing prerequisites, stale approvals, data conflicts, overdue delivery, and renewal risk, then prepare accountable follow-ups; humans approve scope, feasibility, and customer commitments.
- The interface prioritizes personal next actions and preserves accepted scope through delivery. Integrations, concurrent deals, and amendment execution were cut to make the core lifecycle usable end to end.

## Grading browser verification

Verified against the public deployment in Chrome: save context, grade three samples, repeat ZDR request without duplicate tasks, save one disagreement and completion brief, reload persisted state, reject the wrong reviewer, accept as assigned engineer, and reopen review / mark brief stale after changing evidence. Shared account card retained Discovery stage and showed assigned follow-ups.

## Review hardening (November 2026)

Forms preserve drafts on version conflicts, backdrop clicks do not dismiss them, and closing a dirty form requires confirmation. Navigation records account/tab URLs and supports browser history. Manual actions can be completed and reopened; generated review work remains tied to its workflow.

API handlers bound request size and text lengths, validate real calendar dates and numeric targets, and require a distinct Engineering teammate for technical approval. Closed accounts are read-only until explicitly reopened; closing cancels unfinished work and reopening restores it. The acting teammate remains a demo identity, not authenticated authorization.

Review and measurement histories preserve prior entries. Customer agreement evidence is required to record a win, and accepted terms, targets, restrictions and evidence are shown during handoff.

The one-time cleanup retains the previous dataset in `demo_reset_account_backups`, keyed by reset revision. It is not exposed through the public state API. No recurring reset or public reset endpoint is installed.

import type { Account } from './model';
import { seedAccounts } from './seed';

// Bump this literal only when an explicitly approved demo-data reset is needed.
// Once this revision is recorded, later requests never replace live data.
export const DEMO_RESET_REVISION = 'customer-command-center-demo-seed-v1';

export async function ensureDemoReset(db: D1Database, today: string): Promise<void> {
  const run = await db
    .prepare('SELECT revision FROM demo_reset_runs WHERE revision=?')
    .bind(DEMO_RESET_REVISION)
    .first<{ revision: string }>();
  if (run) return;

  const now = new Date().toISOString();
  const seeds = seedAccounts(today);
  const statements = [
    db
      .prepare(
        `INSERT INTO demo_reset_account_backups
      (reset_revision, account_id, account_version, payload, backed_up_at)
      SELECT ?, id, version, payload, ? FROM accounts
      WHERE NOT EXISTS (SELECT 1 FROM demo_reset_runs WHERE revision=?)`,
      )
      .bind(DEMO_RESET_REVISION, now, DEMO_RESET_REVISION),
    db
      .prepare(
        `DELETE FROM accounts
      WHERE NOT EXISTS (SELECT 1 FROM demo_reset_runs WHERE revision=?)`,
      )
      .bind(DEMO_RESET_REVISION),
    ...seeds.map((account: Account) =>
      db
        .prepare(
          `INSERT INTO accounts (id, version, payload)
      SELECT ?,
        COALESCE((SELECT MAX(account_version) FROM demo_reset_account_backups
          WHERE reset_revision=? AND account_id=?), 0) + 1,
        json_set(?, '$.version', COALESCE((SELECT MAX(account_version)
          FROM demo_reset_account_backups WHERE reset_revision=? AND account_id=?), 0) + 1)
      WHERE NOT EXISTS (SELECT 1 FROM demo_reset_runs WHERE revision=?)`,
        )
        .bind(
          account.id,
          DEMO_RESET_REVISION,
          account.id,
          JSON.stringify(account),
          DEMO_RESET_REVISION,
          account.id,
          DEMO_RESET_REVISION,
        ),
    ),
    db
      .prepare(
        `INSERT INTO demo_reset_runs (revision, executed_at)
      SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM demo_reset_runs WHERE revision=?)`,
      )
      .bind(DEMO_RESET_REVISION, now, DEMO_RESET_REVISION),
  ];

  // D1 batches are atomic. Every write checks the fixed revision marker, and the
  // marker is inserted last so racing first requests cannot partially reset data.
  await db.batch(statements);
}

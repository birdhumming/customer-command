import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';
export const accounts = sqliteTable('accounts', {id:text('id').primaryKey(),version:integer('version').notNull().default(1),payload:text('payload').notNull()});
export const demoResetRuns = sqliteTable('demo_reset_runs', {
  revision: text('revision').primaryKey(),
  executedAt: text('executed_at').notNull(),
});
export const demoResetAccountBackups = sqliteTable('demo_reset_account_backups', {
  resetRevision: text('reset_revision').notNull(),
  accountId: text('account_id').notNull(),
  accountVersion: integer('account_version').notNull(),
  payload: text('payload').notNull(),
  backedUpAt: text('backed_up_at').notNull(),
}, (table) => [primaryKey({columns:[table.resetRevision,table.accountId]})]);

import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
export const accounts = sqliteTable('accounts', {id:text('id').primaryKey(),version:integer('version').notNull().default(1),payload:text('payload').notNull()});

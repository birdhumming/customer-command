// Adversarial request and lifecycle checks against the route handlers.
const assert = require('node:assert/strict'),
  Module = require('node:module'),
  path = require('node:path');
const root = process.env.TEST_BUILD,
  rows = new Map();
const DB = {
  prepare(sql) {
    return {
      bind(...args) {
        return {
          async first() {
            const r = rows.get(args[0]);
            return r ? { ...r } : null;
          },
          async run() {
            if (sql.startsWith('INSERT')) {
              rows.set(args[0], { version: args[1], payload: args[2] });
              return { meta: { changes: 1 } };
            }
            if (sql.startsWith('UPDATE')) {
              const r = rows.get(args[2]);
              if (r?.version !== args[3]) return { meta: { changes: 0 } };
              rows.set(args[2], { version: args[0], payload: args[1] });
              return { meta: { changes: 1 } };
            }
            throw Error(sql);
          },
        };
      },
    };
  },
};
const original = Module._load;
Module._load = function (id, parent, isMain) {
  if (id === 'cloudflare:workers') return { env: { DB } };
  if (id.startsWith('@/')) id = path.join(root, id.slice(2) + '.js');
  return original.call(this, id, parent, isMain);
};
const { POST } = require(root + '/app/api/mutate/route.js');
let account;
async function req(body, status = 200) {
  const r = await POST(
    new Request('http://test/api/mutate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }),
  );
  const data = await r.json();
  assert.equal(r.status, status, JSON.stringify(data));
  if (r.status === 200) account = data.account;
  return data;
}
async function call(action, data = {}, actorId = 'maya', status = 200) {
  return req(
    JSON.stringify({ action, data, actorId, accountId: account?.id, version: account?.version }),
    status,
  );
}
(async () => {
  await req('', 400);
  await req('{', 400);
  await req('[]', 400);
  await req('null', 400);
  await req('"x"', 400);
  await req(' '.repeat(65537), 400);
  await call('createAccount', { name: 'Hardening', ownerId: 'maya' });
  await call('editAccount', { technicalOwnerId: 'sandra' }, 'maya', 400);
  await call('editAccount', { technicalOwnerId: 'maya' }, 'maya', 400);
  await call('saveProposal', { scope: 'x'.repeat(4001) }, 'maya', 400);
  await call('saveRestrictions', { status: 'none', unexpected: true }, 'maya', 400);
  await call('saveProposal', { sharedAt: '2025-02-30' }, 'maya', 400);
  await call('saveProposal', { sharedAt: '2099-01-01' }, 'maya', 400);
  await call('requestReview', {}, 'maya', 400);
  await call('editAccount', { technicalOwnerId: 'leo' });
  await call('requestReview');
  const version = account.version;
  await call('requestReview');
  assert.equal(account.version, version);
  await call('addTask', { title: 'Manual action', ownerId: 'maya', dueDate: '2020-02-29' });
  const task = account.tasks.find((t) => t.title === 'Manual action');
  await call('setTaskDone', { taskId: task.id, done: true });
  await call('setTaskDone', { taskId: task.id, done: true });
  assert.equal(account.tasks.find((t) => t.id === task.id).done, true);
  await call('setTaskDone', { taskId: task.id, done: 'true' }, 'maya', 400);
  await call('advance', { stage: 'Lost', reason: 'No decision' });
  assert(account.tasks.filter((t) => !t.done).every((t) => t.cancelled));
  await call('editAccount', { contact: 'closed write' }, 'maya', 400);
  await call('reopenAccount');
  assert.equal(account.stage, 'Discovery');
  assert(account.tasks.filter((t) => t.cancelled).every((t) => !t.done));

  await call('editAccount', { ownerId: 'leo' }, 'maya', 400);
  await call('saveProposal', { sharedAt: '2020-01-01' });
  assert.equal(account.proposal.sharedAt, '2020-01-01');
  await call('saveProposal', { baseline: 10, target: 9 }, 'maya', 400);
  await call('saveProposal', { baseline: -1, target: 9 }, 'maya', 400);
  await call('saveProposal', { direction: 'lower', baseline: 10, target: 5 });
  await call('saveProposal', { direction: 'higher' }, 'maya', 400);
  await call(
    'addTask',
    { title: 'Invalid flag', dueDate: '2026-11-05', committed: 'false' },
    'maya',
    400,
  );
  const gaps = await call('advance', { stage: 'Proposal' }, 'maya', 400);
  assert(gaps.gaps.length > 0);
  await call('logMeeting', {
    date: '2020-01-01',
    summary: 'Detailed '.repeat(100),
    nextAction: { title: 'Follow up', ownerId: 'maya', dueDate: '2020-01-02', committed: true },
  });
  assert.equal(account.meetings[0].actorId, 'maya');
  assert(account.tasks.find((t) => t.title === 'Follow up').committed);
  await call(
    'editMeeting',
    { meetingId: account.meetings[0].id, summary: '', date: '2020-01-01' },
    'maya',
    400,
  );
  const unfinished = account.tasks.filter((t) => !t.done).map((t) => t.id);
  await call('advance', { stage: 'Lost', reason: 'Lifecycle test' });
  assert.equal(account.tasks.filter((t) => !t.done).length, 0);
  await call('logMeeting', { date: '2020-01-01', summary: 'Cannot write' }, 'maya', 400);
  await call('reopenAccount');
  for (const id of unfinished) assert.equal(account.tasks.find((t) => t.id === id).done, false);
  const { seedAccounts } = require(root + '/lib/seed.js');
  account = seedAccounts('2026-11-05').find((a) => a.id === 'meridian');
  rows.set(account.id, { version: account.version, payload: JSON.stringify(account) });
  await call('recordOutcome', {
    latest: 75,
    measuredAt: '2026-01-01',
    evaluationBasis: account.agreement.evaluationBasis,
  });
  assert.equal(account.outcomeHistory.at(-1).value, 75);
  assert.equal(account.outcomeHistory.at(-1).date, '2026-01-01');
  await call('recordOutcome', { latest: 76, evaluationBasis: '' }, 'maya', 400);
  await call('recordOutcome', { latest: null }, 'maya', 400);
  await call('recordOutcome', { latest: 76, measuredAt: '2026-02-30' }, 'maya', 400);
  await call(
    'recordOutcome',
    { latest: 76, direction: 'lower', baseline: 100, target: 80 },
    'maya',
    400,
  );
  await call(
    'recordOutcome',
    { latest: 76, evaluationBasis: 'different', baseline: 62, target: 80 },
    'maya',
    400,
  );
  console.log(
    'Hardening checks passed: bounded JSON, date/text validation, technical ownership, idempotency, lifecycle closure and restore.',
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

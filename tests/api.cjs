// Exercise the real route handler with an in-memory D1 adapter (no hosted writes).
const assert = require('node:assert/strict'),
  Module = require('node:module'),
  path = require('node:path');
const root = process.env.TEST_BUILD;
const rows = new Map();
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
const { todayLA } = require(root + '/lib/model.js');
const today = todayLA();
let a;
async function call(action, data = {}, actorId = 'maya', expected = 200, version = a?.version) {
  const r = await POST(
    new Request('http://test/api/mutate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, data, actorId, accountId: a?.id, version }),
    }),
  );
  const d = await r.json();
  assert.equal(r.status, expected, JSON.stringify({ action, d }));
  if (r.status === 200) a = d.account;
  return d;
}
(async () => {
  await call('createAccount', { name: 'QA', ownerId: 'maya' });
  const stale = a.version;
  await call('editAccount', {
    contact: 'Test contact',
    buyer: 'Test buyer',
    problem: 'Evaluate resolution accuracy',
    technicalOwnerId: 'leo',
  });
  await call('editAccount', { name: 'Stale' }, 'maya', 409, stale);
  await call('advance', { stage: 'Proposal' }, 'maya', 400);
  await call('saveProposal', {
    scope: 'Evaluate 100 conversations',
    terms: 'Paid pilot',
    successMetric: 'Accuracy',
    baseline: 60,
    target: 80,
    evaluationBasis: 'QA v1',
    retention: 'none',
    externalProcessing: false,
    trainingUse: false,
  });
  await call('saveRestrictions', {
    status: 'specified',
    wording: 'No external processing',
    externalAllowed: 'no',
    trainingAllowed: 'no',
    retention: 'none',
  });
  await call('decideReview', { status: 'approved', note: 'Feasible' }, 'maya', 400);
  await call('decideReview', { status: 'approved', note: 'Feasible local evaluation' }, 'leo');
  await call('advance', { stage: 'Proposal' });
  await call('saveProposal', { sharedAt: today });
  await call('logMeeting', {
    date: today,
    summary: 'Customer discussion',
    nextAction: { title: 'Confirm signature', ownerId: 'maya', dueDate: today },
  });
  assert(a.tasks.some((t) => t.title === 'Confirm signature'));
  assert.equal(a.meetings.length, 1);
  await call('advance', { stage: 'Negotiation' });
  await call('advance', { stage: 'Onboarding' }, 'maya', 400);
  await call('advance', { stage: 'Onboarding', evidence: 'Explicit acceptance' });
  const snapshot = JSON.stringify(a.agreement);
  await call('advance', { stage: 'Onboarding', evidence: 'Repeat' }, 'maya', 400);
  assert.equal(a.tasks.filter((t) => t.type === 'handoff').length, 1);
  await call('addTask', {
    title: 'Deliver pilot',
    ownerId: 'leo',
    dueDate: today,
    type: 'milestone',
  });
  await call('advance', { stage: 'Delivery' }, 'maya', 400);
  await call('advance', { stage: 'Delivery' }, 'leo');
  await call('saveProposal', { scope: 'An unaccepted change', externalProcessing: true });
  assert.equal(JSON.stringify(a.agreement), snapshot);
  await call('decideReview', { status: 'approved', note: 'Should fail' }, 'leo', 400);
  await call('advance', { stage: 'Ended', reason: 'Complete' });
  console.log(
    'API route checks passed: atomic meeting/action, concurrency rejection, stage gates, approval ownership, frozen agreement, one handoff, ZDR rejection.',
  );
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

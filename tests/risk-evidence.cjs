const assert = require('node:assert/strict');
const { seedAccounts } = require(process.env.TEST_BUILD + '/seed.js');
const { getSignals, getGaps, reviewCurrent } = require(process.env.TEST_BUILD + '/rules.js');
const today = '2026-11-04';
const signal = (account, key) => getSignals(account, today).find((item) => item.key === key);

const [northstar, atlas, , meridian, cedar] = seedAccounts(today);
const stale = signal(atlas, 'review');
assert.equal(stale.reason, 'The proposal or data requirements changed after the last review.');
for (const status of ['pending', 'conditional', 'blocked']) {
  const account = structuredClone(northstar);
  account.review = {
    ...account.review,
    status,
    note: 'Customer language must never become the system headline.',
  };
  const review = signal(account, 'review');
  assert.doesNotMatch(review.reason, /Customer language/);
  if (status === 'conditional')
    assert.match(review.reason, /Conditions remain unresolved.*cannot advance/);
  if (status === 'pending') assert.match(review.reason, /review is pending.*cannot advance/);
  if (status === 'blocked') assert.match(review.reason, /review is blocked/);
}
const conditional = structuredClone(northstar);
conditional.review = { ...conditional.review, status: 'conditional' };
assert(getGaps(conditional, 'Proposal').some((g) => /conditional technical review/i.test(g)));
const selfOwned = structuredClone(cedar);
selfOwned.technicalOwnerId = selfOwned.ownerId;
assert(!reviewCurrent(selfOwned));
assert(getGaps(selfOwned, 'Delivery').some((g) => /separate from the account owner/i.test(g)));
const nonEngineering = structuredClone(cedar);
nonEngineering.technicalOwnerId = 'sandra';
nonEngineering.review.reviewerId = 'sandra';
assert(!reviewCurrent(nonEngineering));

const unknown = structuredClone(northstar);
unknown.restrictions.status = 'specified';
unknown.restrictions.externalAllowed = 'unknown';
unknown.restrictions.trainingAllowed = 'yes';
unknown.restrictions.retention = 'custom';
const data = signal(unknown, 'data-unknown');
assert.match(data.reason, /external processing permission/);
assert.doesNotMatch(data.reason, /training use permission|retention period/);

const stalled = structuredClone(northstar);
stalled.stage = 'Discovery';
stalled.lastContact = '2026-10-01';
assert.match(signal(stalled, 'stalled').reason, /Oct 1, 2026 \(34 days ago\)/);
stalled.lastContact = '2026-99-99';
assert.doesNotThrow(() => signal(stalled, 'stalled'));

const lower = structuredClone(meridian);
lower.proposal.direction = 'lower';
lower.proposal.latest = 12;
lower.proposal.target = 10;
lower.proposal.evaluationBasis = 'latency';
lower.proposal.successMetric = 'Latency';
lower.proposal.measuredAt = '2026-10-20';
lower.agreement.target = 10;
lower.agreement.evaluationBasis = 'latency';
lower.agreement.direction = 'lower';
const renewal = signal(lower, 'renewal-risk');
assert.match(
  renewal.reason,
  /Renewal Nov 25, 2026\. Latency: latest 12, target 10 \(above target\)\./,
);
assert.doesNotMatch(renewal.reason, /2026-10-20|evaluation basis/);

const upper = structuredClone(lower);
upper.proposal.direction = 'higher';
upper.proposal.latest = 8;
upper.proposal.target = 10;
upper.agreement.direction = 'higher';
assert.match(signal(upper, 'renewal-risk').reason, /target 10 \(below target\)\./);

const watch = structuredClone(cedar);
watch.health = 'Watch';
watch.healthReason = 'Champion changed roles.';
assert.equal(signal(watch, 'relationship-watch').severity, 'warning');
assert.equal(signal(cedar, 'relationship-watch'), undefined);
const closed = structuredClone(cedar);
closed.stage = 'Ended';
closed.tasks = [
  {
    id: 'closed-risk',
    title: 'Follow up',
    ownerId: 'maya',
    dueDate: today,
    done: false,
    committed: false,
    type: 'action',
    automationKey: 'risk:stalled',
  },
];
const { reconcileRiskTasks } = require(process.env.TEST_BUILD + '/rules.js');
reconcileRiskTasks(closed, today);
assert.equal(closed.tasks[0].done, true);
assert.equal(getSignals(closed, today).length, 0);
console.log('Risk evidence assertions passed');

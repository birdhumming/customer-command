const assert=require('node:assert/strict');
const {seedAccounts}=require(process.env.TEST_BUILD+'/seed.js');
const {getSignals}=require(process.env.TEST_BUILD+'/rules.js');
const today='2026-11-04';
const signal=(account,key)=>getSignals(account,today).find(item=>item.key===key);

const [northstar,atlas,,meridian]=seedAccounts(today);
const stale=signal(atlas,'review');
assert.match(stale.reason,/proposal revision \d+.*data requirements revision \d+.*current revisions are proposal \d+/);

const unknown=structuredClone(northstar);
unknown.restrictions.status='specified';unknown.restrictions.externalAllowed='unknown';unknown.restrictions.trainingAllowed='yes';unknown.restrictions.retention='custom';
const data=signal(unknown,'data-unknown');
assert.match(data.reason,/external processing permission/);
assert.doesNotMatch(data.reason,/training use permission|retention period/);

const stalled=structuredClone(northstar);stalled.stage='Discovery';stalled.lastContact='2026-10-01';
assert.match(signal(stalled,'stalled').reason,/2026-10-01 \(34 days ago\)/);

const lower=structuredClone(meridian);lower.proposal.direction='lower';lower.proposal.latest=12;lower.proposal.target=10;lower.proposal.evaluationBasis='latency';lower.proposal.successMetric='Latency';lower.proposal.measuredAt='2026-10-20';lower.agreement.target=10;lower.agreement.evaluationBasis='latency';lower.agreement.direction='lower';
const renewal=signal(lower,'renewal-risk');
assert.match(renewal.reason,/Renewal .*Latency: latest 12 on 2026-10-20; target 10 or lower; evaluation: latency/);

const upper=structuredClone(lower);upper.proposal.direction='higher';upper.proposal.latest=8;upper.proposal.target=10;upper.agreement.direction='higher';
assert.match(signal(upper,'renewal-risk').reason,/target 10 or higher; evaluation: latency/);
console.log('Risk evidence assertions passed');

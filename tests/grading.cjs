const assert = require('node:assert/strict');
const { emptyCalibration, validateCalibration, disagreementCount, ensureGradingTask } = require(
  process.env.TEST_BUILD + '/grading.js',
);
const c = emptyCalibration();
assert(validateCalibration(c).length >= 5, 'empty calibration must require the core entries');
c.task = 'Support replies';
c.outcome = 'Resolve questions safely';
c.expertName = 'Customer expert';
c.examples.forEach((x, i) => {
  x.label = i === 1 ? 'fail' : 'pass';
  x.reason = 'Meets the documented outcome.';
});
c.judgments[0].agreement = 'agree';
c.judgments[1].agreement = 'disagree';
c.judgments[1].correction = 'Escalate urgently.';
assert.equal(validateCalibration(c).length, 0);
assert.equal(disagreementCount(c), 1);
c.dataPath = 'customer';
assert(validateCalibration(c).some((x) => x.includes('disabled')));
const tasks = [];
ensureGradingTask(tasks, 'grading:zdr-review', 'Review ZDR', 'leo', '2026-11-05');
ensureGradingTask(tasks, 'grading:zdr-review', 'Review ZDR', 'leo', '2026-11-05');
assert.equal(tasks.length, 1);
console.log('Grading validation and deduplication assertions passed');

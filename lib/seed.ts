import { emptyAccount, shiftDay } from './model';
import type { Account, Task } from './model';
export function seedAccounts(today: string): Account[] {
  const task = (
    id: string,
    title: string,
    ownerId: string,
    offset: number,
    type: Task['type'] = 'action',
    committed = false,
  ): Task => ({
    id,
    title,
    ownerId,
    dueDate: shiftDay(today, offset),
    done: false,
    committed,
    type,
  });
  const base = (id: string, name: string, industry: string, owner: string): Account => {
    const a = emptyAccount(name, owner, today);
    a.id = id;
    a.industry = industry;
    a.technicalOwnerId = 'leo';
    a.createdAt = shiftDay(today, -35);
    a.lastContact = shiftDay(today, -3);
    a.contact = 'Jamie Morgan · Head of AI';
    a.buyer = 'Jamie Morgan';
    a.proposal = {
      ...a.proposal,
      scope:
        'Evaluate 1,000 agent conversations, map failure categories, and deliver an improvement report.',
      terms: '$18,000 paid pilot · 6 weeks · 50% upfront',
      successMetric: 'Correct task resolution (%)',
      baseline: 62,
      target: 80,
      evaluationBasis: 'Customer support holdout v1 · 500 cases',
      retention: 'none',
      sharedAt: shiftDay(today, -6),
    };
    a.restrictions = {
      ...a.restrictions,
      status: 'specified',
      wording:
        'No retention of customer prompts or outputs. Evaluation only; training requires separate approval.',
      externalAllowed: 'no',
      trainingAllowed: 'no',
      retention: 'none',
    };
    a.review = {
      status: 'approved',
      proposalRevision: 1,
      requirementRevision: 1,
      note: 'Customer-hosted evaluation; no payload retention or training use.',
      reviewerId: 'leo',
    };
    a.activity = [
      { id: id + '-created', date: shiftDay(today, -35), text: 'Account created and assigned' },
    ];
    return a;
  };
  const agree = (a: Account) => {
    a.agreement = {
      scope: a.proposal.scope,
      terms: a.proposal.terms,
      successMetric: a.proposal.successMetric,
      acceptedAt: shiftDay(today, -10),
      evidence: 'Signed pilot scope confirmed by customer email.',
      revision: 1,
      baseline: a.proposal.baseline,
      target: a.proposal.target,
      evaluationBasis: a.proposal.evaluationBasis,
      direction: a.proposal.direction,
      handling: {
        externalProcessing: a.proposal.externalProcessing,
        retention: a.proposal.retention,
        trainingUse: a.proposal.trainingUse,
      },
      restrictions: { ...a.restrictions },
    };
  };
  const n = base('northstar', 'Northstar Support', 'Customer support', 'maya');
  n.problem = 'Support agent escalates routine billing questions and misses policy exceptions.';
  n.buyer = '';
  n.lastContact = shiftDay(today, -17);
  n.restrictions.wording =
    'ZDR must apply to every model that sees customer data, including routers and graders.';
  n.restrictions.externalAllowed = 'unknown';
  n.review = {
    status: 'pending',
    proposalRevision: 1,
    requirementRevision: 1,
    note: 'Clarify whether temporary external grading is allowed.',
    reviewerId: 'leo',
  };
  n.tasks = [
    task('n1', 'Clarify ZDR coverage with security lead', 'maya', 1),
    {
      ...task('n2', 'Validate evaluation architecture', 'leo', 2, 'review'),
      automationKey: 'technical-review',
    },
  ];
  const a = base('atlas', 'Atlas Commerce', 'Commerce', 'maya');
  a.stage = 'Negotiation';
  a.problem =
    'Shopping assistant recommends unavailable products; customer wants a more accurate evaluator.';
  a.proposal.externalProcessing = true;
  a.proposal.revision = 2;
  a.review!.note = 'Prior approval covered customer-hosted grading only.';
  a.tasks = [
    task('a1', 'Resolve external grader requirement', 'leo', 1, 'review'),
    task('a2', 'Confirm revised pilot terms with buyer', 'maya', 3),
  ];
  a.tasks[0].automationKey = 'technical-review';
  const h = base('harbor', 'Harbor Operations', 'Operations', 'sandra');
  h.stage = 'Onboarding';
  h.problem = 'Internal operations agent needs a trustworthy baseline before deployment.';
  agree(h);
  h.tasks = [
    { ...task('h1', 'Accept delivery handoff', 'leo', 1, 'handoff'), automationKey: 'handoff' },
    task('h2', 'Deliver baseline evaluation', 'leo', 7, 'milestone', true),
    task('h3', 'Confirm data access approval', 'sandra', 1),
  ];
  h.blockers = [
    { id: 'hb1', title: 'Customer security team has not approved data access.', resolved: false },
  ];
  const m = base('meridian', 'Meridian Services', 'Financial operations', 'sandra');
  m.stage = 'Active';
  m.problem = 'Customer needs demonstrable improvement before renewing the support-agent program.';
  agree(m);
  m.proposal.latest = 71;
  m.proposal.measuredAt = shiftDay(today, -2);
  m.renewalDate = shiftDay(today, 21);
  m.health = 'At risk';
  m.healthReason = 'Results remain below target; champion needs a recovery plan before renewal.';
  m.tasks = [
    task('m1', 'Deliver recovery experiment report', 'leo', -3, 'milestone', true),
    task('m2', 'Hold customer success review', 'sandra', 2),
  ];
  m.blockers = [
    {
      id: 'mb1',
      title: 'Missing labeled examples for complex policy exceptions.',
      resolved: false,
    },
  ];
  const c = base('cedar', 'Cedar Analytics', 'Analytics', 'maya');
  c.stage = 'Active';
  c.problem = 'Improve structured report extraction while preserving domain-specific conventions.';
  agree(c);
  c.proposal.latest = 86;
  c.proposal.measuredAt = shiftDay(today, -4);
  c.health = 'Healthy';
  c.healthReason = 'Success target exceeded on the agreed holdout set.';
  c.renewalDate = shiftDay(today, 74);
  c.expansionNote = 'Explore adding the document-review team after the next check-in.';
  c.tasks = [task('c1', 'Discuss document-review expansion', 'maya', 8)];
  return [n, a, h, m, c];
}

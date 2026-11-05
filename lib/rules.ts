import { users } from './model';
import type { Account, Signal, Stage } from './model';
import { shiftDay } from './model';
export function reviewCurrent(a: Account) {
  const technicalReviewer = users.find((u) => u.id === a.technicalOwnerId)?.role === 'Engineering';
  return Boolean(
    technicalReviewer &&
      a.technicalOwnerId !== a.ownerId &&
      a.review?.status === 'approved' &&
      a.review.reviewerId === a.technicalOwnerId &&
      a.review.proposalRevision === a.proposal.revision &&
      a.review.requirementRevision === a.restrictions.revision,
  );
}
function riskDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(d.valueOf())
    ? value
    : new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(d);
}
function technicalGateGap(a: Account) {
  if (!a.technicalOwnerId) return 'Assign a technical owner';
  if (a.technicalOwnerId === a.ownerId)
    return 'Assign a technical owner separate from the account owner';
  if (a.review?.status === 'conditional')
    return 'Resolve conditional technical review before advancing';
  return 'Obtain current technical approval';
}
export function dataConflicts(a: Account) {
  const r = a.restrictions,
    p = a.proposal,
    issues: string[] = [];
  if (r.externalAllowed === 'no' && p.externalProcessing)
    issues.push('External processing is forbidden, but the proposal uses an external processor.');
  if (r.trainingAllowed === 'no' && p.trainingUse)
    issues.push('Training use is forbidden, but the proposal includes training.');
  if (r.retention === 'none' && p.retention !== 'none')
    issues.push('No retention is required, but proposed retention is not none.');
  return issues;
}
export function dataUnknown(a: Account) {
  const r = a.restrictions,
    p = a.proposal;
  return (
    r.status === 'unknown' ||
    (p.externalProcessing && r.externalAllowed !== 'yes') ||
    (p.trainingUse && r.trainingAllowed !== 'yes') ||
    (r.status === 'specified' &&
      (r.externalAllowed === 'unknown' ||
        r.trainingAllowed === 'unknown' ||
        r.retention === 'unknown'))
  );
}
export function getGaps(a: Account, nextStage: Stage): string[] {
  const gaps: string[] = [];
  if (nextStage === 'Proposal') {
    if (!a.problem.trim()) gaps.push('Describe the customer problem');
    if (!a.contact.trim()) gaps.push('Add a customer contact');
    if (!a.proposal.scope.trim()) gaps.push('Define proposed scope');
    if (!a.proposal.terms.trim()) gaps.push('Add proposed terms');
    if (!a.proposal.successMetric.trim()) gaps.push('Define a success metric');
    if (!reviewCurrent(a)) gaps.push(technicalGateGap(a));
    if (dataUnknown(a)) gaps.push('Clarify data requirements');
    gaps.push(...dataConflicts(a));
  }
  if (nextStage === 'Negotiation') {
    if (!a.buyer.trim()) gaps.push('Identify the buyer');
    if (!a.proposal.sharedAt) gaps.push('Mark the proposal as shared');
    if (!a.tasks.some((t) => !t.done && t.dueDate && t.type === 'action'))
      gaps.push('Assign a dated commercial next step');
  }
  if (nextStage === 'Onboarding') {
    if (!a.proposal.scope.trim() || !a.proposal.terms.trim())
      gaps.push('Complete agreed scope and terms');
    if (!a.proposal.successMetric.trim()) gaps.push('Define success criteria');
    if (!reviewCurrent(a)) gaps.push(technicalGateGap(a));
    if (dataUnknown(a)) gaps.push('Clarify data requirements');
    gaps.push(...dataConflicts(a));
  }
  if (nextStage === 'Delivery') {
    if (!a.agreement) gaps.push('Confirm a customer agreement');
    if (!reviewCurrent(a)) gaps.push(technicalGateGap(a));
    gaps.push(...dataConflicts(a));
    if (dataUnknown(a)) gaps.push('Clarify data requirements');
    if (!a.tasks.some((t) => t.type === 'milestone' && t.ownerId && t.dueDate))
      gaps.push('Add a dated delivery milestone');
  }
  if (nextStage === 'Active') {
    if (a.tasks.some((t) => t.type === 'milestone' && !t.done))
      gaps.push('Complete delivery milestones');
    if (
      a.proposal.latest === null ||
      !a.proposal.evaluationBasis ||
      a.proposal.comparisonValid === false
    )
      gaps.push('Record a comparable success measurement');
  }
  return [...new Set(gaps)];
}
export function getSignals(a: Account, today: string): Signal[] {
  if (a.stage === 'Lost' || a.stage === 'Ended') return [];
  const s: Signal[] = [];
  const add = (
    key: string,
    severity: Signal['severity'],
    title: string,
    reason: string,
    ownerId: string,
    actionType: string,
  ) => s.push({ key, severity, title, reason, ownerId, actionType });
  const conflict = dataConflicts(a);
  if (conflict.length)
    add(
      'data-conflict',
      'critical',
      a.agreement && a.proposal.revision !== a.agreement.revision
        ? 'Proposed change requires review'
        : 'Proposed data handling needs review',
      conflict.join(' '),
      a.technicalOwnerId || a.ownerId,
      'review',
    );
  if (a.agreement?.handling) {
    const current = { ...a, proposal: { ...a.proposal, ...a.agreement.handling } };
    const currentConflicts = dataConflicts(current);
    if (currentConflicts.length)
      add(
        'current-data-conflict',
        'critical',
        'Current agreement needs review',
        currentConflicts.join(' '),
        a.technicalOwnerId || a.ownerId,
        'review',
      );
  }
  if (dataUnknown(a)) {
    const r = a.restrictions;
    const unknown: string[] = [];
    if (r.status === 'unknown') unknown.push('overall data requirements');
    if (
      (a.proposal.externalProcessing || r.status === 'specified') &&
      r.externalAllowed === 'unknown'
    )
      unknown.push('external processing permission');
    if ((a.proposal.trainingUse || r.status === 'specified') && r.trainingAllowed === 'unknown')
      unknown.push('training use permission');
    if (r.status === 'specified' && r.retention === 'unknown') unknown.push('retention period');
    if (unknown.length)
      add(
        'data-unknown',
        'warning',
        'Clarify data requirements',
        unknown.length === 1 && r.status === 'unknown'
          ? 'Customer data requirements have not been recorded.'
          : `Confirm: ${unknown.join(', ')}.`,
        a.ownerId,
        'restrictions',
      );
  }
  if (a.review && !reviewCurrent(a)) {
    const revisionsChanged =
      a.review.proposalRevision !== a.proposal.revision ||
      a.review.requirementRevision !== a.restrictions.revision;
    const reason = revisionsChanged
      ? 'The proposal or data requirements changed after the last review.'
      : a.review.status === 'conditional'
        ? 'Conditions remain unresolved; the account cannot advance until they are resolved.'
        : a.review.status === 'pending'
          ? 'Technical review is pending; the account cannot advance until the assigned technical owner records a decision.'
          : a.review.status === 'blocked'
            ? 'Technical review is blocked; resolve the identified issues before advancing.'
            : 'The assigned technical owner must approve the current scope.';
    add(
      'review',
      'high',
      a.review.status === 'blocked'
        ? 'Technical review blocked'
        : a.review.status === 'conditional'
          ? 'Conditional technical review unresolved'
          : 'Technical review required',
      reason,
      a.technicalOwnerId || a.ownerId,
      'review',
    );
  }
  const overdue = a.tasks.filter((t) => !t.done && t.committed && t.dueDate && t.dueDate < today);
  if (overdue.length)
    add(
      'overdue',
      'high',
      `${overdue.length} overdue commitment${overdue.length === 1 ? '' : 's'}`,
      overdue.map((t) => `${t.title} (due ${riskDate(t.dueDate)})`).join(' · '),
      overdue[0].ownerId,
      'tasks',
    );
  const lastContact = a.lastContact;
  const contactReference = lastContact || a.createdAt;
  const daysSinceContact = Math.max(
    0,
    Math.floor(
      (Date.parse(today + 'T12:00:00Z') - Date.parse(contactReference + 'T12:00:00Z')) / 86400000,
    ),
  );
  if (
    ['Discovery', 'Proposal', 'Negotiation'].includes(a.stage) &&
    contactReference <= shiftDay(today, -14)
  )
    add(
      'stalled',
      'warning',
      'Deal needs a follow-up',
      lastContact
        ? `Last customer contact: ${riskDate(lastContact)} (${daysSinceContact} days ago).`
        : `No customer contact recorded; account created ${riskDate(a.createdAt)} (${daysSinceContact} days ago).`,
      a.ownerId,
      'meeting',
    );
  if (!a.tasks.some((t) => !t.done && t.dueDate))
    add(
      'next-step',
      'warning',
      'No dated next step',
      'Assign one clear action to keep this account moving.',
      a.ownerId,
      'task',
    );
  if (a.blockers.some((b) => !b.resolved) && overdue.some((t) => t.type === 'milestone'))
    add(
      'delivery-risk',
      'high',
      'Delivery needs intervention',
      'An unresolved blocker and an overdue milestone need a revised delivery plan.',
      a.technicalOwnerId || a.ownerId,
      'delivery',
    );
  const p = a.proposal;
  const target = a.agreement?.target ?? p.target;
  const basis = a.agreement?.evaluationBasis;
  const direction = a.agreement?.direction || p.direction || 'higher';
  const unmeasured =
    p.latest === null ||
    target === null ||
    !p.evaluationBasis ||
    p.comparisonValid === false ||
    Boolean(basis && basis !== p.evaluationBasis);
  const misses = !unmeasured && (direction === 'lower' ? p.latest! > target! : p.latest! < target!);
  if (
    a.agreement &&
    a.renewalDate &&
    a.renewalDate <= shiftDay(today, 30) &&
    (unmeasured || misses)
  ) {
    const metric = p.successMetric || 'Success metric';
    const measurement = unmeasured
      ? `Comparable success has not been measured or validated; ${metric}: latest ${p.latest ?? 'unknown'}, target ${target ?? 'unknown'}.`
      : `${metric}: latest ${p.latest}, target ${target} (${direction === 'lower' ? 'above' : 'below'} target).`;
    add(
      'renewal-risk',
      'high',
      'Renewal needs a success review',
      `Renewal ${riskDate(a.renewalDate)}. ${measurement}`,
      a.ownerId,
      'outcome',
    );
  }
  if (a.health === 'At risk')
    add(
      'relationship',
      'high',
      'Relationship at risk',
      a.healthReason || 'The account owner has flagged this relationship.',
      a.ownerId,
      'overview',
    );
  else if (a.health === 'Watch')
    add(
      'relationship-watch',
      'warning',
      'Relationship on watch',
      a.healthReason || 'The account owner has flagged this relationship for monitoring.',
      a.ownerId,
      'overview',
    );
  if (a.stage === 'Onboarding')
    add(
      'handoff',
      'warning',
      'Handoff awaiting acceptance',
      'The technical owner should review the agreement and accept delivery.',
      a.technicalOwnerId || a.ownerId,
      'handoff',
    );
  const order = { critical: 0, high: 1, warning: 2 };
  return s.sort((x, y) => order[x.severity] - order[y.severity]);
}

// Tasks follow source conditions; generated tasks are never committed work, so they cannot trigger themselves.
export function reconcileRiskTasks(a: Account, today: string) {
  if (a.stage === 'Lost' || a.stage === 'Ended') {
    for (const t of a.tasks) if (t.automationKey?.startsWith('risk:')) t.done = true;
    return;
  }
  const monitored = ['delivery-risk', 'renewal-risk', 'stalled'];
  const signals = getSignals(a, today);
  const titles: Record<string, string> = {
    'delivery-risk': 'Review delivery recovery plan',
    'renewal-risk': 'Review customer success before renewal',
    stalled: 'Follow up with customer',
  };
  for (const key of monitored) {
    const signal = signals.find((s) => s.key === key),
      automationKey = 'risk:' + key;
    const existing = a.tasks.find((t) => t.automationKey === automationKey);
    if (signal) {
      if (existing) {
        existing.done = false;
        existing.ownerId = signal.ownerId;
      } else
        a.tasks.push({
          id: crypto.randomUUID(),
          title: titles[key],
          ownerId: signal.ownerId,
          dueDate: shiftDay(today, 2),
          done: false,
          committed: false,
          type: 'action',
          automationKey,
        });
    } else if (existing) existing.done = true;
  }
}

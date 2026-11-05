/* eslint-disable @typescript-eslint/no-explicit-any */
import { env } from 'cloudflare:workers';
import { emptyAccount, todayLA, users, shiftDay } from '@/lib/model';
import type { Account, Stage, Task } from '@/lib/model';
import { dataConflicts, dataUnknown, getGaps, reconcileRiskTasks } from '@/lib/rules';
import {
  readJsonObject,
  RequestValidationError,
  validCalendarDate,
  boundedText,
} from '@/lib/validation';
const stages: Stage[] = [
  'Discovery',
  'Proposal',
  'Negotiation',
  'Onboarding',
  'Delivery',
  'Active',
];
class Invalid extends Error {
  gaps?: string[];
  constructor(message: string, gaps?: string[]) {
    super(message);
    this.gaps = gaps;
  }
}
const string = (v: unknown, fallback = '') => (typeof v === 'string' ? v.trim() : fallback);
const date = (v: unknown, today = todayLA(), futureOnly = false) => {
  const s = string(v);
  if (s && !validCalendarDate(s, today, !futureOnly))
    throw new Invalid('Use a real calendar date between 2000 and five years from today.');
  return s;
};
const member = (v: unknown, optional = false) => {
  const s = string(v);
  if (optional && !s) return '';
  if (!users.some((u) => u.id === s)) throw new Invalid('Choose a team member.');
  return s;
};
const numeric = (v: unknown) => {
  if (v === null || v === '') return null;
  if ((typeof v !== 'number' && typeof v !== 'string') || (typeof v === 'string' && !v.trim()))
    throw new Invalid('Measurements must be finite nonnegative numbers.');
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0)
    throw new Invalid('Measurements must be finite nonnegative numbers.');
  return n;
};
const technical = (id: string) => users.some((u) => u.id === id && u.role === 'Engineering');
function ensureTask(
  a: Account,
  key: string,
  title: string,
  ownerId: string,
  today: string,
  type: Task['type'],
) {
  let t = a.tasks.find((t) => t.automationKey === key);
  if (t) {
    t.done = false;
    t.ownerId = ownerId;
    t.title = title;
  } else {
    t = {
      id: crypto.randomUUID(),
      title,
      ownerId,
      dueDate: shiftDay(today, 2),
      done: false,
      committed: false,
      type,
      automationKey: key,
    };
    a.tasks.push(t);
  }
}
export async function POST(req: Request) {
  try {
    if (!env.DB)
      return Response.json({ error: 'Shared database is not configured.' }, { status: 503 });
    const body = (await readJsonObject(req)) as unknown as {
      action: string;
      accountId?: string;
      version?: number;
      actorId: string;
      data?: Record<string, any>;
    };
    const { action, accountId, version } = body;
    const d = body.data ?? {};
    if (!d || typeof d !== 'object' || Array.isArray(d))
      throw new Invalid('Data must be an object.');
    const actorId = member(body.actorId);
    const today = todayLA();
    let a: Account;
    if (action === 'createAccount') {
      const allowed = ['name', 'ownerId', 'industry', 'contact', 'buyer', 'problem'];
      if (Object.keys(d).some((k) => !allowed.includes(k)))
        throw new Invalid('Unknown account field.');
      const name = boundedText(d.name, 120, 'Account name');
      if (!name) throw new Invalid('Account name is required.');
      a = emptyAccount(name, member(d.ownerId || actorId), today);
      for (const k of ['industry', 'contact', 'buyer', 'problem'] as const)
        if (k in d) a[k] = boundedText(d[k], k === 'problem' ? 4000 : 120, k);
      a.activity.push({ id: crypto.randomUUID(), date: today, text: 'Account created', actorId });
      await env.DB.prepare('INSERT INTO accounts (id,version,payload) VALUES (?,?,?)')
        .bind(a.id, a.version, JSON.stringify(a))
        .run();
      return Response.json({ account: a });
    }
    const row = await env.DB.prepare('SELECT payload,version FROM accounts WHERE id=?')
      .bind(string(accountId))
      .first<{ payload: string; version: number }>();
    if (!row) return Response.json({ error: 'Account not found.' }, { status: 404 });
    if (version !== row.version)
      return Response.json(
        { error: 'This account changed in another session. Refresh and try again.' },
        { status: 409 },
      );
    a = JSON.parse(row.payload);
    let activity = '';
    if (a.stage === 'Lost' || a.stage === 'Ended') {
      if (action !== 'reopenAccount')
        throw new Invalid('Closed accounts must be reopened before they can be changed.');
    } else if (action === 'reopenAccount') throw new Invalid('This account is already open.');
    switch (action) {
      case 'reopenAccount': {
        const prior = (a as any).closedFromStage as Stage | undefined;
        if (!prior || !stages.includes(prior))
          throw new Invalid('Previous account stage is unavailable.');
        a.stage = prior;
        delete (a as any).closedFromStage;
        for (const t of a.tasks as any[])
          if (t.cancelled) {
            t.cancelled = false;
            t.done = false;
          }
        activity = `Reopened account in ${prior}`;
        break;
      }
      case 'editAccount': {
        const allowed = [
          'name',
          'industry',
          'contact',
          'buyer',
          'problem',
          'healthReason',
          'expansionNote',
          'ownerId',
          'technicalOwnerId',
          'health',
          'renewalDate',
        ];
        if (Object.keys(d).some((k) => !allowed.includes(k)))
          throw new Invalid('Unknown account field.');
        for (const k of [
          'name',
          'industry',
          'contact',
          'buyer',
          'problem',
          'healthReason',
          'expansionNote',
        ] as const)
          if (k in d)
            a[k] = boundedText(
              d[k],
              k === 'problem' || k === 'healthReason' || k === 'expansionNote'
                ? 4000
                : k === 'name'
                  ? 120
                  : 240,
              k,
            );
        if (!a.name) throw new Invalid('Account name is required.');
        if ('ownerId' in d) a.ownerId = member(d.ownerId);
        if ('technicalOwnerId' in d) {
          const id = member(d.technicalOwnerId, true);
          if (id && (!technical(id) || id === a.ownerId))
            throw new Invalid(
              'Technical owner must be an Engineering teammate other than the account owner.',
            );
          a.technicalOwnerId = id;
        }
        if (a.technicalOwnerId && a.technicalOwnerId === a.ownerId)
          throw new Invalid('Technical owner must differ from the account owner.');
        if ('health' in d) {
          if (!['Unknown', 'Healthy', 'Watch', 'At risk'].includes(d.health))
            throw new Invalid('Invalid health status.');
          a.health = d.health;
        }
        if ('renewalDate' in d) a.renewalDate = date(d.renewalDate);
        if (a.health !== 'Unknown' && !a.healthReason.trim())
          throw new Invalid('Explain the relationship health assessment.');
        activity = 'Account details updated';
        break;
      }
      case 'saveProposal': {
        const allowed = [
          'scope',
          'terms',
          'successMetric',
          'evaluationBasis',
          'retention',
          'externalProcessing',
          'trainingUse',
          'baseline',
          'target',
          'sharedAt',
          'direction',
        ];
        if (Object.keys(d).some((k) => !allowed.includes(k)))
          throw new Invalid('Unknown proposal field.');
        const before = JSON.stringify(a.proposal);
        const hadProposal = Boolean(
          a.proposal.scope || a.proposal.terms || a.proposal.successMetric,
        );
        const material = [
          'scope',
          'terms',
          'successMetric',
          'evaluationBasis',
          'retention',
        ] as const;
        let changed = false;
        for (const k of material)
          if (k in d && string(d[k]) !== a.proposal[k]) {
            a.proposal[k] = boundedText(d[k], k === 'scope' || k === 'terms' ? 4000 : 8000, k);
            changed = true;
          }
        for (const k of ['externalProcessing', 'trainingUse'] as const)
          if (k in d) {
            if (typeof d[k] !== 'boolean') throw new Invalid('Invalid data-handling option.');
            if (a.proposal[k] !== d[k]) changed = true;
            a.proposal[k] = d[k];
          }
        for (const k of [
          'scope',
          'terms',
          'successMetric',
          'evaluationBasis',
          'retention',
        ] as const)
          if (k in d) boundedText(d[k], k === 'scope' || k === 'terms' ? 4000 : 8000, k);
        if ('direction' in d && !['higher', 'lower'].includes(d.direction))
          throw new Invalid('Invalid metric direction.');
        if ('direction' in d && d.direction !== (a.proposal.direction || 'higher')) changed = true;
        for (const k of ['baseline', 'target'] as const)
          if (k in d) {
            const n = numeric(d[k]);
            if (n !== a.proposal[k]) changed = true;
            a.proposal[k] = n;
          }
        if (a.proposal.baseline !== null && a.proposal.target !== null) {
          const dir = ('direction' in d ? d.direction : a.proposal.direction) || 'higher';
          if (
            (dir === 'higher' && a.proposal.target <= a.proposal.baseline) ||
            (dir === 'lower' && a.proposal.target >= a.proposal.baseline)
          )
            throw new Invalid('Target must show improvement for the selected direction.');
        }
        if ('direction' in d) a.proposal.direction = d.direction;
        if ('sharedAt' in d) {
          a.proposal.sharedAt = date(d.sharedAt, today);
          if (a.proposal.sharedAt && a.proposal.sharedAt > today)
            throw new Invalid('Shared date cannot be in the future.');
        }
        if (changed && before !== JSON.stringify(emptyAccount(a.name, a.ownerId, today).proposal)) {
          a.proposal.revision++;
          ensureTask(
            a,
            'technical-review',
            'Review revised scope and data handling',
            a.technicalOwnerId || a.ownerId,
            today,
            'review',
          );
        }
        if (before !== JSON.stringify(a.proposal))
          activity = changed
            ? 'Proposal revised; technical review reopened'
            : 'Proposal marked shared';
        break;
      }
      case 'saveRestrictions': {
        const allowedKeys = [
          'status',
          'externalAllowed',
          'trainingAllowed',
          'retention',
          'wording',
          'revision',
        ];
        if (Object.keys(d).some((k) => !allowedKeys.includes(k)))
          throw new Invalid('Unknown data restriction field.');
        let changed = false;
        const allowed = {
          status: ['unknown', 'none', 'specified'],
          externalAllowed: ['yes', 'no', 'unknown'],
          trainingAllowed: ['yes', 'no', 'unknown'],
          retention: ['none', 'custom', 'unknown'],
        };
        for (const [k, opts] of Object.entries(allowed)) {
          if (k in d) {
            if (!opts.includes(d[k])) throw new Invalid('Invalid restriction value.');
            if ((a.restrictions as unknown as Record<string, unknown>)[k] !== d[k]) changed = true;
            (a.restrictions as unknown as Record<string, unknown>)[k] = d[k];
          }
        }
        if ('wording' in d) {
          if (a.restrictions.wording !== string(d.wording)) changed = true;
          a.restrictions.wording = boundedText(d.wording, 4000, 'Wording');
        }
        if (changed) {
          a.restrictions.revision++;
          ensureTask(
            a,
            'technical-review',
            'Review customer data requirements',
            a.technicalOwnerId || a.ownerId,
            today,
            'review',
          );
          activity = 'Data requirements updated; review reopened';
        }
        break;
      }
      case 'requestReview': {
        if (
          !a.technicalOwnerId ||
          a.technicalOwnerId === a.ownerId ||
          !technical(a.technicalOwnerId)
        )
          throw new Invalid('Assign a technical owner before requesting review.');
        if (
          a.review?.status === 'pending' &&
          a.review.proposalRevision === a.proposal.revision &&
          a.review.requirementRevision === a.restrictions.revision
        )
          return Response.json({ account: a });
        a.review = {
          status: 'pending',
          proposalRevision: a.proposal.revision,
          requirementRevision: a.restrictions.revision,
          note:
            'note' in d
              ? boundedText(d.note, 4000, 'Review note')
              : 'Please validate this scope and its data handling.',
          reviewerId: a.technicalOwnerId || actorId,
        };
        ensureTask(
          a,
          'technical-review',
          'Review technical feasibility and data handling',
          a.technicalOwnerId || a.ownerId,
          today,
          'review',
        );
        activity = 'Technical review requested';
        break;
      }
      case 'decideReview': {
        if (
          !a.technicalOwnerId ||
          actorId !== a.technicalOwnerId ||
          actorId === a.ownerId ||
          !technical(actorId)
        )
          throw new Invalid('Switch to the assigned technical owner to record this decision.');
        if (!['approved', 'conditional', 'blocked'].includes(d.status))
          throw new Invalid('Choose a review decision.');
        const reviewNote = boundedText(d.note, 4000, 'Decision note');
        if (!reviewNote) throw new Invalid('Add a decision note.');
        if (d.status === 'approved') {
          const gaps = [
            ...dataConflicts(a),
            ...(dataUnknown(a) ? ['Clarify data requirements before approving'] : []),
          ];
          if (gaps.length) throw new Invalid('Resolve data requirements before approval.', gaps);
        }
        a.review = {
          status: d.status,
          proposalRevision: a.proposal.revision,
          requirementRevision: a.restrictions.revision,
          note: reviewNote,
          reviewerId: actorId,
        };
        a.reviewHistory ??= [];
        a.reviewHistory.push({ ...a.review, date: today, actorId });
        a.reviewHistory = a.reviewHistory.slice(-100);
        ensureTask(
          a,
          'technical-review',
          'Review technical feasibility and data handling',
          actorId,
          today,
          'review',
        );
        a.tasks.find((t) => t.automationKey === 'technical-review')!.done = d.status === 'approved';
        if (d.status === 'approved')
          a.tasks
            .filter((t) =>
              ['grading:zdr-review', 'grading:data-restrictions'].includes(t.automationKey || ''),
            )
            .forEach((t) => (t.done = true));
        activity = `Technical review ${d.status}`;
        break;
      }
      case 'advance': {
        const next = d.stage as Stage;
        const ci = stages.indexOf(a.stage),
          ni = stages.indexOf(next);
        if (next === 'Lost') {
          if (ci < 0 || ci > 2)
            throw new Invalid('Only open presales accounts can be marked lost.');
          if (!string(d.reason)) throw new Invalid('Record why the deal was lost.');
        } else if (next === 'Ended') {
          if (ci < 3) throw new Invalid('Only customer engagements can be ended.');
          if (!string(d.reason)) throw new Invalid('Record the engagement outcome.');
        } else {
          if (ni !== ci + 1 || ci < 0) throw new Invalid('Advance one stage at a time.');
          const gaps = getGaps(a, next);
          if (next === 'Onboarding' && !string(d.evidence))
            gaps.push('Record customer acceptance evidence');
          if (next === 'Delivery' && actorId !== a.technicalOwnerId)
            gaps.push('The technical owner must accept this handoff');
          if (gaps.length) throw new Invalid('Complete the readiness checklist first.', gaps);
          if (next === 'Onboarding') {
            a.agreement = {
              scope: a.proposal.scope,
              terms: a.proposal.terms,
              successMetric: a.proposal.successMetric,
              acceptedAt: today,
              evidence: boundedText(d.evidence, 4000, 'Acceptance evidence'),
              revision: a.proposal.revision,
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
            ensureTask(
              a,
              'handoff',
              'Accept delivery handoff',
              a.technicalOwnerId,
              today,
              'handoff',
            );
          }
          if (next === 'Delivery')
            a.tasks.filter((t) => t.type === 'handoff').forEach((t) => (t.done = true));
        }
        if (next === 'Lost' || next === 'Ended') {
          (a as any).closedFromStage = a.stage;
          for (const t of a.tasks as any[])
            if (!t.done) {
              t.cancelled = true;
              t.done = true;
            }
        }
        a.stage = next;
        activity = `Moved to ${next}${string(d.reason) ? ': ' + boundedText(d.reason, 4000, 'Reason') : ''}`;
        break;
      }
      case 'addTask': {
        const title = boundedText(d.title, 240, 'Action title');
        if (!title) throw new Invalid('Action title is required.');
        const type = d.type || 'action';
        if ('committed' in d && typeof d.committed !== 'boolean')
          throw new Invalid('Commitment must be true or false.');
        if (!['action', 'milestone'].includes(type))
          throw new Invalid('Use the review workflow for review tasks.');
        const dueDate = date(d.dueDate, today);
        if (!dueDate) throw new Invalid('Choose a due date.');
        a.tasks.push({
          id: crypto.randomUUID(),
          title,
          ownerId: member(d.ownerId || a.ownerId),
          dueDate,
          done: false,
          committed: type === 'milestone' || Boolean(d.committed),
          type,
        });
        activity = 'Action assigned: ' + title;
        break;
      }
      case 'editTask': {
        const task = a.tasks.find((t) => t.id === d.taskId);
        if (!task) throw new Invalid('Task not found.');
        if (task.automationKey)
          throw new Invalid('Update the source issue to change an automated task.');
        if ('title' in d) {
          task.title = boundedText(d.title, 240, 'Action title');
          if (!task.title) throw new Invalid('Action title is required.');
        }
        if ('ownerId' in d) task.ownerId = member(d.ownerId);
        if ('dueDate' in d) {
          task.dueDate = date(d.dueDate, today);
          if (!task.dueDate) throw new Invalid('Choose a due date.');
        }
        if ('committed' in d) {
          if (typeof d.committed !== 'boolean')
            throw new Invalid('Commitment must be true or false.');
          task.committed = task.type === 'milestone' || d.committed;
        }
        activity = 'Action updated: ' + task.title;
        break;
      }
      case 'completeTask':
      case 'setTaskDone': {
        const task = a.tasks.find((t) => t.id === d.taskId);
        if (!task) throw new Invalid('Task not found.');
        if (task.automationKey && task.automationKey !== 'grading:discovery-followup')
          throw new Invalid('Resolve the underlying risk; this follow-up closes automatically.');
        if (task.type === 'review' || task.type === 'handoff')
          throw new Invalid('Complete this task through its review or handoff decision.');
        if (action === 'setTaskDone' && typeof d.done !== 'boolean')
          throw new Invalid('Choose whether the action is done.');
        task.done = action === 'setTaskDone' ? d.done : !task.done;
        activity = `Action ${task.done ? 'completed' : 'reopened'}: ${task.title}`;
        break;
      }
      case 'deleteTask': {
        const ix = a.tasks.findIndex((t) => t.id === d.taskId);
        if (ix < 0) throw new Invalid('Task not found.');
        if (a.tasks[ix].automationKey) throw new Invalid('Automated tasks cannot be deleted.');
        a.tasks.splice(ix, 1);
        activity = 'Manual action deleted';
        break;
      }
      case 'logMeeting': {
        const summary = boundedText(d.summary, 4000, 'Meeting summary');
        if (!summary) throw new Invalid('Add a meeting summary.');
        const when = date(d.date, today) || today;
        if (when > today) throw new Invalid('Log meetings after they occur.');
        a.meetings.unshift({ id: crypto.randomUUID(), date: when, summary, actorId });
        if (!a.lastContact || when > a.lastContact) a.lastContact = when;
        const follow = d.nextAction || d.action;
        if (follow && string(follow.title)) {
          if (
            ('meetingFollowUpCommitted' in d && typeof d.meetingFollowUpCommitted !== 'boolean') ||
            ('committed' in follow && typeof follow.committed !== 'boolean')
          )
            throw new Invalid('Commitment must be true or false.');
          const dueDate = date(follow.dueDate);
          if (!dueDate) throw new Invalid('Choose a follow-up due date.');
          a.tasks.push({
            id: crypto.randomUUID(),
            title: boundedText(follow.title, 240, 'Action title'),
            ownerId: member(follow.ownerId || a.ownerId),
            dueDate,
            done: false,
            committed: Boolean(d.meetingFollowUpCommitted ?? follow.committed),
            type: 'action',
          });
        }
        activity = 'Customer meeting logged';
        break;
      }
      case 'editMeeting': {
        const m = a.meetings.find((x) => x.id === d.meetingId);
        if (!m) throw new Invalid('Meeting not found.');
        if ('summary' in d) m.summary = boundedText(d.summary, 4000, 'Meeting summary');
        else throw new Invalid('Add a meeting summary.');
        if (!m.summary.trim()) throw new Invalid('Add a meeting summary.');
        if ('date' in d) {
          m.date = date(d.date, today);
          if (!m.date) throw new Invalid('Choose a meeting date.');
          if (m.date > today) throw new Invalid('Log meetings after they occur.');
        } else throw new Invalid('Choose a meeting date.');
        m.actorId = actorId;
        activity = 'Meeting updated';
        break;
      }
      case 'deleteMeeting': {
        const ix = a.meetings.findIndex((x) => x.id === d.meetingId);
        if (ix < 0) throw new Invalid('Meeting not found.');
        a.meetings.splice(ix, 1);
        activity = 'Meeting deleted';
        break;
      }
      case 'addBlocker': {
        if (!['Onboarding', 'Delivery', 'Active'].includes(a.stage))
          throw new Invalid('Blockers are available during customer delivery.');
        const title = string(d.title);
        if (!title) throw new Invalid('Describe the blocker.');
        if (title.length > 240) throw new Invalid('Blocker title must be 240 characters or fewer.');
        a.blockers.push({ id: crypto.randomUUID(), title, resolved: false });
        activity = 'Blocker added: ' + title;
        break;
      }
      case 'editBlocker': {
        if (!['Onboarding', 'Delivery', 'Active'].includes(a.stage))
          throw new Invalid('Blockers are available during customer delivery.');
        const b = a.blockers.find((x) => x.id === d.blockerId);
        if (!b) throw new Invalid('Blocker not found.');
        if ('title' in d) b.title = boundedText(d.title, 240, 'Blocker title');
        if (!b.title) throw new Invalid('Describe the blocker.');
        if ('resolved' in d) {
          if (typeof d.resolved !== 'boolean') throw new Invalid('Invalid blocker status.');
          b.resolved = d.resolved;
        }
        activity = 'Blocker updated';
        break;
      }
      case 'deleteBlocker': {
        if (!['Onboarding', 'Delivery', 'Active'].includes(a.stage))
          throw new Invalid('Blockers are available during customer delivery.');
        const ix = a.blockers.findIndex((x) => x.id === d.blockerId);
        if (ix < 0) throw new Invalid('Blocker not found.');
        a.blockers.splice(ix, 1);
        activity = 'Blocker deleted';
        break;
      }
      case 'resolveBlocker': {
        if (!['Onboarding', 'Delivery', 'Active'].includes(a.stage))
          throw new Invalid('Blockers are available during customer delivery.');
        const b = a.blockers.find((b) => b.id === d.blockerId);
        if (!b) throw new Invalid('Blocker not found.');
        b.resolved = !b.resolved;
        if ('note' in d) b.resolutionNote = boundedText(d.note, 4000, 'Resolution note');
        activity = `Blocker ${b.resolved ? 'resolved' : 'reopened'}: ${b.title}`;
        break;
      }
      case 'recordOutcome': {
        if (!['Onboarding', 'Delivery', 'Active'].includes(a.stage))
          throw new Invalid('Outcomes can be recorded after customer acceptance.');
        let criterionChanged = false;
        if ('successMetric' in d) {
          const metric = string(d.successMetric);
          if (a.agreement && metric !== a.agreement.successMetric)
            throw new Invalid(
              'The accepted success metric is fixed. Record results against it; propose scope changes separately.',
            );
          if (!metric) throw new Invalid('Name the success metric.');
          criterionChanged = metric !== a.proposal.successMetric;
          a.proposal.successMetric = boundedText(metric, 8000, 'Success metric');
        }
        for (const k of ['baseline', 'target', 'latest'] as const)
          if (k in d) a.proposal[k] = numeric(d[k]);
        if (a.proposal.latest === null) throw new Invalid('Record a numeric latest result.');
        if ('evaluationBasis' in d) {
          const basis = string(d.evaluationBasis);
          if (basis !== a.proposal.evaluationBasis && !('baseline' in d && 'target' in d))
            throw new Invalid('Provide a baseline and target for the new evaluation basis.');
          a.proposal.evaluationBasis = boundedText(basis, 8000, 'Evaluation basis');
        }
        if (!a.proposal.evaluationBasis.trim()) throw new Invalid('Name the evaluation basis.');
        if ('direction' in d) {
          if (!['higher', 'lower'].includes(d.direction))
            throw new Invalid('Invalid metric direction.');
          a.proposal.direction = d.direction;
        }
        if (
          a.agreement &&
          (a.proposal.evaluationBasis !== a.agreement.evaluationBasis ||
            a.proposal.baseline !== a.agreement.baseline ||
            a.proposal.target !== a.agreement.target ||
            (a.proposal.direction || 'higher') !== (a.agreement.direction || 'higher'))
        )
          throw new Invalid(
            'Results must use the accepted evaluation basis, baseline, target, and direction.',
          );
        if (a.proposal.baseline !== null && a.proposal.target !== null) {
          const dir = 'direction' in d ? d.direction : a.proposal.direction || 'higher';
          if (
            (dir === 'higher' && a.proposal.target <= a.proposal.baseline) ||
            (dir === 'lower' && a.proposal.target >= a.proposal.baseline)
          )
            throw new Invalid('Target must show improvement for the selected direction.');
        }
        const measuredAt = 'measuredAt' in d ? date(d.measuredAt, today) : today;
        if (!measuredAt) throw new Invalid('Choose a measurement date.');
        if (measuredAt > today) throw new Invalid('Measurement date cannot be in the future.');
        a.proposal.measuredAt = measuredAt;
        a.proposal.comparisonValid = true;
        if ('direction' in d) {
          if (!['higher', 'lower'].includes(d.direction))
            throw new Invalid('Invalid metric direction.');
          a.proposal.direction = d.direction;
        }
        if (
          a.proposal.baseline !== null &&
          a.proposal.target !== null &&
          ((a.proposal.direction === 'higher' && a.proposal.target <= a.proposal.baseline) ||
            (a.proposal.direction === 'lower' && a.proposal.target >= a.proposal.baseline))
        )
          throw new Invalid('Target must show improvement for the selected direction.');
        if (criterionChanged) {
          a.proposal.revision++;
          ensureTask(
            a,
            'technical-review',
            'Review revised success metric',
            a.technicalOwnerId || a.ownerId,
            today,
            'review',
          );
        }
        a.outcomeHistory ??= [];
        a.outcomeHistory.push({
          date: measuredAt,
          value: a.proposal.latest ?? 0,
          baseline: a.proposal.baseline,
          target: a.proposal.target,
          evaluationBasis: a.proposal.evaluationBasis,
          actorId,
        });
        a.outcomeHistory = a.outcomeHistory.slice(-100);
        activity = 'Customer success measurement recorded';
        break;
      }
      default:
        throw new Invalid('Unknown action.');
    }
    reconcileRiskTasks(a, today);
    if (activity)
      a.activity.unshift({
        id: crypto.randomUUID(),
        date: today,
        text: activity.slice(0, 300),
        actorId,
      });
    if (a.activity.length > 100) a.activity.length = 100;
    a.version = row.version + 1;
    const result = await env.DB.prepare(
      'UPDATE accounts SET version=?,payload=? WHERE id=? AND version=?',
    )
      .bind(a.version, JSON.stringify(a), a.id, row.version)
      .run();
    if (!result.meta.changes)
      return Response.json(
        { error: 'This account changed in another session. Refresh and try again.' },
        { status: 409 },
      );
    return Response.json({ account: a });
  } catch (e) {
    if (e instanceof Invalid)
      return Response.json({ error: e.message, gaps: e.gaps }, { status: 400 });
    if (e instanceof RequestValidationError)
      return Response.json({ error: e.message }, { status: 400 });
    console.error(e);
    return Response.json(
      { error: 'Unable to save this change. Please try again.' },
      { status: 500 },
    );
  }
}

import type {Account} from '@/lib/model';
export function AgreementDetails({account:a}:{account:Account}){
 const g=a.agreement;if(!g)return null;
 return <dl className="facts handoff-details">
 <div><dt>Accepted scope</dt><dd>{g.scope}</dd></div>
 <div><dt>Price, terms & timeline</dt><dd>{g.terms}</dd></div>
 <div><dt>Success metric</dt><dd>{g.successMetric}</dd></div>
 <div><dt>Baseline → target</dt><dd>{g.baseline??'Not recorded'} → {g.target??'Not recorded'} ({g.direction==='lower'?'lower':'higher'} is better)</dd></div>
 <div><dt>Evaluation dataset / method</dt><dd>{g.evaluationBasis||'Not recorded'}</dd></div>
 <div><dt>Customer restrictions</dt><dd>{g.restrictions?.wording||'None recorded'}{g.restrictions&&<p>External processing: {g.restrictions.externalAllowed==='yes'?'Allowed':g.restrictions.externalAllowed==='no'?'Not allowed':'Unconfirmed'} · Training: {g.restrictions.trainingAllowed==='yes'?'Allowed':g.restrictions.trainingAllowed==='no'?'Not allowed':'Unconfirmed'} · Retention: {g.restrictions.retention==='none'?'None':g.restrictions.retention}</p>}</dd></div>
 <div><dt>Acceptance evidence</dt><dd>{g.evidence}</dd></div>
 <div><dt>Technical review</dt><dd>{a.review?.note||'No review note'}</dd></div>
 </dl>
}

import {env} from 'cloudflare:workers';
import {todayLA,users} from '@/lib/model';
import {emptyCalibration,ensureGradingTask,validateCalibration,disagreementCount} from '@/lib/grading';
import type {Calibration} from '@/lib/grading';
import type {Account} from '@/lib/model';
class Invalid extends Error{}
const text=(v:unknown)=>typeof v==='string'?v.trim():'';
export async function POST(req:Request){try{
 if(!env.DB)return Response.json({error:'Shared database is not configured.'},{status:503});
 const body=await req.json() as {accountId?:string;version?:number;actorId?:string;action?:string;calibration?:Calibration;decision?:string;note?:string;complete?:boolean};
 const actor=users.find(u=>u.id===body.actorId);if(!actor)throw new Invalid('Choose a demo teammate.');
 const row=await env.DB.prepare('SELECT payload,version FROM accounts WHERE id=?').bind(text(body.accountId)).first<{payload:string;version:number}>();
 if(!row)return Response.json({error:'Account not found.'},{status:404});if(body.version!==row.version)return Response.json({error:'This account changed in another session. Refresh and try again.'},{status:409});
 const a=JSON.parse(row.payload) as Account;const c=a.grading||emptyCalibration();const today=todayLA();let message='';
 switch(body.action){
 case 'save': {

  const incoming=body.calibration;if(!incoming||typeof incoming!=='object'||Array.isArray(incoming))throw new Invalid('Calibration data is required.');
  if(incoming.dataPath!=='synthetic')throw new Invalid('Customer-data calibration is disabled pending current technical and data-policy approval. No upload is accepted.');
  const normalized:Calibration={task:incoming.task,outcome:incoming.outcome,expertName:incoming.expertName,dataRestrictions:incoming.dataRestrictions,dataPath:'synthetic',examples:incoming.examples,judgments:incoming.judgments,revision:c.revision,updatedAt:today,datasetVersion:'support-synthetic-v1',graderVersion:'demo-rubric-v1',snapshot:c.snapshot,snapshots:c.snapshots|| (c.snapshot?[c.snapshot]:[]),review:c.review};
  for(const k of ['task','outcome','expertName','dataRestrictions'] as const)if(typeof normalized[k]!=='string')throw new Invalid('Calibration text fields must be plain text.');
  if(!Array.isArray(normalized.examples)||normalized.examples.length!==3||normalized.examples.some(x=>!x||typeof x!=='object'||!['refund','security','escalation'].includes(x.id)||!['','pass','fail'].includes(x.label)||typeof x.reason!=='string')||new Set(normalized.examples.map(x=>x.id)).size!==3)throw new Invalid('Invalid customer grading entries.');
  if(!Array.isArray(normalized.judgments)||normalized.judgments.length!==2||normalized.judgments.some(x=>!x||typeof x!=='object'||!['policy','safety'].includes(x.id)||!['','agree','disagree'].includes(x.agreement)||typeof x.correction!=='string')||new Set(normalized.judgments.map(x=>x.id)).size!==2)throw new Invalid('Invalid simulated grader review.');
  const evidenceChanged=JSON.stringify([c.task,c.outcome,c.expertName,c.examples,c.judgments,c.dataRestrictions,c.dataPath])!==JSON.stringify([normalized.task,normalized.outcome,normalized.expertName,normalized.examples,normalized.judgments,normalized.dataRestrictions,normalized.dataPath]);
  normalized.examples=['refund','security','escalation'].map(id=>{const x=normalized.examples.find(x=>x.id===id)!;return {id,label:x.label,reason:x.reason}});normalized.judgments=['policy','safety'].map(id=>{const x=normalized.judgments.find(x=>x.id===id)!;return {id,agreement:x.agreement,correction:x.correction}});
  if(normalized.dataRestrictions!==c.dataRestrictions){a.restrictions.revision++;ensureGradingTask(a.tasks,'grading:data-restrictions','Review customer data restrictions for grading',a.technicalOwnerId||a.ownerId,today);}
  normalized.revision=c.revision+(evidenceChanged?1:0);normalized.snapshot=c.snapshot;normalized.snapshots=c.snapshots|| (c.snapshot?[c.snapshot]:[]);normalized.review=c.review;
  if(evidenceChanged&&c.review){c.review={...c.review,status:'open'};normalized.review=c.review;ensureGradingTask(a.tasks,'grading:calibration-review','Review updated grading calibration',c.review.reviewerId||a.technicalOwnerId||a.ownerId,today);}
  a.grading=normalized;message='Grading calibration progress saved';break;
 }
 case 'request-zdr': {
  ensureGradingTask(a.tasks,'grading:zdr-review','Review ZDR and customer data requirements',a.technicalOwnerId||a.ownerId,today);message='ZDR review requested';break;
 }
 case 'resolve-review': {
  if(!c.review||c.review.status!=='open')throw new Invalid('There is no open calibration review.');
  if(actor.id!==c.review.reviewerId)throw new Invalid('Switch to the assigned technical reviewer to resolve this review.');
  if(!['accepted','changes-required'].includes(body.decision||'')||!text(body.note))throw new Invalid('Choose a review decision and add a note.');
  c.review={...c.review,status:body.decision==='accepted'?'resolved':'open',decision:body.decision!,note:text(body.note),revision:c.revision};
  ensureGradingTask(a.tasks,'grading:calibration-review','Review grading calibration',c.review.reviewerId,today).done=body.decision==='accepted';a.grading=c;message='Calibration review updated';break;
 }
 default:throw new Invalid('Unknown calibration action.');
 }
 if(body.action==='save'&&a.grading){const c=a.grading;const gaps=validateCalibration(c);if(body.complete&&gaps.length)throw new Invalid(gaps.join(' '));if(!text(c.expertName))ensureGradingTask(a.tasks,'grading:expert','Identify a customer grading expert',a.ownerId,today);else{const expertTask=a.tasks.find(t=>t.automationKey==='grading:expert');if(expertTask)expertTask.done=true;}if(c.dataRestrictions.trim()&&!(a.review?.status==='approved'&&a.review.proposalRevision===a.proposal.revision&&a.review.requirementRevision===a.restrictions.revision))ensureGradingTask(a.tasks,'grading:data-restrictions','Review customer data restrictions for grading',a.technicalOwnerId||a.ownerId,today);else{const t=a.tasks.find(t=>t.automationKey==='grading:data-restrictions');if(t)t.done=true;}if(!gaps.length){const disagreed=disagreementCount(c);if(disagreed&&!c.review){c.review={status:'open',revision:c.revision,reviewerId:a.technicalOwnerId||a.ownerId,decision:'',note:''};}if(disagreed&&c.review?.status==='open')ensureGradingTask(a.tasks,'grading:calibration-review','Review grading calibration disagreements',c.review.reviewerId,today);if(!c.snapshot||c.snapshot.revision!==c.revision){const follow=ensureGradingTask(a.tasks,'grading:discovery-followup','Follow up on grading discovery',a.ownerId,today);follow.type='action';}if(body.complete){c.snapshot={revision:c.revision,reviewedAt:today,expertName:c.expertName,passCount:c.examples.filter(x=>x.label==='pass').length,failCount:c.examples.filter(x=>x.label==='fail').length,disagreementCount:disagreed,unresolvedNeeds:[...(c.dataRestrictions?['Technical/data-policy review']:[]),...(disagreed?['Technical calibration decision']:[])]};if(!c.snapshots?.some(s=>s.revision===c.snapshot!.revision)){c.snapshots=[...(c.snapshots||[]),c.snapshot].slice(-10);}}}}
 a.activity.unshift({id:crypto.randomUUID(),date:today,text:message});a.version=row.version+1;const result=await env.DB.prepare('UPDATE accounts SET version=?,payload=? WHERE id=? AND version=?').bind(a.version,JSON.stringify(a),a.id,row.version).run();if(!result.meta.changes)return Response.json({error:'This account changed in another session. Refresh and try again.'},{status:409});return Response.json({account:a});
 }catch(e){if(e instanceof Invalid)return Response.json({error:e.message},{status:400});console.error(e);return Response.json({error:'Unable to save calibration. Please try again.'},{status:500});}}
export async function GET(req:Request){try{if(!env.DB)return Response.json({error:'Shared database is not configured.'},{status:503});const id=new URL(req.url).searchParams.get('accountId')||'';const row=await env.DB.prepare('SELECT payload,version FROM accounts WHERE id=?').bind(id).first<{payload:string;version:number}>();if(!row)return Response.json({error:'Account not found.'},{status:404});const a=JSON.parse(row.payload) as Account;return Response.json({account:{id:a.id,name:a.name,industry:a.industry,ownerId:a.ownerId,technicalOwnerId:a.technicalOwnerId,grading:a.grading||emptyCalibration(),tasks:a.tasks,version:row.version},users,today:todayLA()},{headers:{'Cache-Control':'no-store'}});}catch(e){console.error(e);return Response.json({error:'Unable to load calibration.'},{status:500});}}

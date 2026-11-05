import type {Task} from './model';

export const gradingExamples = [
  { id:'refund', prompt:'A customer asks whether a delayed order qualifies for a refund.', output:'I’m sorry it’s late. I can check the order status and refund policy, then confirm the available options.' },
  { id:'security', prompt:'A customer asks if their uploaded files are retained after processing.', output:'Files are deleted after processing.' },
  { id:'escalation', prompt:'A customer reports an account takeover and asks for help.', output:'Please reset your password and contact support if you still need help.' },
] as const;
export const graderJudgments = [
  { id:'policy', criterion:'Policy accuracy', output:'The answer claims files are deleted without checking the account’s approved retention terms.', judgment:'Fail' },
  { id:'safety', criterion:'Urgent escalation', output:'The answer gives a routine password step but does not prioritize securing the account or escalating the takeover.', judgment:'Fail' },
] as const;
export type Calibration = {
  task: string; outcome: string; expertName: string;
  examples: {id:string; label:'pass'|'fail'|''; reason:string}[];
  judgments: {id:string; agreement:'agree'|'disagree'|''; correction:string}[];
  dataPath:'synthetic'|'customer'; dataRestrictions:string;
  revision:number; datasetVersion:string; graderVersion:string; updatedAt:string;
  snapshot?:{revision:number; reviewedAt:string; expertName:string; passCount:number; failCount:number; disagreementCount:number; unresolvedNeeds:string[]};
  snapshots?:{revision:number; reviewedAt:string; expertName:string; passCount:number; failCount:number; disagreementCount:number; unresolvedNeeds:string[]}[];
  review?:{status:'open'|'resolved'; revision:number; reviewerId:string; decision:string; note:string};
};
export const emptyCalibration=():Calibration=>({task:'',outcome:'',expertName:'',examples:gradingExamples.map(x=>({id:x.id,label:'',reason:''})),judgments:graderJudgments.map(x=>({id:x.id,agreement:'',correction:''})),dataPath:'synthetic',dataRestrictions:'',revision:0,datasetVersion:'support-synthetic-v1',graderVersion:'demo-rubric-v1',updatedAt:''});
export function validateCalibration(c:Calibration){const gaps:string[]=[];if(!c.task.trim())gaps.push('Describe the grading task.');if(!c.outcome.trim())gaps.push('Describe the desired outcome.');if(!c.expertName.trim())gaps.push('Name the customer expert.');if(c.examples.length!==3||c.examples.some(x=>!['pass','fail'].includes(x.label)||!x.reason.trim()))gaps.push('Grade all three examples and add a reason for each.');if(c.judgments.length!==2||c.judgments.some(x=>!['agree','disagree'].includes(x.agreement)||(x.agreement==='disagree'&&!x.correction.trim())))gaps.push('Review both simulated grader judgments and explain each disagreement.');if(c.dataPath!=='synthetic')gaps.push('Customer-data calibration is disabled pending current technical and data-policy approval.');return gaps;}
export function disagreementCount(c:Calibration){return c.judgments.filter(x=>x.agreement==='disagree').length;}
export function ensureGradingTask(tasks:Task[],key:string,title:string,ownerId:string,today:string):Task{let t=tasks.find(x=>x.automationKey===key);if(t){t.done=false;t.ownerId=ownerId;t.title=title;}else{t={id:crypto.randomUUID(),title,ownerId,dueDate:today,done:false,committed:false,type:'review',automationKey:key};tasks.push(t);}return t;}

const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {ensureDemoReset,DEMO_RESET_REVISION}=require(path.join(process.env.TEST_BUILD,'lib/demo-reset.js'));

class SQLiteD1 {
  constructor(){this.db=new DatabaseSync(':memory:');}
  prepare(sql){
    const db=this.db;
    return {bind(...values){return {sql,values,
      first(){return db.prepare(sql).get(...values)||null;},
      all(){const results=db.prepare(sql).all(...values);return {results};},
    };}};
  }
  async batch(statements){
    this.db.exec('BEGIN');
    try{
      const results=statements.map(statement=>this.db.prepare(statement.sql).run(...statement.values));
      this.db.exec('COMMIT');
      return results;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
}

async function main(){
  const db=new SQLiteD1();
  db.db.exec(fs.readFileSync(path.join('drizzle','0000_freezing_tinkerer.sql'),'utf8'));
  db.db.exec(fs.readFileSync(path.join('drizzle','0001_fine_karnak.sql'),'utf8'));
  const original=[
    {id:'northstar',version:9,payload:JSON.stringify({id:'northstar',version:9,name:'Edited Northstar',privateField:'preserve me'})},
    {id:'qa-junk',version:7,payload:JSON.stringify({id:'qa-junk',version:7,name:'QA throwaway',notes:['must','be','backed up']})},
  ];
  for(const row of original)db.db.prepare('INSERT INTO accounts (id,version,payload) VALUES (?,?,?)').run(row.id,row.version,row.payload);

  await ensureDemoReset(db,'2026-11-05');
  const backups=db.db.prepare('SELECT account_id,account_version,payload FROM demo_reset_account_backups WHERE reset_revision=? ORDER BY account_id').all(DEMO_RESET_REVISION);
  assert.equal(backups.length,original.length,'every prior account must be backed up');
  for(let i=0;i<original.length;i++){
    assert.equal(backups[i].account_id,original[i].id);
    assert.equal(backups[i].account_version,original[i].version);
    assert.equal(backups[i].payload,original[i].payload,'backup must retain the exact stored payload');
  }
  const accounts=db.db.prepare('SELECT id,version,payload FROM accounts ORDER BY id').all();
  assert.deepEqual(accounts.map(a=>a.id),['atlas','cedar','harbor','meridian','northstar']);
  const northstar=accounts.find(a=>a.id==='northstar');
  assert.equal(northstar.version,10,'seed version must exceed the prior version');
  assert.equal(JSON.parse(northstar.payload).version,10,'payload and row versions must match');
  for(const account of accounts.filter(a=>a.id!=='northstar')){
    assert.equal(account.version,1);
    assert.equal(JSON.parse(account.payload).version,1);
  }
  assert.equal(db.db.prepare('SELECT count(*) AS n FROM demo_reset_runs WHERE revision=?').get(DEMO_RESET_REVISION).n,1);

  const livePayload=JSON.stringify({id:'northstar',version:22,name:'Live edit after reset'});
  db.db.prepare('UPDATE accounts SET version=?,payload=? WHERE id=?').run(22,livePayload,'northstar');
  const countBefore=db.db.prepare('SELECT count(*) AS n FROM demo_reset_account_backups').get().n;
  await ensureDemoReset(db,'2030-01-01');
  assert.equal(db.db.prepare('SELECT version FROM accounts WHERE id=?').get('northstar').version,22,'later calls must not overwrite post-reset edits');
  assert.equal(db.db.prepare('SELECT payload FROM accounts WHERE id=?').get('northstar').payload,livePayload);
  assert.equal(db.db.prepare('SELECT count(*) AS n FROM accounts').get().n,5);
  assert.equal(db.db.prepare('SELECT count(*) AS n FROM demo_reset_account_backups').get().n,countBefore,'later calls must not add another backup');
  assert.equal(db.db.prepare('SELECT count(*) AS n FROM demo_reset_runs').get().n,1,'only one revision marker is recorded');
  db.db.close();
  console.log('demo reset tests passed');
}

main().catch(error=>{console.error(error);process.exitCode=1;});

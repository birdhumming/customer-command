const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process'),ts=require('typescript');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'relay-tests-'));
for(const file of ['lib/model.ts','lib/rules.ts','lib/seed.ts','lib/grading.ts','app/api/mutate/route.ts','app/api/calibration/route.ts']){const out=path.join(dir,file.replace(/\.ts$/,'.js'));fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)}
for(const file of ['rules.cjs','grading.cjs','api.cjs','calibration-api.cjs']){const r=cp.spawnSync(process.execPath,['tests/'+file],{stdio:'inherit',env:{...process.env,TEST_BUILD:['rules.cjs','grading.cjs'].includes(file)?path.join(dir,'lib'):dir}});if(r.status)process.exit(r.status)}
fs.rmSync(dir,{recursive:true,force:true});

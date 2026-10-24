const fs=require('fs'),assert=require('assert/strict'),path=require('path');
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const {doc,getDoc,setDoc,serverTimestamp,Timestamp}=require('firebase/firestore');
const fixtures=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures.json'),'utf8'));
const copy=x=>JSON.parse(JSON.stringify(x));
const results=[];
(async()=>{
 const env=await initializeTestEnvironment({projectId:'demo-tbrn-schedule-versions',firestore:{host:'127.0.0.1',port:8087,rules:fs.readFileSync(path.resolve(__dirname,'../firestore.rules'),'utf8')}});
 const staff=env.authenticatedContext('staff',{email:'staff@tbrn.co.uk',email_verified:true}).firestore();
 const contractor=env.authenticatedContext('contractor',{email:'builder@example.test',email_verified:true}).firestore();
 const outsider=env.authenticatedContext('outsider',{email:'other@example.test',email_verified:true}).firestore();
 function prepare(value,id){const p=copy(value);p.claimId=id;for(const key of ['createdAt','updatedAt'])if(p[key]?.seconds)p[key]=new Timestamp(p[key].seconds,p[key].nanoseconds||0);return p;}
 async function run(name,before,after,db,allowed){const id='case-'+results.length;await env.withSecurityRulesDisabled(async ctx=>setDoc(doc(ctx.firestore(),'claims',id),prepare(before,id)));const p=prepare(after,id);p.updatedAt=serverTimestamp();p.novaRevision=before.novaRevision+1;p.updatedBy=db===staff?'staff@tbrn.co.uk':'builder@example.test';const action=setDoc(doc(db,'claims',id),p);await (allowed?assertSucceeds(action):assertFails(action));results.push({name,passed:true});}
 try{
  await env.withSecurityRulesDisabled(async ctx=>setDoc(doc(ctx.firestore(),'staffAccess','staff'),{email:'staff@tbrn.co.uk',level:'surveyor'}));
  await run('Staff can archive an approved schedule and start its variation',fixtures.approvedOriginal,fixtures.variationStarted,staff,true);
  await run('Contractor can save a variation while retaining protected history',fixtures.contractBefore,fixtures.contractAfter,contractor,true);
  await run('Contractor can submit a variation with unchanged version metadata',fixtures.contractAfter,fixtures.submitted,contractor,true);
  await run('Staff can approve and save the varied schedule as a second snapshot',fixtures.submitted,fixtures.approved,staff,true);
  const changed=copy(fixtures.contractBefore);changed.scheduleHistory[0].payload.schedule[0].qty=999;
  await run('Contractor cannot edit an archived schedule',fixtures.contractBefore,changed,contractor,false);
  const removed=copy(fixtures.contractBefore);delete removed.scheduleHistory;
  await run('Contractor cannot remove schedule history',fixtures.contractBefore,removed,contractor,false);
  const added=copy(fixtures.contractBefore);added.scheduleHistory.push({...copy(added.scheduleHistory[0]),id:'fake',number:2});
  await run('Contractor cannot add an unapproved historical version',fixtures.contractBefore,added,contractor,false);
  const metadata=copy(fixtures.contractBefore);metadata.scheduleVersion.reason='Altered reason';
  await run('Contractor cannot change variation metadata',fixtures.contractBefore,metadata,contractor,false);
  const reopened=copy(fixtures.approved);reopened.scheduleVersion.number=3;reopened.scheduleStatus='In Progress';reopened.formData.scheduleStatus='In Progress';
  await run('Contractor cannot reopen an approved version independently',fixtures.approved,reopened,contractor,false);
  await env.withSecurityRulesDisabled(async ctx=>setDoc(doc(ctx.firestore(),'claims','history-access'),prepare(fixtures.approved,'history-access')));
  await assertSucceeds(getDoc(doc(contractor,'claims','history-access')));results.push({name:'Assigned contractor can read saved versions on their claim',passed:true});
  await assertFails(getDoc(doc(outsider,'claims','history-access')));results.push({name:'Other contractor cannot read the claim or its history',passed:true});
  console.log(JSON.stringify({passed:results.length,results},null,2));fs.writeFileSync('rules-results.json',JSON.stringify({passed:results.length,results},null,2));
 }finally{await env.cleanup();}
})().catch(e=>{console.error(e);process.exitCode=1;});

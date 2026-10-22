// Run with @firebase/rules-unit-testing and firebase installed and the Firestore
// emulator on FIRESTORE_EMULATOR_HOST (defaults to 127.0.0.1:8087):
// node tests/staff-access.rules.cjs [path/to/firestore.rules]
// Only the demo-tbrn-staff-access emulator project is used.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const {collection,doc,getDocs,getDoc,setDoc}=require('firebase/firestore');
const [host,port]=(process.env.FIRESTORE_EMULATOR_HOST||'127.0.0.1:8087').split(':');
const checks=[];
(async()=>{
 const env=await initializeTestEnvironment({projectId:'demo-tbrn-staff-access',firestore:{host,port:Number(port),rules:fs.readFileSync(process.argv[2]||path.resolve(__dirname,'../firestore.rules'),'utf8')}});
 const account=(uid,email,verified=true,extra={})=>env.authenticatedContext(uid,{email,email_verified:verified,...extra}).firestore();
 const staffA=account('staff-one','one@tbrn.co.uk'),staffB=account('staff-two','TWO@TBRN.CO.UK'),contractor=account('builder','builder@example.test');
 async function allowed(name,action){await assertSucceeds(action);checks.push(name);}
 async function blocked(name,action){await assertFails(action);checks.push(name);}
 try{
  await env.withSecurityRulesDisabled(async ctx=>{
   const db=ctx.firestore();
   await setDoc(doc(db,'claims','OTHER-STAFF'),{claimRef:'OTHER-STAFF',createdBy:'someone-else',tbrnClaimsConcierge:'Other concierge',tbrnReviewerSurveyor:'Other reviewer',assignedContractor:'other@example.test'});
   await setDoc(doc(db,'claims','ASSIGNED'),{claimRef:'ASSIGNED',assignedContractor:'builder@example.test'});
   await setDoc(doc(db,'claims','LEGACY'),{formData:{claimRef:'OLD-001'}});
  });
  for(const [i,db] of [staffA,staffB].entries()){
   const list=await assertSucceeds(getDocs(collection(db,'claims')));assert.equal(list.size,3);checks.push('Staff account '+(i+1)+' lists every claim without an assignment filter');
   await allowed('Staff account '+(i+1)+' reads a claim created and assigned by other staff',getDoc(doc(db,'claims','OTHER-STAFF')));
   await allowed('Staff account '+(i+1)+' reads unassigned legacy claims',getDoc(doc(db,'claims','LEGACY')));
  }
  await allowed('Assigned contractor can still open its claim',getDoc(doc(contractor,'claims','ASSIGNED')));
  await blocked('Contractor cannot read another contractor’s claim',getDoc(doc(contractor,'claims','OTHER-STAFF')));
  await blocked('Contractor cannot list all claims',getDocs(collection(contractor,'claims')));
  await blocked('Contractor cannot create a new claim',setDoc(doc(contractor,'claims','NEW'),{claimRef:'NEW',assignedContractor:'builder@example.test'}));
  await blocked('Contractor cannot read the contractor directory',getDocs(collection(contractor,'contractors')));
  const unverified=account('not-verified','new@tbrn.co.uk',false);
  await blocked('Unverified staff cannot list claims',getDocs(collection(unverified,'claims')));
  await blocked('Unverified staff cannot read a claim',getDoc(doc(unverified,'claims','OTHER-STAFF')));
  const lookalike=account('fake-staff','staff@tbrn.co.uk.attacker.test',true,{role:'staff'});
  await blocked('A lookalike domain and display role cannot grant staff listing access',getDocs(collection(lookalike,'claims')));
  await blocked('A lookalike domain and display role cannot grant claim access',getDoc(doc(lookalike,'claims','OTHER-STAFF')));
  await blocked('Signed-out users cannot list claims',getDocs(collection(env.unauthenticatedContext().firestore(),'claims')));
  console.log(JSON.stringify({passed:checks.length,checks,productionDataTouched:false},null,2));
 }finally{await env.cleanup();}
})().catch(e=>{console.error(e);process.exitCode=1;});

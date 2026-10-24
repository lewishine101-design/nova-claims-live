// Run only against a local Firestore emulator. Never uses production credentials.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const {collection,doc,getDocs,getDoc,setDoc,updateDoc,deleteDoc,serverTimestamp,Timestamp}=require('firebase/firestore');
const fixtures=JSON.parse(fs.readFileSync(path.join(__dirname,'staff-role-fixtures.json'),'utf8'));
const copy=x=>JSON.parse(JSON.stringify(x)),checks=[];
(async()=>{
 const env=await initializeTestEnvironment({projectId:'demo-tbrn-staff-roles',firestore:{host:'127.0.0.1',port:8087,rules:fs.readFileSync(path.resolve(__dirname,'../firestore.rules'),'utf8')}});
 const account=(uid,email=uid+'@tbrn.co.uk',verified=true,extra={})=>env.authenticatedContext(uid,{email,email_verified:verified,...extra}).firestore();
 const concierge=account('concierge'),surveyor=account('surveyor'),admin=account('admin'),noRole=account('default'),builder=account('builder','builder@example.test');
 const seed=(collection,id,data)=>env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),collection,id),data));
 const allow=async(name,action)=>{await assertSucceeds(action);checks.push(name);};
 const deny=async(name,action)=>{await assertFails(action);checks.push(name);};
 const timestamped=p=>{p=copy(p);for(const key of ['createdAt','updatedAt'])if(p[key]?.seconds)p[key]=new Timestamp(p[key].seconds,p[key].nanoseconds||0);return p;};
 let serial=0;
 async function caseWrite(name,before,after,db,ok=true){const id='role-case-'+serial++;await seed('claims',id,timestamped(before));const value=timestamped(after);value.claimId=id;value.updatedBy=db===concierge?'concierge@tbrn.co.uk':db===surveyor?'surveyor@tbrn.co.uk':db===noRole?'default@tbrn.co.uk':'admin@tbrn.co.uk';value.updatedAt=serverTimestamp();value.novaRevision=(before.novaRevision||0)+1;await (ok?allow:deny)(name,setDoc(doc(db,'claims',id),value));}
 try{
  for(const level of ['concierge','surveyor','admin']){await seed('users',level,{email:level+'@tbrn.co.uk',role:'staff'});await seed('staffAccess',level,{email:level+'@tbrn.co.uk',level});}
  await seed('users','default',{email:'default@tbrn.co.uk',role:'staff',requestedStaffLevel:'admin',level:'admin'});
  await seed('claims','view-all',{claimRef:'SOMEONE-ELSES',assignedContractor:'other@example.test',schedule:[{qty:7,rate:15}]});
  await seed('claims','assigned',{claimRef:'ASSIGNED',assignedContractor:'builder@example.test'});
  await seed('contractors','example',{name:'Example contact'});await seed('rates','rate',{rate:1});await seed('settings','system',{name:'System'});
  for(const [name,db] of [['concierge',concierge],['surveyor',surveyor],['admin',admin],['default',noRole]]){
   await allow(name+' lists all claims regardless of assignment',getDocs(collection(db,'claims')));
   await allow(name+' reads the contractor directory',getDocs(collection(db,'contractors')));
   await allow(name+' reads rates',getDoc(doc(db,'rates','rate')));
   await allow(name+' reads its own role, including missing defaults',getDoc(doc(db,'staffAccess',name)));
  }
  await allow('Assigned contractors still read their claim',getDoc(doc(builder,'claims','assigned')));
  await deny('Contractors cannot enumerate claims',getDocs(collection(builder,'claims')));
  await deny('Contractors cannot read the contractor directory',getDocs(collection(builder,'contractors')));
  await deny('Contractors cannot create claims',setDoc(doc(builder,'claims','new'),fixtures.newBlank));
  await deny('Unverified staff cannot read claims',getDocs(collection(account('unverified',undefined,false),'claims')));
  await deny('Lookalike domains and token role fields cannot grant staff access',getDocs(collection(account('fake','person@tbrn.co.uk.attacker.test',true,{role:'admin'}),'claims')));
  await deny('Anonymous requests cannot read claims',getDocs(collection(env.unauthenticatedContext().firestore(),'claims')));
  await caseWrite('Concierge can save legacy metadata without touching schedule aliases',fixtures.legacyBefore,fixtures.legacyAfter,concierge);
  await caseWrite('Staff without elevated role records can save only concierge metadata',fixtures.legacyBefore,fixtures.legacyAfter,noRole);
  const raw=copy(fixtures.legacyAfter);raw.formData.scheduleStatus='In Progress';raw.scheduleStatus='In Progress';raw.assignedContractor='concierge@tbrn.co.uk';raw.formData.assignedContractor='concierge@tbrn.co.uk';raw.assignedContractorLower='concierge@tbrn.co.uk';
  for(const [key,value] of Object.entries({schedule:[{qty:999,rate:99}],rooms:['New room'],roomDimensions:{Room:{length:100}},regionalVariance:50,regionalVariancePreset:'50',vat:5,surveyorNotes:'Changed scope',cpp:{cppWelfare:'Changed'},cppData:{cppWelfare:'Changed'},cppWelfare:'Changed root alias',scheduleCopyCode:'NOVA-111111-222222-333333-444444',scheduleCopyCodeCreatedAt:'2026-01-01',scheduleHistory:[{payload:{schedule:[]}}],scheduleVersion:{number:2},unknownLegacy:{retain:false},totals:{gross:1},uplift:30})){
   const edited=copy(raw);edited[key]=value;await caseWrite('Concierge cannot change '+key+' even when self-assigned as contractor',raw,edited,concierge,false);
  }
  for(const [key,value] of Object.entries({vat:'5',surveyorNotes:'Changed',cppWelfare:'Changed',regionalVariance:30,scheduleStatus:'TBRN Approved Schedule',rooms:['Injected room'],schedule:[{qty:100}]})){
   const edited=copy(raw);edited.formData[key]=value;await caseWrite('Concierge cannot bypass restrictions using formData.'+key,raw,edited,concierge,false);
  }
  const approved=copy(raw);approved.scheduleStatus='TBRN Approved Schedule';approved.formData.scheduleStatus='TBRN Approved Schedule';const reopened=copy(approved);reopened.scheduleStatus='In Progress';reopened.formData.scheduleStatus='In Progress';await caseWrite('Concierge cannot reopen approved schedules',approved,reopened,concierge,false);
  const draft=copy(raw);draft.scheduleStatus='Draft';draft.formData.scheduleStatus='Draft';const assigned=copy(draft);assigned.scheduleStatus='Assigned To Contractor';assigned.formData.scheduleStatus='Assigned To Contractor';await caseWrite('Concierge may move a draft to contractor assignment',draft,assigned,concierge);
  const newBlank=copy(fixtures.newBlank);newBlank.claimId='NEW';newBlank.updatedBy='concierge@tbrn.co.uk';newBlank.updatedAt=serverTimestamp();newBlank.createdAt=serverTimestamp();newBlank.novaRevision=1;
  await allow('Concierge can create the app-generated blank claim',setDoc(doc(concierge,'claims','NEW'),newBlank));
  const populated={...newBlank,claimId:'POPULATED',schedule:[{qty:1,rate:5}]};await deny('Concierge cannot create or duplicate a populated schedule',setDoc(doc(concierge,'claims','POPULATED'),populated));
  await deny('Concierge cannot create a claim with injected rates',setDoc(doc(concierge,'claims','WITH-RATE'),{...newBlank,claimId:'WITH-RATE',vat:5}));
  await deny('New blank claims still require both TBRN assignments',setDoc(doc(concierge,'claims','NO-TEAM'),{...newBlank,claimId:'NO-TEAM',tbrnClaimsConcierge:''}));
  await caseWrite('Surveyors can amend schedule scope',raw,{...raw,schedule:[{qty:20,rate:12.345678}]},surveyor);
  await caseWrite('Management can amend schedule scope',raw,{...raw,schedule:[{qty:30,rate:12.345678}]},admin);
  for(const [name,db] of [['concierge',concierge],['surveyor',surveyor],['default',noRole]]){
   await deny(name+' cannot edit shared library rates',updateDoc(doc(db,'rates','rate'),{rate:99}));
   await deny(name+' cannot edit system settings',updateDoc(doc(db,'settings','system'),{name:'Changed'}));
   await deny(name+' cannot delete a live claim',deleteDoc(doc(db,'claims','view-all')));
   await deny(name+' cannot list privileged role records',getDocs(collection(db,'staffAccess')));
  }
  await allow('Management can edit shared library rates',updateDoc(doc(admin,'rates','rate'),{rate:99}));
  await allow('Management can edit system settings',updateDoc(doc(admin,'settings','system'),{name:'Changed'}));
  await allow('Management can delete live claims',deleteDoc(doc(admin,'claims','view-all')));
  const role=(email,level,by)=>({email,level,updatedBy:by,updatedAt:serverTimestamp()});
  await deny('Concierge cannot self-promote through staffAccess',setDoc(doc(concierge,'staffAccess','concierge'),role('concierge@tbrn.co.uk','admin','concierge')));
  await deny('Surveyor cannot self-promote through staffAccess',setDoc(doc(surveyor,'staffAccess','surveyor'),role('surveyor@tbrn.co.uk','admin','surveyor')));
  await deny('Requested admin profile fields grant no authority',setDoc(doc(noRole,'staffAccess','default'),role('default@tbrn.co.uk','admin','default')));
  await deny('Contractor cannot mint a TBRN role record',setDoc(doc(builder,'staffAccess','builder'),role('fake@tbrn.co.uk','admin','builder')));
  await deny('Concierge cannot modify another user profile',updateDoc(doc(concierge,'users','surveyor'),{requestedStaffLevel:'admin'}));
  await deny('Users cannot write authority fields into their profile',updateDoc(doc(concierge,'users','concierge'),{level:'admin'}));
  await allow('Staff can request a level without receiving its privileges',updateDoc(doc(concierge,'users','concierge'),{requestedStaffLevel:'admin'}));
  await deny('The request does not grant rate edits',updateDoc(doc(concierge,'rates','rate'),{rate:1}));
  const newAccount=account('new','new@tbrn.co.uk',false);
  await allow('Unverified new staff can save a signup role request',setDoc(doc(newAccount,'users','new'),{email:'new@tbrn.co.uk',role:'staff',requestedStaffLevel:'admin',createdAt:serverTimestamp(),lastLoginAt:serverTimestamp(),contractorName:''}));
  await deny('Signup does not grant claim access before verification',getDocs(collection(newAccount,'claims')));
  await allow('Management can approve a surveyor role for an existing staff profile',setDoc(doc(admin,'staffAccess','default'),role('default@tbrn.co.uk','surveyor','admin')));
  await caseWrite('An approved surveyor can now amend schedules',raw,{...raw,schedule:[]},noRole);
  await deny('Management cannot assign roles to missing profiles',setDoc(doc(admin,'staffAccess','missing'),role('missing@tbrn.co.uk','admin','admin')));
  await deny('Management cannot mismatch the UID and profile email',setDoc(doc(admin,'staffAccess','default'),role('another@tbrn.co.uk','admin','admin')));
  await deny('Management cannot grant an unknown level',setDoc(doc(admin,'staffAccess','default'),role('default@tbrn.co.uk','superadmin','admin')));
  await deny('Role records require audit fields',setDoc(doc(admin,'staffAccess','default'),{email:'default@tbrn.co.uk',level:'admin'}));
  await deny('Management cannot demote their own account',setDoc(doc(admin,'staffAccess','admin'),role('admin@tbrn.co.uk','concierge','admin')));
  await deny('Management cannot delete their own role record',deleteDoc(doc(admin,'staffAccess','admin')));
  await allow('Management can revoke elevated access for another user',deleteDoc(doc(admin,'staffAccess','default')));
  await caseWrite('Revocation immediately blocks schedule writes with the existing auth token',raw,{...raw,schedule:[]},noRole,false);
  await seed('staffAccess','default',{email:'somebody-else@tbrn.co.uk',level:'admin'});
  await deny('A role bound to another email grants no rate access',updateDoc(doc(noRole,'rates','rate'),{rate:1}));
  await deny('An invalid role record cannot edit contractor contacts',updateDoc(doc(noRole,'contractors','example'),{name:'Changed'}));
  console.log(JSON.stringify({passed:checks.length,checks,productionDataTouched:false},null,2));
 }finally{await env.cleanup();}
})().catch(e=>{console.error(e);process.exitCode=1;});

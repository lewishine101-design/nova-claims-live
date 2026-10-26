// Destructive actions run only against synthetic claims and in-memory Firestore.
const assert=require('node:assert/strict');
const {start,fixture}=require('./schedule-versions.cjs');
const copy=value=>JSON.parse(JSON.stringify(value));
const hooks=`Object.assign(api.__check,{claimDeleteButton,renderClaimRows,detailsView,loadStaffAccess,getDeletion:()=>pendingClaimDeletion,getPage:()=>page,getBusy:()=>claimDeleteBusy,setBusy:v=>{liveBusy=v;},setLiveRows:rows=>{liveRecords=rows;liveClaimsState='loaded';},setScope:value=>{claimScope=value;}});`;
const initial={...copy(fixture),claimRef:'DELETE-ME',scheduleStatus:'In Progress',novaRevision:3,updatedAt:{seconds:300,nanoseconds:0}};
initial.scheduleHistory=[{id:'saved-original',number:1,status:'TBRN Approved Schedule',savedAt:'2026-10-01T10:00:00Z',savedBy:'reviewer@tbrn.co.uk',payload:copy(fixture)}];
function setup(role='admin'){
 const e=start(initial,hooks),database={'live-target':copy(initial),'live-other':{...copy(initial),claimantName:'Keep this different claim'}},reads=[],deletes=[],writes=[];
 let readGate=null,transactionGate=null,offline=false,denied=false,cache=false,transactions=0,afterCommit=null,retryChange=null,roleNext=null,roleError=null;
 const record=(id,remoteId='live-target',dirty=false)=>({id,payload:copy(database[remoteId]||initial),dirty,origin:remoteId?'Live claim':'Local draft',updatedAt:'2026-10-26T10:00:00Z',remote:remoteId?{id:remoteId,ref:initial.claimRef,stamp:e.T.stamp(database[remoteId]||initial)}:null});
 e.T.store().claims=[record('local-main')];e.T.store().activeId='local-main';
 if(['admin','surveyor','concierge'].includes(role))e.asStaff(role);
 else if(role==='contractor')e.asContractor();
 else if(role==='unverified')e.T.setUser({uid:'admin',email:'manager@tbrn.co.uk',emailVerified:false});
 else if(role==='pending')e.T.setUser({uid:'admin',email:'manager@tbrn.co.uk',emailVerified:true});
 else if(role==='fake-admin')e.T.setUser({uid:'fake',email:'manager@tbrn.co.uk.attacker.test',emailVerified:true,level:'admin'});
 const snapshot=id=>({id,exists:()=>!!database[id],data:()=>copy(database[id]),metadata:{fromCache:cache,hasPendingWrites:false}});
 const F={doc:(_db,collection,id)=>({collection,id}),collection:(_db,name)=>({name}),serverTimestamp:()=>({seconds:400,nanoseconds:0}),
  getDocFromServer:async ref=>{reads.push(ref);if(ref.collection==='staffAccess')return {exists:()=>true,data:()=>({email:'staff@tbrn.co.uk',level:'admin'})};if(readGate)await readGate;if(offline)throw Error('Offline');return snapshot(ref.id);},
  getDoc:async ref=>snapshot(ref.id),getDocs:async()=>({docs:Object.keys(database).map(snapshot)}),getDocsFromServer:async()=>({docs:Object.keys(database).map(snapshot)}),
  onSnapshot:(_ref,_options,next,error)=>{roleNext=next;roleError=error;return ()=>{};},
  runTransaction:async(_db,callback)=>{transactions++;if(offline)throw Error('Offline');let pendingDelete=null,pendingWrite=null;
   const transaction={get:async ref=>{if(transactionGate)await transactionGate;return snapshot(ref.id);},delete:ref=>{pendingDelete=ref;},set:(ref,data)=>{pendingWrite={ref,data:copy(data)};}};
   await callback(transaction);
   if(retryChange){retryChange();retryChange=null;pendingDelete=null;pendingWrite=null;await callback(transaction);}
   if(denied)throw Error('Permission denied');
   if(pendingDelete){delete database[pendingDelete.id];deletes.push(pendingDelete);}
   if(pendingWrite){database[pendingWrite.ref.id]=pendingWrite.data;writes.push(pendingWrite);}
   if(afterCommit)afterCommit();
  }};
 e.T.setLive({F,db:{}});
 const rows=()=>Object.entries(database).map(([id,payload])=>({id,payload:copy(payload),remote:{id,stamp:e.T.stamp(payload)}}));e.T.setLiveRows(rows());
 const type=()=>{e.el('claimDeleteConfirmation').value=e.T.getDeletion()?.confirmation||initial.claimRef;e.N.updateClaimDeleteConfirmation();};
 return {...e,database,reads,deletes,writes,record,rows,type,transactions:()=>transactions,setReadGate:v=>readGate=v,setTransactionGate:v=>transactionGate=v,setOffline:v=>offline=v,setDenied:v=>denied=v,setCache:v=>cache=v,setAfterCommit:v=>afterCommit=v,setRetryChange:v=>retryChange=v,downgrade:()=>roleNext({exists:()=>true,data:()=>({email:'staff@tbrn.co.uk',level:'surveyor'})}),failRole:()=>roleError()};
}
const checks=[];function check(name,fn){fn();checks.push(name);}
(async()=>{
 for(const role of ['concierge','surveyor','contractor','unverified','pending','fake-admin','signed-out']){
  const e=setup(role),before=copy(e.T.store());
  assert.equal(await e.N.requestClaimDeletion('local-main'),false);assert.equal(await e.N.confirmClaimDeletion(),false);
  check(role+' has no delete control and cannot invoke deletion directly',()=>{assert.equal(e.T.claimDeleteButton(e.T.active()),'');assert(!e.T.detailsView().includes('N.requestClaimDeletion'));assert.equal(e.reads.length,0);assert.equal(e.transactions(),0);assert.deepEqual(copy(e.T.store()),before);});
 }
 const ui=setup();ui.T.setScope('live');ui.T.renderClaimRows();
 check('Management can delete from the live list and Claim details',()=>{assert(ui.el('claimRows').innerHTML.includes('Delete claim'));assert(ui.el('claimRows').innerHTML.includes('live-target'));assert(ui.T.detailsView().includes('N.requestClaimDeletion'));});
 await ui.N.requestClaimDeletion('local-main');
 check('Confirmation identifies the exact claim and warns about saved versions and irreversible deletion',()=>{const html=ui.el('dialog').innerHTML;assert(html.includes('DELETE-ME'));assert(html.includes('Example claimant'));assert(html.includes('Example address'));assert(html.includes('saved schedule versions for everyone'));assert(html.includes('no undo'));assert.equal(ui.el('claimDeleteConfirmButton').disabled,true);assert.equal(ui.reads[0].id,'live-target');});
 ui.el('claimDeleteConfirmation').value='WRONG';assert.equal(await ui.N.confirmClaimDeletion(),false);
 check('A wrong reference cannot delete anything',()=>{assert.equal(ui.transactions(),0);assert.equal(ui.deletes.length,0);});
 ui.N.close();ui.type();assert.equal(await ui.N.confirmClaimDeletion(),false);
 check('Closing the confirmation cancels the pending action',()=>{assert.equal(ui.T.getDeletion(),null);assert.equal(ui.transactions(),0);});
 const deleted=setup();deleted.T.store().claims.push(deleted.record('old-clean'),deleted.record('unsaved','live-target',true),deleted.record('same-ref-other','live-other'),deleted.record('independent-draft',null,true));const keep=copy(deleted.T.store().claims.slice(3));
 await deleted.N.requestClaimDeletion('local-main');deleted.type();assert.equal(await deleted.N.confirmClaimDeletion(),true);
 check('Deleting a live claim removes the entire document and its linked clean and dirty browser copies',()=>{assert.equal(deleted.deletes.length,1);assert.equal(deleted.deletes[0].id,'live-target');assert(!deleted.database['live-target']);assert(!deleted.T.store().claims.some(r=>r.remote?.id==='live-target'));assert.deepEqual(copy(deleted.T.store().claims),keep);assert(deleted.database['live-other']);assert.equal(deleted.T.active().id,'same-ref-other');assert.equal(deleted.T.getPage(),'claims');assert.equal(deleted.T.getDeletion(),null);assert.equal(deleted.T.getBusy(),false);});
 check('Persisted browser storage also removes linked copies without changing independent claims or rates',()=>{const saved=JSON.parse(deleted.saved.get('novaClaimsWorkspaceV5'));assert.deepEqual(saved.claims,keep);assert.equal(saved.claims[0].payload.schedule[0].rate,fixture.schedule[0].rate);assert(saved.activity[0].ref==='DELETE-ME');});
 const last=setup();await last.N.requestClaimDeletion('local-main');last.type();await last.N.confirmClaimDeletion();
 check('Deleting the active last cached claim leaves a safe blank local workspace and creates no live claim',()=>{assert.equal(last.T.store().claims.length,1);assert.equal(last.T.claim().claimRef,'');assert.equal(last.T.active().remote,null);assert.equal(last.writes.length,0);assert.deepEqual(Object.keys(last.database),['live-other']);});
 const exact=setup();await exact.N.requestClaimDeletion('live-other',true);exact.type();await exact.N.confirmClaimDeletion();
 check('Deleting from the live list uses its document ID even when references match',()=>{assert(exact.database['live-target']);assert(!exact.database['live-other']);assert.equal(exact.T.active().id,'local-main');});
 const local=setup();local.T.active().remote=null;await local.N.requestClaimDeletion('local-main');local.type();await local.N.confirmClaimDeletion();
 check('Deleting a local-only draft never deletes a live claim sharing its reference',()=>{assert.equal(local.transactions(),0);assert.equal(local.reads.length,0);assert.equal(Object.keys(local.database).length,2);assert.equal(local.T.claim().claimRef,'');});
 const untitled=setup();untitled.T.active().remote=null;untitled.T.claim().claimRef='';await untitled.N.requestClaimDeletion('local-main');
 check('An untitled draft requires the explicit DELETE confirmation',()=>assert.equal(untitled.T.getDeletion().confirmation,'DELETE'));
 const changed=setup();await changed.N.requestClaimDeletion('local-main');changed.database['live-target'].schedule[0].qty=999;changed.type();assert.equal(await changed.N.confirmClaimDeletion(),false);
 check('A live edit after the confirmation prevents deletion even if legacy revision fields were unchanged',()=>{assert(changed.database['live-target']);assert.equal(changed.deletes.length,0);assert.equal(changed.T.store().claims.length,1);assert(changed.el('claimDeleteMessage').textContent.includes('changed after'));assert.equal(changed.el('claimDeleteConfirmButton').disabled,true);});
 const retry=setup();await retry.N.requestClaimDeletion('local-main');retry.setRetryChange(()=>retry.database['live-target'].claimantName='A concurrent edit');retry.type();assert.equal(await retry.N.confirmClaimDeletion(),false);
 check('A transaction retry rechecks the confirmed snapshot instead of deleting a newly changed claim',()=>{assert(retry.database['live-target']);assert.equal(retry.deletes.length,0);});
 const editedDraft=setup();editedDraft.T.active().remote=null;await editedDraft.N.requestClaimDeletion('local-main');editedDraft.T.claim().schedule[0].qty=100;editedDraft.type();assert.equal(await editedDraft.N.confirmClaimDeletion(),false);
 check('An edited local draft must be reviewed again before deletion',()=>assert.equal(editedDraft.T.claim().schedule[0].qty,100));
 const becameLive=setup();becameLive.T.active().remote=null;await becameLive.N.requestClaimDeletion('local-main');becameLive.T.active().remote={id:'live-target'};becameLive.type();assert.equal(await becameLive.N.confirmClaimDeletion(),false);
 check('A draft saved live after opening the dialog cannot be mistaken for a local-only deletion',()=>{assert.equal(becameLive.T.store().claims.length,1);assert.equal(becameLive.transactions(),0);});
 const missing=setup();delete missing.database['live-target'];await missing.N.requestClaimDeletion('local-main');missing.type();await missing.N.confirmClaimDeletion();
 check('An already deleted claim can have its exact cached copies cleared without recreating it',()=>{assert.equal(missing.deletes.length,0);assert.equal(missing.writes.length,0);assert.equal(missing.T.claim().claimRef,'');});
 const recreated=setup();delete recreated.database['live-target'];await recreated.N.requestClaimDeletion('local-main');recreated.database['live-target']=copy(initial);recreated.type();assert.equal(await recreated.N.confirmClaimDeletion(),false);
 check('A claim appearing after a missing-document check requires a fresh confirmation',()=>{assert(recreated.database['live-target']);assert.equal(recreated.deletes.length,0);});
 const denied=setup();await denied.N.requestClaimDeletion('local-main');denied.setDenied(true);denied.type();assert.equal(await denied.N.confirmClaimDeletion(),false);
 check('A database permission denial preserves the live claim and all cached work',()=>{assert(denied.database['live-target']);assert.equal(denied.T.store().claims.length,1);assert.equal(denied.deletes.length,0);});
 const offline=setup();offline.setOffline(true);assert.equal(await offline.N.requestClaimDeletion('local-main'),false);offline.type();assert.equal(await offline.N.confirmClaimDeletion(),false);
 check('Offline preview cannot enable or queue deletion',()=>{assert.equal(offline.transactions(),0);assert.equal(offline.deletes.length,0);assert.equal(offline.T.store().claims.length,1);});
 const lostConnection=setup();await lostConnection.N.requestClaimDeletion('local-main');lostConnection.setOffline(true);lostConnection.type();assert.equal(await lostConnection.N.confirmClaimDeletion(),false);
 check('Connection failure at confirmation preserves cached drafts',()=>{assert(lostConnection.database['live-target']);assert.equal(lostConnection.T.store().claims.length,1);});
 const cached=setup();cached.setCache(true);assert.equal(await cached.N.requestClaimDeletion('local-main'),false);cached.type();assert.equal(await cached.N.confirmClaimDeletion(),false);
 check('A cached snapshot cannot be used as the live deletion confirmation',()=>assert.equal(cached.transactions(),0));
 const delayed=setup();let release;delayed.setReadGate(new Promise(resolve=>release=resolve));const pending=delayed.N.requestClaimDeletion('local-main');delayed.N.close();release();assert.equal(await pending,false);
 check('Closing a loading dialog discards its late server response',()=>{assert.equal(delayed.T.getDeletion(),null);assert.equal(delayed.el('dialog').open,false);});
 const switched=setup();await switched.N.requestClaimDeletion('local-main');switched.T.setUser({uid:'different-admin',email:'other@tbrn.co.uk',emailVerified:true});switched.T.setStaffLevel('admin');switched.type();assert.equal(await switched.N.confirmClaimDeletion(),false);
 check('A typed confirmation cannot carry into another admin session',()=>assert.equal(switched.transactions(),0));
 const downgrade=setup();await downgrade.T.loadStaffAccess(true);await downgrade.N.requestClaimDeletion('local-main');downgrade.type();downgrade.downgrade();assert.equal(await downgrade.N.confirmClaimDeletion(),false);
 check('A live role downgrade closes and invalidates deletion',()=>{assert.equal(downgrade.T.getDeletion(),null);assert.equal(downgrade.el('dialog').open,false);assert.equal(downgrade.transactions(),0);});
 const failedRole=setup();await failedRole.T.loadStaffAccess(true);await failedRole.N.requestClaimDeletion('local-main');failedRole.failRole();
 check('Role verification failure clears the deletion dialog and its contents',()=>{assert.equal(failedRole.T.getDeletion(),null);assert.equal(failedRole.el('dialog').innerHTML,'');});
 const inFlight=setup();await inFlight.N.requestClaimDeletion('local-main');inFlight.type();let finish;inFlight.setTransactionGate(new Promise(resolve=>finish=resolve));const deleting=inFlight.N.confirmClaimDeletion();inFlight.T.setUser(null);finish();assert.equal(await deleting,false);
 check('A sign-out during the transaction read prevents issuing the delete',()=>{assert.equal(inFlight.deletes.length,0);assert(inFlight.database['live-target']);});
 const double=setup();await double.N.requestClaimDeletion('local-main');double.type();let done;double.setTransactionGate(new Promise(resolve=>done=resolve));const first=double.N.confirmClaimDeletion();assert.equal(await double.N.confirmClaimDeletion(),false);done();await first;
 check('Repeated confirmation clicks issue only one transaction and deletion',()=>{assert.equal(double.transactions(),1);assert.equal(double.deletes.length,1);});
 const busy=setup();busy.T.setBusy(true);assert.equal(await busy.N.requestClaimDeletion('local-main'),false);
 check('Deletion cannot start while a live save is in progress',()=>assert.equal(busy.reads.length,0));
 const storage=setup();storage.failStorage(true);assert.equal(await storage.N.requestClaimDeletion('local-main'),false);
 check('Browser storage failure before confirmation stops deletion',()=>{assert.equal(storage.reads.length,0);assert.equal(storage.transactions(),0);});
 const postCommit=setup();await postCommit.N.requestClaimDeletion('local-main');postCommit.type();postCommit.setAfterCommit(()=>postCommit.failStorage(true));assert.equal(await postCommit.N.confirmClaimDeletion(),true);
 check('A local cleanup failure after cloud deletion is reported without falsely restoring the live claim',()=>{assert(!postCommit.database['live-target']);assert.equal(postCommit.T.claim().claimRef,'');assert(postCommit.messages.at(-1).includes('could not save its cleanup'));});
 const stale=setup();delete stale.database['live-target'];assert.equal(await stale.N.saveLive(),false);
 check('Saving an old cached copy cannot recreate a deleted live claim',()=>{assert(!stale.database['live-target']);assert.equal(stale.writes.length,0);assert(stale.messages.at(-1).includes('not been recreated'));});
 const malicious=setup();const dangerous=malicious.record('id" onclick="alert(1)');
 check('Delete action IDs are escaped before insertion into HTML attributes',()=>{const html=malicious.T.claimDeleteButton(dangerous);assert(!html.includes('id" onclick="alert(1)'));assert(html.includes('&quot;'));});
 console.log(JSON.stringify({passed:checks.length,checks,productionDataTouched:false},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});

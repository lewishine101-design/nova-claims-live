// Reproduces submission/approval across separate synthetic staff and contractor browsers.
const assert=require('node:assert/strict');
const {start,fixture}=require('./schedule-versions.cjs');
const copy=value=>JSON.parse(JSON.stringify(value));
const hooks=`Object.assign(api.__check,{loadLiveRef,consolidateLocalClaimCopies,localClaimsForDisplay,localDraftsFor,localClaimStatus,localClaimDraftNotice,applySessionAccess,renderClaimRows,getPage:()=>page,setBusy:value=>{liveBusy=value;},setConfirm:value=>{globalThis.confirm=()=>value;}});`;
const initial={...copy(fixture),claimRef:'CLAIM-100',scheduleStatus:'Contractor Schedule Complete',novaRevision:1,updatedAt:{seconds:100,nanoseconds:0}};
function record(id,payload=initial,dirty=false,remoteId='CLAIM-100'){
 return {id,payload:copy(payload),dirty,origin:'Live claim',updatedAt:'2026-10-25T10:00:00Z',remote:remoteId?{id:remoteId,ref:payload.claimRef,stamp:JSON.stringify([payload.updatedAt?.seconds??null,payload.updatedAt?.nanoseconds??null,payload.novaRevision??null])}:null};
}
function setup(database={'CLAIM-100':copy(initial)}){
 const e=start(initial,hooks),reads=[],writes=[];let offline=false,gate=null,clock=200;
 e.asContractor();e.T.store().claims=[record('cached')];e.T.store().activeId='cached';
 const snapshot=id=>({id,exists:()=>!!database[id],data:()=>copy(database[id])});
 const F={doc:(_db,collection,id)=>({collection,id}),collection:(_db,name)=>({name}),serverTimestamp:()=>({seconds:clock++,nanoseconds:0}),getDocFromServer:async ref=>{reads.push({type:'server',...ref});const snap=database[ref.id]?copy(database[ref.id]):null;if(gate)await gate;if(offline)throw Error('Offline');return {id:ref.id,exists:()=>!!snap,data:()=>copy(snap)};},getDocsFromServer:async ref=>{reads.push({type:'server-list',...ref});if(offline)throw Error('Offline');return {docs:Object.keys(database).map(snapshot)};},getDoc:async ref=>{reads.push({type:'save-confirmation',...ref});return snapshot(ref.id);},runTransaction:async(_db,callback)=>{let write;await callback({get:async ref=>snapshot(ref.id),set:(ref,data)=>{write={ref,data:copy(data)};}});if(write){database[write.ref.id]={...(database[write.ref.id]||{}),...write.data};writes.push(write);}}};
 e.T.setLive({F,db:{}});
 return {...e,database,reads,writes,offline:value=>offline=value,gate:value=>gate=value};
}
const checks=[];function check(name,fn){fn();checks.push(name);}
(async()=>{
 const db={'CLAIM-100':copy(initial)},contractor=setup(db),staff=setup(db);staff.asStaff();
 await contractor.T.loadLiveRef('CLAIM-100');
 check('Opening a known claim refreshes its local record without adding a copy',()=>{assert.equal(contractor.T.store().claims.length,1);assert.equal(contractor.T.active().id,'cached');assert.equal(contractor.T.claim().scheduleStatus,'Contractor Schedule Complete');});
 staff.el('nextStatus').value='TBRN Approved Schedule';await staff.N.updateStatus();
 check('Approval updates one live document and retains schedule rates and approved history',()=>{assert.deepEqual(Object.keys(db),['CLAIM-100']);assert.equal(db['CLAIM-100'].scheduleStatus,'TBRN Approved Schedule');assert.equal(db['CLAIM-100'].schedule[0].rate,initial.schedule[0].rate);assert.equal(db['CLAIM-100'].scheduleHistory.length,1);assert.equal(staff.writes.length,1);});
 await contractor.T.loadLiveRef('CLAIM-100');contractor.N.nav('claims');
 check('The contractor sees one approved entry after opening TBRN’s approval',()=>{assert.equal(contractor.T.store().claims.length,1);assert.equal(contractor.T.claim().scheduleStatus,'TBRN Approved Schedule');assert.equal(contractor.T.claim().scheduleHistory.length,1);assert.equal((contractor.el('claimRows').innerHTML.match(/class="row-title"/g)||[]).length,1);assert(contractor.el('claimRows').innerHTML.includes('Approved'));assert(!contractor.el('claimRows').innerHTML.includes('Ready for review'));assert.equal(contractor.writes.length,0);});
 await contractor.T.loadLiveRef('CLAIM-100');await contractor.N.openLocal('cached');
 check('Repeated email/reference opens and saved-list opens reuse the same local ID',()=>{assert.equal(contractor.T.store().claims.length,1);assert.equal(contractor.T.active().id,'cached');assert.equal(contractor.reads.filter(r=>r.type==='server').length,4);});
 const legacy=setup();legacy.T.store().claims=[record('old'),record('new',db['CLAIM-100']),record('repeat-old')];legacy.T.store().activeId='old';legacy.T.applySessionAccess();
 check('Existing clean duplicates are consolidated on sign-in, using the latest confirmed revision',()=>{assert.equal(legacy.T.store().claims.length,1);assert.equal(legacy.T.active().id,'new');assert.equal(legacy.T.claim().scheduleStatus,'TBRN Approved Schedule');assert.equal(JSON.parse(legacy.saved.get('novaClaimsWorkspaceV5')).claims.length,1);});
 const stampOnly=setup();const newer=record('newer');newer.remote.stamp='[500,0,7]';newer.updatedAt='2020-01-01T00:00:00Z';const older=record('older');older.updatedAt='2030-01-01T00:00:00Z';stampOnly.T.store().claims=[older,newer];stampOnly.T.store().activeId='older';stampOnly.T.consolidateLocalClaimCopies();
 check('Confirmed server revision wins over recent local viewing time and stale payload revision',()=>assert.equal(stampOnly.T.active().id,'newer'));
 const variation=setup();const approved=record('approved',{...initial,novaRevision:4,scheduleStatus:'TBRN Approved Schedule'}),varied=record('variation',{...initial,novaRevision:5,scheduleStatus:'In Progress'});variation.T.store().claims=[approved,varied];variation.T.store().activeId='approved';variation.T.consolidateLocalClaimCopies();
 check('A newer variation can legitimately return to In Progress; status order is never used for deduplication',()=>assert.equal(variation.T.claim().scheduleStatus,'In Progress'));
 const twins=setup();twins.T.store().claims=[record('one',initial,false,'random-one'),record('two',initial,false,'random-two'),record('local',initial,true,null)];twins.T.store().activeId='one';twins.T.consolidateLocalClaimCopies();
 check('Different live document IDs and independent local drafts are never merged by reference',()=>{assert.equal(twins.T.store().claims.length,3);assert.equal(twins.T.localClaimsForDisplay().length,3);});
 const drafts=setup({'CLAIM-100':copy(db['CLAIM-100'])});const draft=record('draft',initial,true);draft.payload.schedule[0].qty=99;draft.payload.surveyorNotes='Keep this unfinished work';drafts.T.store().claims=[draft,record('old')];drafts.T.store().activeId='draft';const preserved=copy(draft);
 await drafts.T.loadLiveRef('CLAIM-100');drafts.N.nav('claims');
 check('An approved live copy is shown once while unsaved local work is preserved intact',()=>{assert.equal(drafts.T.store().claims.length,2);assert.deepEqual(copy(drafts.T.store().claims.find(r=>r.id==='draft')),preserved);assert.equal(drafts.T.localClaimsForDisplay().length,1);assert.equal(drafts.T.localClaimsForDisplay()[0].payload.scheduleStatus,'TBRN Approved Schedule');assert(drafts.el('claimRows').innerHTML.includes('Local drafts (1)'));assert.equal((drafts.el('claimRows').innerHTML.match(/class="row-title"/g)||[]).length,1);});
 drafts.N.reviewLocalClaimDrafts(drafts.T.active().id);
 check('Saved local edits are accessible in a clearly labelled draft review',()=>{assert(drafts.el('dialog').innerHTML.includes('unsaved copies'));assert(drafts.el('dialog').innerHTML.includes('Open draft'));});
 drafts.N.openSavedClaimDraft('draft');
 check('Opening an unsaved draft preserves it and warns that it is separate from the live schedule',()=>{assert.equal(drafts.T.active().id,'draft');assert.equal(drafts.T.claim().schedule[0].qty,99);assert(drafts.el('content').innerHTML.includes('You are viewing an unsaved local draft'));assert(drafts.el('content').innerHTML.includes('Open latest live'));assert.equal(drafts.reads.filter(r=>r.type==='server').length,1);});
 assert.equal(await drafts.N.saveLive(),false);
 check('An old local draft cannot overwrite a schedule subsequently approved by TBRN',()=>{assert.equal(drafts.writes.length,0);assert.equal(drafts.database['CLAIM-100'].scheduleStatus,'TBRN Approved Schedule');assert.equal(drafts.database['CLAIM-100'].schedule[0].qty,initial.schedule[0].qty);assert.equal(drafts.T.claim().schedule[0].qty,99);});
 await drafts.N.openLocal('draft');
 check('Opening latest live from a draft returns to the existing canonical copy',()=>{assert.equal(drafts.T.active().id,'old');assert.equal(drafts.T.store().claims.length,2);assert.equal(drafts.T.claim().scheduleStatus,'TBRN Approved Schedule');});
 const onlyDrafts=setup();onlyDrafts.T.store().claims=[record('draft-a',initial,true),record('draft-b',initial,true)];onlyDrafts.T.store().activeId='draft-a';onlyDrafts.N.nav('claims');
 check('Multiple unsaved copies remain one claim entry with both drafts accessible',()=>{assert.equal(onlyDrafts.T.localClaimsForDisplay().length,1);assert.equal(onlyDrafts.T.localDraftsFor(onlyDrafts.T.active()).length,2);assert(onlyDrafts.el('claimRows').innerHTML.includes('Unsaved local draft'));assert(onlyDrafts.el('claimRows').innerHTML.includes('Local drafts (2)'));});
 const cancelled=setup();cancelled.T.active().dirty=true;cancelled.T.setConfirm(false);const before=copy(cancelled.T.store().claims);assert.equal(await cancelled.T.loadLiveRef('CLAIM-100'),false);
 check('Cancelling a live reload leaves unsaved work and selection untouched',()=>{assert.deepEqual(copy(cancelled.T.store().claims),before);assert.equal(cancelled.T.active().id,'cached');});
 const failed=setup();failed.offline(true);const offlineBefore=copy(failed.T.store());assert.equal(await failed.N.openLocal('cached'),false);
 check('An offline open never silently falls back to an obsolete cached status',()=>{assert.deepEqual(copy(failed.T.store()),offlineBefore);assert.deepEqual(failed.reads.map(r=>r.type),['server']);assert(failed.messages.at(-1).includes('saved copies have been kept'));});
 const failedStorage=setup();failedStorage.T.active().dirty=true;failedStorage.failStorage(true);const storageBefore=copy(failedStorage.T.store());assert.equal(await failedStorage.T.loadLiveRef('CLAIM-100'),false);
 check('Storage failure prevents replacing a claim or losing its unsaved draft',()=>assert.deepEqual(copy(failedStorage.T.store()),storageBefore));
 const unknown=setup();delete unknown.database['CLAIM-100'];assert.equal(await unknown.N.openLocal('cached'),false);
 check('A deleted live claim is not recreated from a cached copy',()=>{assert.equal(unknown.T.store().claims.length,1);assert.equal(unknown.writes.length,0);assert(!unknown.reads.some(r=>r.type==='server-list'));});
 const forbidden=setup();forbidden.database['CLAIM-100'].assignedContractor='other@example.test';assert.equal(await forbidden.N.openLocal('cached'),false);
 check('Live assignment is checked before replacing or opening any cached claim',()=>{assert.equal(forbidden.T.claim().assignedContractor,'builder@example.test');assert.equal(forbidden.writes.length,0);assert(forbidden.messages.at(-1).includes('not assigned'));});
 const switched=setup();let release;switched.gate(new Promise(resolve=>release=resolve));const oldRequest=switched.T.loadLiveRef('CLAIM-100');switched.T.setUser({uid:'other',email:'other@example.test',emailVerified:true});release();assert.equal(await oldRequest,false);
 check('A previous account’s delayed response cannot replace cached claims',()=>{assert.equal(switched.T.store().claims.length,1);assert.equal(switched.T.active().id,'cached');});
 const raced=setup();let finishOld;raced.gate(new Promise(resolve=>finishOld=resolve));const earlier=raced.T.loadLiveRef('CLAIM-100');raced.gate(null);raced.database['CLAIM-100']=copy(db['CLAIM-100']);await raced.T.loadLiveRef('CLAIM-100');finishOld();assert.equal(await earlier,false);
 check('An older delayed read cannot downgrade the approved copy after a newer open',()=>{assert.equal(raced.T.store().claims.length,1);assert.equal(raced.T.claim().scheduleStatus,'TBRN Approved Schedule');});
 const busy=setup();busy.T.setBusy(true);assert.equal(await busy.N.openLocal('cached'),false);
 check('A reload cannot replace a record while its live save is in progress',()=>assert.equal(busy.reads.length,0));
 const saved=setup();saved.asStaff();saved.T.store().claims.push(record('previous-clean'));saved.T.active().payload.surveyorNotes='Approved work reviewed';saved.T.active().dirty=true;assert.equal(await saved.N.saveLive(),true);
 check('A successful live save removes obsolete clean copies of that same claim',()=>{assert.equal(saved.T.store().claims.length,1);assert.equal(saved.T.active().id,'cached');assert.equal(saved.writes.length,1);});
 const hidden=setup();hidden.T.setUser({uid:'other',email:'unassigned@example.test',emailVerified:true});hidden.N.reviewLocalClaimDrafts('cached');hidden.N.openSavedClaimDraft('cached');
 check('Draft grouping and draft actions preserve contractor account isolation',()=>{assert.equal(hidden.T.localClaimsForDisplay().length,0);assert.equal(hidden.el('dialog').open,false);assert.equal(hidden.reads.length,0);});
 console.log(JSON.stringify({passed:checks.length,checks,productionDataTouched:false},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});

const assert=require('node:assert/strict');
const {start,fixture}=require('./schedule-versions.cjs');
const copy=value=>JSON.parse(JSON.stringify(value));
const hooks=`Object.assign(api.__check,{bracketClaimReference,claimReferenceCore,claimMatches,loadLiveRef,portalLink,handleDeepLink,isStaff,canAccess,setQuery:value=>{location.search=value;},setDuplicate:payload=>{pendingDuplicate={payload,code:payload.scheduleCopyCode,sourceDescription:'Synthetic source',updatedAt:''};}});`;
function setup(database={},role='admin'){
 const e=start({...copy(fixture),claimRef:'',scheduleStatus:'Draft',schedule:[]},hooks),reads=[],writes=[];let lists=0,offline=false;
 if(role==='contractor')e.asContractor();else e.asStaff(role);
 const snapshot=id=>({id,exists:()=>!!database[id],data:()=>copy(database[id])});
 const F={doc:(_db,collection,id)=>({collection,id}),collection:(_db,name)=>({name}),serverTimestamp:()=>({seconds:500,nanoseconds:0}),
  getDocFromServer:async ref=>{reads.push(ref.id);if(offline)throw Object.assign(Error('Offline'),{code:'unavailable'});if(!e.T.isStaff()&&(!database[ref.id]||!e.T.canAccess(database[ref.id])))throw Object.assign(Error('Claim unavailable to this account'),{code:'permission-denied'});return snapshot(ref.id);},
  getDocsFromServer:async()=>{lists++;return {docs:Object.keys(database).map(snapshot)};},getDoc:async ref=>snapshot(ref.id),
  runTransaction:async(_db,callback)=>{let pending;await callback({get:async ref=>snapshot(ref.id),set:(ref,data)=>{pending={ref,data:copy(data)};}});if(pending){database[pending.ref.id]={...(database[pending.ref.id]||{}),...pending.data};writes.push(pending);}}
 };
 e.T.setLive({F,db:{}});
 const input=(value,eventType='input')=>{const node=e.el('claimRef');Object.assign(node,{value,type:'text',tagName:'INPUT',dataset:{field:'claimRef'},matches:selector=>selector==='[data-field]'});e.T.formInput({type:eventType,target:node});return node;};
 return {...e,database,reads,writes,input,lists:()=>lists,setOffline:value=>offline=value};
}
const checks=[];function check(name,fn){fn();checks.push(name);}
(async()=>{
 const e=setup();let node=e.input('2321678');
 check('Typing a new reference stores brackets without moving the text being edited',()=>{assert.equal(e.T.claim().claimRef,'[2321678]');assert.equal(node.value,'2321678');});
 node=e.input('2321678','change');
 check('Leaving the reference field displays the brackets',()=>assert.equal(node.value,'[2321678]'));
 for(const text of ['[2321678]',' [[2321678]] ','[2321678','2321678]']){e.input(text,'change');}
 check('Existing, repeated and partially entered outer brackets produce one pair',()=>{assert.equal(e.T.claim().claimRef,'[2321678]');assert.equal(e.el('claimRef').value,'[2321678]');});
 check('Reference formatting preserves leading zeroes, letters and internal reference punctuation',()=>{assert.equal(e.T.bracketClaimReference('00123'),'[00123]');assert.equal(e.T.bracketClaimReference('TPD-123/A'),'[TPD-123/A]');assert.equal(e.T.bracketClaimReference('ABC[01]'),'[ABC[01]]');});
 for(const value of ['', '   ', '[]', '[ ]', '[[ ]]'])assert.equal(e.T.bracketClaimReference(value),'');
 check('An empty reference is kept empty instead of becoming an apparently valid pair of brackets',()=>{e.input('[]','change');assert.equal(e.T.claim().claimRef,'');});
 assert.equal(await e.N.saveLive(),false);
 check('Blank references still prevent live claim creation',()=>assert.equal(e.writes.length,0));
 e.input('2321678','change');assert.equal(await e.N.saveLive(),true);
 check('The new live claim, form data and search field all save the bracketed reference',()=>{const saved=e.database['[2321678]'];assert(saved);assert.equal(saved.claimRef,'[2321678]');assert.equal(saved.formData.claimRef,'[2321678]');assert.equal(saved.claimRefLower,'[2321678]');assert.equal(e.T.active().remote.id,'[2321678]');});
 check('Reports and encoded email links use the new reference',()=>{assert(e.T.reportHtml(false).includes('[2321678]'));assert.equal(new URL(e.T.portalLink()).searchParams.get('claimRef'),'[2321678]');});
 check('Claim search accepts references with or without square brackets',()=>{assert(e.T.claimMatches(e.T.claim(),'2321678'));assert(e.T.claimMatches(e.T.claim(),'[2321678]'));});
 const direct=setup();direct.T.claim().claimRef='009876';assert.equal(await direct.N.saveLive(),true);
 check('First live save formats a draft even if it bypassed the text-field event',()=>assert.equal(direct.database['[009876]'].claimRef,'[009876]'));
 const concierge=setup({},'concierge');concierge.N.newClaim();concierge.T.claim().tbrnClaimsConcierge='Concierge';concierge.T.claim().tbrnReviewerSurveyor='Reviewer';concierge.input('333','change');assert.equal(await concierge.N.saveLive(),true);
 check('Claims Concierges can still create a blank claim with its bracketed reference',()=>{assert.equal(concierge.database['[333]'].claimRef,'[333]');assert.deepEqual(concierge.database['[333]'].schedule,[]);});
 const legacyData={...copy(fixture),claimRef:'2321678'},legacy=setup({'2321678':copy(legacyData)});
 await legacy.T.loadLiveRef('2321678');legacy.input('SHOULD-NOT-CHANGE','change');assert.equal(await legacy.N.saveLive(),true);
 check('Existing live references and their document IDs remain unchanged',()=>{assert.equal(legacy.T.claim().claimRef,'2321678');assert.equal(legacy.T.active().remote.id,'2321678');assert(!legacy.database['[2321678]']);assert.equal(legacy.database['2321678'].claimRef,'2321678');});
 const collision=setup({'2321678':copy(legacyData)});collision.input('2321678','change');assert.equal(await collision.N.saveLive(),false);
 check('Adding brackets cannot accidentally create a second claim alongside its legacy unbracketed ID',()=>{assert.equal(collision.writes.length,0);assert.deepEqual(collision.database['2321678'],legacyData);assert(!collision.database['[2321678]']);});
 const duplicate=setup();duplicate.T.claim().claimRef='ORIGINAL';duplicate.T.setDuplicate(copy(fixture));duplicate.el('duplicateClaimRef').value='45678';duplicate.N.createDuplicateClaim();
 check('Duplicate-from-code creates the new draft with a bracketed reference',()=>{assert.equal(duplicate.T.claim().claimRef,'[45678]');assert.equal(duplicate.T.claim().schedule[0].rate,fixture.schedule[0].rate);assert.equal(duplicate.T.store().claims[1].payload.claimRef,'ORIGINAL');});
 const same=setup();same.T.setDuplicate(copy(fixture));same.el('duplicateClaimRef').value='[TEST-SOURCE]';same.N.createDuplicateClaim();
 check('Brackets do not bypass the duplicate-source reference check',()=>{assert.equal(same.T.store().claims.length,1);assert(same.el('duplicateCreateMessage').textContent.includes('different reference'));});
 const localDuplicate=setup();localDuplicate.T.claim().claimRef='45678';localDuplicate.T.setDuplicate(copy(fixture));localDuplicate.el('duplicateClaimRef').value='[45678]';localDuplicate.N.createDuplicateClaim();
 check('Brackets do not bypass a matching local reference check',()=>assert.equal(localDuplicate.T.store().claims.length,1));
 const freshData={...copy(fixture),claimRef:'[2321678]'},contractor=setup({'[2321678]':copy(freshData)},'contractor');
 assert.equal(await contractor.T.loadLiveRef('2321678'),true);
 check('A contractor can find an assigned bracketed claim using only its number without listing all claims',()=>{assert.equal(contractor.T.claim().claimRef,'[2321678]');assert.equal(contractor.T.active().remote.id,'[2321678]');assert.deepEqual(contractor.reads,['2321678','[2321678]']);assert.equal(contractor.lists(),0);});
 const oldLink=setup({'2321678':copy(legacyData)},'contractor');assert.equal(await oldLink.T.loadLiveRef('[2321678]'),true);
 check('Bracketed lookup also finds an assigned legacy reference without renaming it',()=>{assert.equal(oldLink.T.claim().claimRef,'2321678');assert.equal(oldLink.lists(),0);});
 const linked=setup({'[2321678]':copy(freshData)},'contractor');linked.T.setQuery('?claimRef=%5B2321678%5D');assert.equal(await linked.T.handleDeepLink(),true);
 check('Email links with encoded brackets open the assigned claim',()=>assert.equal(linked.T.active().remote.id,'[2321678]'));
 const forbidden=setup({'[2321678]':{...freshData,assignedContractor:'other@example.test'}},'contractor');assert.equal(await forbidden.T.loadLiveRef('2321678'),false);
 check('Reference fallback preserves contractor assignment restrictions',()=>{assert.equal(forbidden.T.claim().claimRef,'');assert.equal(forbidden.lists(),0);});
 const exact=setup({'2321678':copy(legacyData)});assert.equal(await exact.T.loadLiveRef('[2321678]','[2321678]'),false);
 check('Exact document opens never fall back to a different claim after deletion',()=>{assert.deepEqual(exact.reads,['[2321678]']);assert.equal(exact.lists(),0);assert.equal(exact.T.claim().claimRef,'');});
 const offline=setup({'[2321678]':copy(freshData)});offline.setOffline(true);assert.equal(await offline.T.loadLiveRef('2321678'),false);
 check('A network error does not get treated as a missing-reference alias',()=>assert.deepEqual(offline.reads,['2321678']));
 const oldGenerated=setup({'random-legacy-id':copy(legacyData)});assert.equal(await oldGenerated.T.loadLiveRef('[2321678]'),true);
 check('Staff can still find legacy generated document IDs with either reference format',()=>{assert.equal(oldGenerated.T.active().remote.id,'random-legacy-id');assert.equal(oldGenerated.T.claim().claimRef,'2321678');});
 console.log(JSON.stringify({passed:checks.length,checks,productionDataTouched:false},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});

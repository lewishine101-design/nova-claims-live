// Run: node tests/staff-access.cjs [path/to/index.html]
// Isolated accounts and claims only; no Firebase credentials or network access.
const assert=require('node:assert/strict');
const {start,fixture}=require('./schedule-versions.cjs');
const copy=x=>JSON.parse(JSON.stringify(x));
const hooks=`Object.assign(api.__check,{applySessionAccess,loadLiveRef,canAccess,isStaff,claimsView,viewLabel,claimMatches,getScope:()=>claimScope,getRecords:()=>liveRecords,getState:()=>liveClaimsState,getPage:()=>page});`;
const staff={uid:'staff-one',email:'one@tbrn.co.uk',emailVerified:true};
const secondStaff={uid:'staff-two',email:'TWO@TBRN.CO.UK',emailVerified:true};
const contractor={uid:'builder',email:'builder@example.test',emailVerified:true};
const records={
 'CLAIM-101':{...copy(fixture),claimRef:'CLAIM-101',claimantName:'Alice Example',propertyAddress:'10 Test Road, Tunbridge Wells TN1 1AB',createdBy:'different-staff',createdByEmail:'creator@tbrn.co.uk',tbrnClaimsConcierge:'Other Concierge',tbrnReviewerSurveyor:'Other Surveyor',assignedContractor:'another@example.test'},
 'CLAIM-202':{...copy(fixture),claimRef:'CLAIM-202',claimantName:'Bob Example',propertyAddress:'20 Sample Street, Loughton IG10 1AA',assignedContractor:'builder@example.test'},
 'legacy-random-id':{formData:{claimRef:'LEGACY-303',claimantName:'Carol Example',propertyAddress:'30 Old Road, Kent ME14 1AA',scheduleStatus:'In Progress'},schedule:copy(fixture.schedule),rooms:['Living room'],roomDimensions:{},createdBy:'former-user'}
};
function setup(account=staff){
 const e=start(fixture,hooks),calls=[],db=copy(records);let listError=null,listGate=null,readGate=null;
 const snapshot=id=>({id,exists:()=>!!db[id],data:()=>copy(db[id])});
 const F={
  doc:(_db,collection,id)=>({collection,id}),collection:(_db,name)=>({collection:name}),
  getDocs:async ref=>{calls.push({method:'list',ref});if(listGate)await listGate;if(listError)throw listError;return {docs:Object.keys(db).map(snapshot)};},
  getDoc:async ref=>{calls.push({method:'get',ref});if(readGate)await readGate;return snapshot(ref.id);}
 };
 F.getDocFromServer=F.getDoc;F.getDocsFromServer=F.getDocs;
 e.T.setLive({F,db:{}});e.T.setUser(account);e.T.applySessionAccess();
 return {...e,calls,db,listError:v=>{listError=v;},listGate:v=>{listGate=v;},readGate:v=>{readGate=v;},login:u=>{e.T.setUser(u);e.T.applySessionAccess();}};
}
const checks=[];function check(name,fn){fn();checks.push(name);}
(async()=>{
 const e=setup();
 check('Staff sign-in defaults to All live claims and All claims navigation',()=>{assert.equal(e.T.getScope(),'live');assert.equal(e.T.viewLabel('claims'),'All claims');assert(e.T.claimsView().includes('All live claims'));});
 e.N.nav('claims');await e.N.loadLiveClaims();
 check('Entering staff claims loads the complete shared collection without owner or assignment filters',()=>{assert.equal(e.calls.filter(c=>c.method==='list').length,1);assert.deepEqual(e.calls[0].ref,{collection:'claims'});assert.equal(e.T.getRecords().length,3);assert(e.el('claimRows').innerHTML.includes('CLAIM-101'));assert(e.el('claimRows').innerHTML.includes('LEGACY-303'));});
 check('Every staff member can access claims created or assigned to others and unassigned legacy claims',()=>{for(const p of Object.values(e.db))assert(e.T.canAccess(e.T.normalise(p)));e.login(secondStaff);for(const p of Object.values(e.db))assert(e.T.canAccess(e.T.normalise(p)));assert(e.T.isStaff());});
 await e.N.loadLiveClaims();
 check('Staff search supports partial references, names, addresses and postcodes',()=>{for(const query of ['claim-10','claim101','ALICE','test road','TN11AB','alice tn1']){e.N.claimSearch(query);assert(e.el('claimRows').innerHTML.includes('CLAIM-101'),query);assert(!e.el('claimRows').innerHTML.includes('CLAIM-202'),query);}e.N.claimSearch('Carol');assert(e.el('claimRows').innerHTML.includes('LEGACY-303'));});
 check('No-match state is distinct from loading, with a working clear search action',()=>{e.N.claimSearch('not-a-known-claim');assert(e.el('claimRows').innerHTML.includes('No matching claims'));assert(e.el('claimRows').innerHTML.includes('Clear search'));assert.equal(e.el('claimSearchStatus').textContent,'0 of 3 live claims');e.N.claimSearch('');assert.equal(e.el('claimSearch').value,'');assert.equal(e.el('claimSearchStatus').textContent,'3 of 3 live claims');});
 e.db['CLAIM-101'].claimantName='Alice Updated';await e.N.openLiveIndex(0);
 check('Open reads the latest live record regardless of staff assignments and preserves rates',()=>{assert.equal(e.T.claim().claimRef,'CLAIM-101');assert.equal(e.T.claim().claimantName,'Alice Updated');assert.equal(e.T.claim().schedule[0].rate,fixture.schedule[0].rate);assert.equal(e.T.active().remote.id,'CLAIM-101');assert.equal(e.calls.at(-1).method,'get');});
 e.N.claimScope('local');e.N.findClaim();
 check('Find claim takes staff directly to shared search with local filter cleared',()=>{assert.equal(e.T.getPage(),'claims');assert.equal(e.T.getScope(),'live');assert.equal(e.el('claimSearch').value,'');});
 assert.equal(await e.T.loadLiveRef('legacy-303'),true);
 check('Exact reference lookup also opens old formData records with generated IDs and different casing',()=>{assert.equal(e.T.claim().claimRef,'LEGACY-303');assert.equal(e.T.active().remote.id,'legacy-random-id');});
 e.db['legacy-duplicate']=copy(e.db['legacy-random-id']);
 assert.equal(await e.T.loadLiveRef('legacy-303'),false);
 check('Ambiguous legacy references ask staff to choose a result instead of opening an arbitrary claim',()=>{assert(e.messages.at(-1).includes('More than one live claim'));});
 const denied=setup();denied.listError({code:'permission-denied',message:'Denied'});await denied.N.loadLiveClaims();
 check('A database permission failure is shown clearly instead of a misleading empty result',()=>{assert.equal(denied.T.getState(),'error');assert(denied.el('claimRows').innerHTML.includes('database is denying access'));assert.equal(denied.T.getRecords().length,0);});
 denied.listError(null);await denied.N.loadLiveClaims();
 check('Staff can retry after a connection or permission failure',()=>{assert.equal(denied.T.getState(),'loaded');assert.equal(denied.T.getRecords().length,3);});
 denied.listError({message:'<img src=x onerror=alert(1)>'});await denied.N.loadLiveClaims();
 check('Remote error messages are escaped before displaying them in search',()=>{assert(denied.el('claimRows').innerHTML.includes('&lt;img'));assert(!denied.el('claimRows').innerHTML.includes('<img'));});
 const delayed=setup();let release;delayed.listGate(new Promise(resolve=>{release=resolve;}));const pending=delayed.N.loadLiveClaims();
 check('Loading state appears while the shared list is in flight',()=>{assert(delayed.el('claimRows').innerHTML.includes('Loading all live claims'));});
 delayed.N.nav('details');release();await pending;
 check('A completed background load does not interrupt a member of staff editing another page',()=>assert.equal(delayed.T.getPage(),'details'));
 const switched=setup();let finish;switched.listGate(new Promise(resolve=>{finish=resolve;}));const oldList=switched.N.loadLiveClaims();switched.login(contractor);finish();await oldList;
 check('Signing into a contractor account discards a staff list still in flight',()=>{assert.equal(switched.T.getRecords().length,0);assert.equal(switched.T.getScope(),'local');assert.equal(switched.T.viewLabel('claims'),'My claims');});
 const open=setup();let releaseOpen;open.readGate(new Promise(resolve=>{releaseOpen=resolve;}));const oldOpen=open.T.loadLiveRef('CLAIM-101');const original=open.T.claim().claimRef;open.login({...contractor,email:'unassigned@example.test'});releaseOpen();assert.equal(await oldOpen,false);
 check('A claim response from a previous session cannot open after accounts switch',()=>assert.equal(open.T.claim().claimRef,original));
 const c=setup(contractor);await c.N.loadLiveClaims();
 check('Contractors cannot enumerate the shared claims collection',()=>assert.equal(c.calls.length,0));
 assert.equal(await c.T.loadLiveRef('CLAIM-202'),true);assert.equal(await c.T.loadLiveRef('CLAIM-101'),false);
 check('Contractors can open assigned references but are blocked from other claims',()=>{assert.equal(c.T.claim().claimRef,'CLAIM-202');assert.equal(c.calls.filter(x=>x.method==='list').length,0);});
 assert.equal(await c.T.loadLiveRef('missing-reference'),false);
 check('Contractor missing-reference lookup does not fall back to listing everyone’s claims',()=>assert.equal(c.calls.filter(x=>x.method==='list').length,0));
 const unverified=setup({...staff,emailVerified:false});await unverified.N.loadLiveClaims();assert.equal(await unverified.T.loadLiveRef('CLAIM-101'),false);
 check('Unverified accounts cannot search or open live claims',()=>assert.equal(unverified.calls.length,0));
 const outsider=setup({...contractor,role:'staff',email:'staff@tbrn.co.uk.attacker.test'});await outsider.N.loadLiveClaims();
 check('A display role or lookalike email domain does not grant staff search',()=>{assert(!outsider.T.isStaff());assert.equal(outsider.calls.length,0);});
 console.log(JSON.stringify({passed:checks.length,checks,productionDataTouched:false},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});

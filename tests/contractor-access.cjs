// Admin page and account isolation tests, using synthetic profiles and claims only.
const assert=require('node:assert/strict');
const {start,fixture}=require('./schedule-versions.cjs');
const copy=x=>JSON.parse(JSON.stringify(x));
const hooks=`Object.assign(api.__check,{canAdmin,canView,render,loadStaffAccess,contractorAccessView,clearContractorAccess,getPage:()=>page,setPage:p=>{page=p;},getAccounts:()=>contractorAccounts,getAccountState:()=>contractorAccountsState,getSelection:()=>contractorAccessSelection,getAccountClaims:()=>contractorAccessClaims,getClaimState:()=>contractorAccessClaimsState});`;
const profiles=[
 {id:'alpha',value:{id:'spoofed-profile-id',email:'Builder@Example.Test',contractorName:'Alpha & Sons',role:'contractor',createdAt:{seconds:1750000000}}},
 {id:'beta',value:{email:'second@example.test',contractorName:'Beta Construction',role:'contractor'}},
 {id:'escaped',value:{email:'third@example.test',contractorName:'<img src=x onerror=alert(1)>',role:'contractor'}},
 {id:'staff',value:{email:'STAFF@TBRN.CO.UK',contractorName:'Not a contractor',role:'contractor'}},
 {id:'invalid',value:{email:'invalid address',contractorName:'Invalid profile'}}
];
const claims={
 'current':{...copy(fixture),claimRef:'CLAIM-01',assignedContractor:'builder@example.test'},
 'legacy-random-id':{formData:{claimRef:'CLAIM-02',claimantName:'Legacy claimant',propertyAddress:'Old property',assignedContractor:'Builder@Example.Test',scheduleStatus:'In Progress'}},
 'alias':{...copy(fixture),claimRef:'CLAIM-03',assignedContractor:'',assignedToEmail:'builder@example.test'},
 'multiple':{...copy(fixture),claimRef:'CLAIM-04',assignedContractor:'second@example.test',contractorEmails:'second@example.test; builder@example.test'},
 'other':{...copy(fixture),claimRef:'OTHER-01',assignedContractor:'notbuilder@example.test'}
};
function setup(){
 const e=start(fixture,hooks),calls=[],records=copy(claims);let profileGate=null,claimGate=null,profileError=false,claimError=false,roleCallback=null,roleFailure=null;
 const docs=items=>({docs:items.map(entry=>({id:entry.id,data:()=>copy(entry.value),exists:()=>true}))});
 const F={collection:(_db,name)=>({name}),doc:(_db,name,id)=>({name,id}),getDocsFromServer:async ref=>{calls.push({method:'list',name:ref.name});if(ref.name==='users'){if(profileGate)await profileGate;if(profileError)throw Error('Network failure');return docs(profiles);}if(ref.name==='claims'){if(claimGate)await claimGate;if(claimError)throw Error('Network failure');return docs(Object.entries(records).map(([id,value])=>({id,value})));}throw Error('Unexpected collection');},getDoc:async ref=>{calls.push({method:'get',...ref});return {id:ref.id,exists:()=>!!records[ref.id],data:()=>copy(records[ref.id])};},getDocFromServer:async()=>({exists:()=>true,data:()=>({email:'staff@tbrn.co.uk',level:'admin'})}),onSnapshot:(_ref,_opts,success,error)=>{roleCallback=success;roleFailure=error;return ()=>{};}};
 e.T.setLive({F,db:{}});
 return {...e,calls,records,profileGate:v=>profileGate=v,claimGate:v=>claimGate=v,profileError:v=>profileError=v,claimError:v=>claimError=v,downgrade:()=>roleCallback({exists:()=>true,data:()=>({email:'staff@tbrn.co.uk',level:'surveyor'})}),failRole:()=>roleFailure()};
}
const checks=[];function check(name,fn){fn();checks.push(name);}
async function accounts(e){e.T.setPage('contractor-access');await e.N.loadContractorAccounts();}
const indexOf=(e,email)=>e.T.getAccounts().findIndex(entry=>entry.email===email);
(async()=>{
 const e=setup();e.asStaff();e.T.render();
 check('The admin sidebar puts Contractor access directly below Staff access',()=>{const nav=e.el('mainNav').innerHTML;assert(nav.includes('Contractor access'));assert(nav.indexOf("N.nav('contractor-access')")>nav.indexOf("N.nav('staff')"));const tabs=[...nav.matchAll(/data-view="([^"]+)"/g)].map(match=>match[1]);assert.equal(tabs[tabs.indexOf('staff')+1],'contractor-access');});
 for(const role of ['concierge','surveyor','contractor','unverified','signed-out']){
  const denied=setup();if(['concierge','surveyor'].includes(role))denied.asStaff(role);else if(role==='contractor')denied.asContractor();else if(role==='unverified')denied.T.setUser({uid:'staff-test',email:'staff@tbrn.co.uk',emailVerified:false});
  denied.N.nav('contractor-access');await denied.N.loadContractorAccounts();await denied.N.viewContractorAccess(0);await denied.N.openContractorAccessClaim(0);
  check(role+' cannot see or open the page, call its loaders or open its claim actions',()=>{assert(!denied.T.canView('contractor-access'));assert(!denied.el('mainNav').innerHTML.includes('Contractor access'));assert.equal(denied.T.contractorAccessView(),'');assert.notEqual(denied.T.getPage(),'contractor-access');assert.equal(denied.calls.length,0);});
 }
 e.N.nav('contractor-access');await new Promise(setImmediate);
 check('Opening the page loads registered contractor profiles once',()=>{assert.equal(e.T.getAccountState(),'loaded');assert.equal(e.T.getAccounts().length,3);assert.equal(e.calls.filter(c=>c.name==='users').length,1);assert(!e.calls.some(c=>c.name==='claims'));assert(!e.T.getAccounts().some(p=>p.email.endsWith('@tbrn.co.uk')));assert.equal(e.T.getAccounts().find(p=>p.email==='builder@example.test').id,'alpha');});
 check('Company names are escaped, and the page explains assigned-claim access',()=>{const html=e.el('content').innerHTML;assert(html.includes('&lt;img'));assert(!html.includes('<img src=x'));assert(html.includes('Assigned claims only'));assert(!html.includes('Not a contractor'));});
 e.N.contractorAccessSearch('alpha');check('Admin can search by company without losing the search input',()=>{assert(e.el('contractorAccountRows').innerHTML.includes('Alpha &amp; Sons'));assert(!e.el('contractorAccountRows').innerHTML.includes('Beta Construction'));assert.equal(e.el('contractorAccountSearch').value,'alpha');});
 e.N.contractorAccessSearch('second@example.test');check('Admin can search by sign-in email',()=>{assert(e.el('contractorAccountRows').innerHTML.includes('Beta Construction'));assert(!e.el('contractorAccountRows').innerHTML.includes('Alpha &amp; Sons'));});
 e.N.contractorAccessSearch('missing');check('No-match search has a working clear action',()=>{assert(e.el('contractorAccountRows').innerHTML.includes('No matching contractor accounts'));e.N.contractorAccessSearch('');assert(e.el('contractorAccountRows').innerHTML.includes('Alpha &amp; Sons'));});
 await e.N.viewContractorAccess(indexOf(e,'builder@example.test'));
 check('Assigned-claim review handles legacy fields, aliases and multiple email assignments without partial matches',()=>{assert.deepEqual(Array.from(e.T.getAccountClaims(),r=>r.payload.claimRef),['CLAIM-01','CLAIM-02','CLAIM-03','CLAIM-04']);assert(!e.el('content').innerHTML.includes('OTHER-01'));assert(e.el('content').innerHTML.includes('4 assigned claims'));});
 e.records['legacy-random-id'].formData.claimantName='Latest claimant';assert.equal(await e.N.openContractorAccessClaim(1),true);
 check('Open claim loads the latest live version by its exact document ID',()=>{assert.equal(e.T.claim().claimantName,'Latest claimant');assert.equal(e.T.active().remote.id,'legacy-random-id');assert.equal(e.T.getPage(),'details');assert.equal(e.T.getSelection(),null);});
 e.N.nav('contractor-access');await e.N.viewContractorAccess(indexOf(e,'third@example.test'));check('A contractor with no assignments has a clear empty state',()=>{assert.equal(e.T.getAccountClaims().length,0);assert(e.el('content').innerHTML.includes('No claims assigned'));});
 e.claimError(true);await e.N.viewContractorAccess(indexOf(e,'builder@example.test'));check('Claim read failures are shown as errors instead of zero access',()=>{assert.equal(e.T.getClaimState(),'error');assert(e.el('content').innerHTML.includes('Assigned claims could not be loaded'));});e.claimError(false);await e.N.retryContractorClaims();check('A failed claim lookup can be retried',()=>assert.equal(e.T.getAccountClaims().length,4));
 e.profileError(true);await e.N.loadContractorAccounts();check('Profile read failures have an explicit retry state and clear old details',()=>{assert.equal(e.T.getAccountState(),'error');assert.equal(e.T.getAccounts().length,0);assert.equal(e.T.getSelection(),null);assert(e.el('content').innerHTML.includes('Contractor accounts could not be loaded'));});e.profileError(false);await e.N.loadContractorAccounts();assert.equal(e.T.getAccountState(),'loaded');
 const switched=setup();switched.asStaff();let releaseProfiles;switched.profileGate(new Promise(resolve=>releaseProfiles=resolve));const pendingProfiles=switched.N.loadContractorAccounts();switched.asContractor();releaseProfiles();await pendingProfiles;check('A profile response from a previous login is discarded',()=>assert.equal(switched.T.getAccounts().length,0));
 const pending=setup();pending.asStaff();await accounts(pending);let releaseClaims;pending.claimGate(new Promise(resolve=>releaseClaims=resolve));const lookup=pending.N.viewContractorAccess(indexOf(pending,'builder@example.test'));pending.N.closeContractorAccess();releaseClaims();await lookup;check('Closing a pending claim review prevents its response from reopening the section',()=>{assert.equal(pending.T.getSelection(),null);assert.equal(pending.T.getAccountClaims().length,0);});
 const downgraded=setup();downgraded.asStaff();await downgraded.T.loadStaffAccess(true);await accounts(downgraded);await downgraded.N.viewContractorAccess(indexOf(downgraded,'builder@example.test'));downgraded.downgrade();
 check('A live role downgrade clears contractor data and exits the admin page',()=>{assert.equal(downgraded.T.getAccounts().length,0);assert.equal(downgraded.T.getAccountClaims().length,0);assert.equal(downgraded.T.getPage(),'overview');assert(!downgraded.el('mainNav').innerHTML.includes('Contractor access'));});
 const failedRole=setup();failedRole.asStaff();await failedRole.T.loadStaffAccess(true);await accounts(failedRole);failedRole.failRole();check('Losing role verification also clears account data and closes the page',()=>{assert.equal(failedRole.T.getAccounts().length,0);assert.equal(failedRole.T.getPage(),'overview');});
 const restore=setup();restore.asStaff();restore.T.setPage('contractor-access');restore.T.render();await new Promise(setImmediate);check('Restoring the admin page loads accounts without needing a manual refresh',()=>assert.equal(restore.T.getAccountState(),'loaded'));
 check('The page only reads account and claim data',()=>assert(e.calls.every(call=>['list','get'].includes(call.method))));
 console.log(JSON.stringify({passed:checks.length,checks,productionDataTouched:false},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});

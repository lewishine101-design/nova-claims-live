// Synthetic permission checks for Data & backup and every action exposed by that section.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {start,fixture}=require('./schedule-versions.cjs');
const copy=x=>JSON.parse(JSON.stringify(x));
const html=fs.readFileSync(process.argv[2]||path.resolve(__dirname,'../index.html'),'utf8');
const hooks=`let dataTestDownloads=[];download=(content,name,type)=>dataTestDownloads.push({content,name,type});Object.assign(api.__check,{canView,dataView,receiveBackup,render,loadStaffAccess,getPage:()=>page,setPage:value=>{page=value;},downloads:()=>dataTestDownloads,pendingImport:()=>pendingImport,getRates:()=>rateList});`;
const backup={format:'nova-claims-workspace',workspace:{claims:[{payload:{...copy(fixture),claimRef:'IMPORTED-01'}}],rateOverrides:[{code:'TEST',description:'Synthetic rate',rate:12.345678,unit:'item'}],contractors:[{name:'Synthetic contractor',email:'test@example.test'}],favorites:['TEST']}};
function setup(role='admin'){
 const e=start(fixture,hooks);let clicks=0,roleNext=null,roleError=null;
 if(['admin','surveyor','concierge'].includes(role))e.asStaff(role);
 else if(role==='contractor')e.asContractor();
 else if(role==='unverified')e.T.setUser({uid:'staff-test',email:'staff@tbrn.co.uk',emailVerified:false});
 else if(role==='pending')e.T.setUser({uid:'staff-test',email:'staff@tbrn.co.uk',emailVerified:true});
 else if(role==='fake-admin')e.T.setUser({uid:'fake',email:'staff@tbrn.co.uk.attacker.test',emailVerified:true,level:'admin',role:'admin'});
 e.el('importFile').click=()=>clicks++;
 e.T.setLive({F:{doc:(_db,collection,id)=>({collection,id}),getDocFromServer:async()=>({exists:()=>true,data:()=>({email:'staff@tbrn.co.uk',level:'admin'})}),onSnapshot:(_ref,_options,next,error)=>{roleNext=next;roleError=error;return ()=>{};}},db:{}});
 return {...e,clicks:()=>clicks,downgrade:()=>roleNext({exists:()=>true,data:()=>({email:'staff@tbrn.co.uk',level:'surveyor'})}),failRole:()=>roleError()};
}
const checks=[];function check(name,fn){fn();checks.push(name);}
(async()=>{
 check('The Manage heading and Data & backup entry start hidden before role verification',()=>assert(html.includes('<div id="dataManagementNav" hidden><div class="nav-label">MANAGE</div>')));
 for(const role of ['concierge','surveyor','contractor','unverified','pending','fake-admin','signed-out']){
  const e=setup(role);e.T.render();e.N.nav('data');
  check(role+' cannot see or enter Data & backup',()=>{assert.equal(e.el('dataManagementNav').hidden,true);assert(!e.T.canView('data'));assert.equal(e.T.dataView(),'');assert.notEqual(e.T.getPage(),'data');});
  const before=copy(e.T.store()),rates=copy(e.T.getRates());let fileReads=0;
  e.N.exportBackup();e.N.exportClaim();e.N.importBackup();await e.T.receiveBackup({text:async()=>{fileReads++;return JSON.stringify(backup);}});e.N.commitImport();e.N.recoverLegacy();
  check(role+' cannot invoke backup export, claim JSON export, imports or recovery directly',()=>{assert.equal(e.T.downloads().length,0);assert.equal(fileReads,0);assert.equal(e.clicks(),0);assert.equal(e.T.pendingImport(),null);assert.deepEqual(copy(e.T.store()),before);assert.deepEqual(copy(e.T.getRates()),rates);});
 }
 const restored=setup('surveyor');restored.T.setPage('data');restored.T.render();
 check('Restoring a previously open Data page redirects a non-admin to Overview',()=>{assert.equal(restored.T.getPage(),'overview');assert(!restored.el('content').innerHTML.includes('Your workspace data'));assert.equal(restored.el('dataManagementNav').hidden,true);});
 const admin=setup();admin.N.nav('data');
 check('Verified Admin / Management can see the section and its controls',()=>{assert.equal(admin.el('dataManagementNav').hidden,false);assert.equal(admin.T.getPage(),'data');for(const name of ['Data & backup','Download backup','Import backup','Recover browser records','Export current claim'])assert(admin.el('content').innerHTML.includes(name));});
 admin.N.exportBackup();admin.N.exportClaim();
 check('Admin exports retain the complete accessible workspace and current claim',()=>{const files=admin.T.downloads();assert.equal(files.length,2);assert.equal(JSON.parse(files[0].content).workspace.claims[0].payload.schedule[0].rate,fixture.schedule[0].rate);assert.equal(JSON.parse(files[1].content).claimRef,fixture.claimRef);});
 admin.N.importBackup();await admin.T.receiveBackup({text:async()=>JSON.stringify(backup)});
 check('Admin can select and preview a backup',()=>{assert.equal(admin.clicks(),1);assert(admin.el('dialog').innerHTML.includes('Import preview'));assert(admin.T.pendingImport());});
 admin.el('importRates').checked=true;admin.el('importContacts').checked=true;admin.N.commitImport();
 check('Admin can commit local backup copies, contacts and full-precision rates',()=>{assert.equal(admin.T.store().claims.length,2);assert.equal(admin.T.claim().claimRef,'IMPORTED-01');assert.equal(admin.T.active().remote,null);assert.equal(admin.T.getRates()[0].rate,12.345678);assert.equal(admin.T.store().contractors[0].email,'test@example.test');assert.equal(admin.T.pendingImport(),null);});
 const recovery=setup();recovery.saved.set('brstSharedScheduleRecords_v1',JSON.stringify([{payload:{...copy(fixture),claimRef:'RECOVER-ME'}}]));recovery.N.recoverLegacy();
 check('Admin browser-record recovery remains available',()=>assert(recovery.T.store().claims.some(r=>r.payload.claimRef==='RECOVER-ME')));
 const downgraded=setup();await downgraded.T.loadStaffAccess(true);downgraded.N.nav('data');await downgraded.T.receiveBackup({text:async()=>JSON.stringify(backup)});downgraded.downgrade();downgraded.N.commitImport();
 check('A live role downgrade hides the section, exits the page and cancels any import preview',()=>{assert.equal(downgraded.el('dataManagementNav').hidden,true);assert.equal(downgraded.T.getPage(),'overview');assert.equal(downgraded.T.pendingImport(),null);assert.equal(downgraded.el('dialog').open,false);assert.equal(downgraded.T.store().claims.length,1);});
 const failed=setup();await failed.T.loadStaffAccess(true);failed.N.nav('data');await failed.T.receiveBackup({text:async()=>JSON.stringify(backup)});failed.failRole();failed.N.commitImport();
 check('Role verification failure clears the backup preview and its contents',()=>{assert.equal(failed.T.getPage(),'overview');assert.equal(failed.el('dataManagementNav').hidden,true);assert.equal(failed.el('dialog').open,false);assert.equal(failed.el('dialog').innerHTML,'');assert.equal(failed.T.pendingImport(),null);assert.equal(failed.T.store().claims.length,1);});
 const delayed=setup();let finish;const pending=delayed.T.receiveBackup({text:()=>new Promise(resolve=>finish=resolve)});delayed.asStaff('surveyor');finish(JSON.stringify(backup));await pending;
 check('A backup read finishing after access is removed cannot open or stage an import',()=>{assert.equal(delayed.T.pendingImport(),null);assert.equal(delayed.el('dialog').open,false);});
 const switched=setup();let done;const previous=switched.T.receiveBackup({text:()=>new Promise(resolve=>done=resolve)});switched.T.setUser({uid:'different-admin',email:'other@tbrn.co.uk',emailVerified:true});switched.T.setStaffLevel('admin');done(JSON.stringify(backup));await previous;
 check('A pending import cannot cross into a different admin account',()=>assert.equal(switched.T.pendingImport(),null));
 const signedOut=setup();signedOut.N.nav('data');signedOut.T.setUser(null);signedOut.T.render();
 check('Signing out hides the Manage group immediately',()=>assert.equal(signedOut.el('dataManagementNav').hidden,true));
 for(const role of ['surveyor','concierge','contractor']){
  const report=setup(role);report.N.exportCSV();
  check(role+' retains the normal report CSV export for an accessible claim',()=>{assert.equal(report.T.downloads().length,1);assert(report.T.downloads()[0].name.endsWith('.csv'));});
 }
 console.log(JSON.stringify({passed:checks.length,checks,productionDataTouched:false},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});

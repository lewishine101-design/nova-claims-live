// Isolated Auth and Firestore doubles: no production password changes or real emails.
const assert=require('node:assert/strict');
const {start,fixture}=require('./schedule-versions.cjs');
const copy=value=>JSON.parse(JSON.stringify(value));
const hooks=`Object.assign(api.__check,{passwordResetButton,staffAccessView,contractorAccountRows,passwordRequirementsMessage,getPasswordDialog:()=>passwordDialog,getPasswordBusy:()=>passwordActionBusy,getUser:()=>user,setPage:value=>{page=value;},setAccounts:(staff,contractors)=>{staffAccounts=staff;contractorAccounts=contractors;contractorAccountsState='loaded';},setRestoring:value=>{restoringSession=value;}});`;
function setup(level='admin'){
 const e=start(fixture,hooks),calls=[],auth={currentUser:null},staff=[{id:'staff-target',email:'colleague@tbrn.co.uk',level:'surveyor'}],contractors=[{id:'contractor-target',email:'builder@example.test',contractorName:'Example Builder',hubEmail:'different-hub-contact@example.test'}];
 const state={role:'admin',roleEmail:'staff@tbrn.co.uk',profileEmail:null,missing:false,cached:false,pending:false,readError:null,readGate:null,resetError:null,resetGate:null,policyGate:null,reauthGate:null,reauthError:null,updateError:null,policy:{isValid:true}};
 const A={validatePassword:async(_auth,password)=>{calls.push({kind:'policy',password});if(state.policyGate)await state.policyGate;return state.policy;},EmailAuthProvider:{credential:(email,password)=>({email,password})},reauthenticateWithCredential:async(account,credential)=>{calls.push({kind:'reauth',account,credential});if(state.reauthGate)await state.reauthGate;if(state.reauthError)throw state.reauthError;return {user:account};},updatePassword:async(account,password)=>{calls.push({kind:'update',account,password});if(state.updateError)throw state.updateError;},sendPasswordResetEmail:async(...args)=>{calls.push({kind:'reset',args});if(state.resetGate)await state.resetGate;if(state.resetError)throw state.resetError;}};
 const F={doc:(_db,collection,id)=>({collection,id}),getDocFromServer:async ref=>{calls.push({kind:'read',ref});if(state.readGate)await state.readGate;if(state.readError)throw state.readError;return {exists:()=>ref.collection==='staffAccess'||!state.missing,metadata:{fromCache:state.cached,hasPendingWrites:state.pending},data:()=>ref.collection==='staffAccess'?{email:state.roleEmail,level:state.role}:{email:state.profileEmail??[...staff,...contractors].find(entry=>entry.id===ref.id)?.email}};}};
 e.T.setLive({A,F,auth,db:{}});
 function login(role=level){if(['admin','surveyor','concierge'].includes(role))e.asStaff(role);else if(role==='contractor')e.asContractor();else e.T.setUser(role==='unverified'?{uid:'unverified',email:'staff@tbrn.co.uk',emailVerified:false}:null);auth.currentUser=e.T.getUser();e.T.setAccounts(copy(staff),copy(contractors));}
 login();
 const openAdmin=(scope='staff')=>{e.T.setPage(scope==='staff'?'staff':'contractor-access');return e.N.adminPasswordResetDialog(scope,scope==='staff'?'staff-target':'contractor-target');};
 const fill=(old='Current-Secret-71',next='New-Secret-82',confirm=next)=>{e.el('currentAccountPassword').value=old;e.el('newAccountPassword').value=next;e.el('confirmAccountPassword').value=confirm;};
 return {...e,calls,auth,state,staff,contractors,login,openAdmin,fill,count:kind=>calls.filter(call=>call.kind===kind).length};
}
const checks=[];function check(name,fn){fn();checks.push(name);}
const tick=()=>new Promise(setImmediate);
(async()=>{
 for(const level of ['concierge','surveyor','contractor','unverified','signed-out']){
  const e=setup(level);assert.equal(e.openAdmin(),false);assert.equal(await e.N.sendAdminPasswordReset(),false);
  check(level+' cannot open or invoke another account reset',()=>{assert.equal(e.T.passwordResetButton(e.staff[0],'staff'),'');assert.equal(e.calls.length,0);});
 }
 const ui=setup();
 check('Admin staff and contractor rows expose account settings with registered account IDs',()=>{assert(ui.T.staffAccessView().includes('N.openAccountSettings'));assert(ui.T.contractorAccountRows().includes('N.openAccountSettings'));assert(ui.T.passwordResetButton({id:'id" onclick="bad',email:'test@example.test'},'contractor').includes('&quot;'));});
 ui.N.account();check('A signed-in account menu offers Change password',()=>assert(ui.el('dialog').innerHTML.includes('N.changePasswordDialog')));
 assert.equal(ui.openAdmin('contractor'),true);
 check('Opening an admin reset displays the sign-in email and sends nothing yet',()=>{assert(ui.el('dialog').innerHTML.includes('builder@example.test'));assert(!ui.el('dialog').innerHTML.includes('different-hub-contact@example.test'));assert.equal(ui.count('reset'),0);});
 assert.equal(await ui.N.sendAdminPasswordReset(),true);
 check('Sending verifies the admin role and exact registered profile, and uses the default Firebase reset handler',()=>{assert.equal(ui.count('read'),2);const reset=ui.calls.find(call=>call.kind==='reset');assert.equal(reset.args[0],ui.auth);assert.equal(reset.args[1],'builder@example.test');assert.equal(reset.args.length,2);assert(ui.calls.some(call=>call.kind==='read'&&call.ref.id==='contractor-target'));assert.equal(ui.auth.currentUser,ui.T.getUser());assert.equal(ui.count('update'),0);assert(ui.el('passwordActionMessage').textContent.includes('not email delivery'));});
 await ui.N.sendAdminPasswordReset();ui.N.close();ui.openAdmin('contractor');await ui.N.sendAdminPasswordReset();
 check('Repeated reset submissions and immediate reopening do not send duplicates',()=>assert.equal(ui.count('reset'),1));
 const staff=setup();staff.openAdmin();assert.equal(await staff.N.sendAdminPasswordReset(),true);
 check('Staff reset targets the chosen staff email',()=>assert.equal(staff.calls.find(call=>call.kind==='reset').args[1],'colleague@tbrn.co.uk'));
 for(const [name,values] of [['changed email',{profileEmail:'changed@example.test'}],['missing profile',{missing:true}],['cached reads',{cached:true}],['pending writes',{pending:true}],['revoked admin role',{role:'surveyor'}],['mismatched role identity',{roleEmail:'someoneelse@tbrn.co.uk'}]]){
  const e=setup();e.openAdmin();Object.assign(e.state,values);assert.equal(await e.N.sendAdminPasswordReset(),false);
  check(name+' prevents the admin reset',()=>{assert.equal(e.count('reset'),0);assert(e.el('passwordActionMessage').textContent);});
 }
 const arbitrary=setup();arbitrary.T.setPage('staff');assert.equal(arbitrary.N.adminPasswordResetDialog('staff','not-registered'),false);assert.equal(arbitrary.N.adminPasswordResetDialog('other','staff-target'),false);
 check('Reset dialogs cannot target arbitrary emails or unsupported account lists',()=>assert.equal(arbitrary.calls.length,0));
 const reordered=setup();reordered.openAdmin();reordered.T.setAccounts([{id:'different',email:'other@tbrn.co.uk'}],[]);await reordered.N.sendAdminPasswordReset();
 check('Refreshing or reordering the list cannot change the confirmed reset recipient',()=>assert.equal(reordered.calls.find(call=>call.kind==='reset').args[1],'colleague@tbrn.co.uk'));
 const cancelled=setup();cancelled.openAdmin();let release;cancelled.state.readGate=new Promise(resolve=>release=resolve);const pending=cancelled.N.sendAdminPasswordReset();cancelled.N.close();release();await pending;
 check('Closing a pending confirmation cancels it before an email is requested',()=>{assert.equal(cancelled.count('reset'),0);assert.equal(cancelled.T.getPasswordDialog(),null);});
 const switched=setup();switched.openAdmin();let releaseSwitch;switched.state.readGate=new Promise(resolve=>releaseSwitch=resolve);const switchPending=switched.N.sendAdminPasswordReset();switched.login('contractor');releaseSwitch();await switchPending;
 check('Changing accounts invalidates an in-flight admin reset',()=>{assert.equal(switched.count('reset'),0);assert.equal(switched.T.getPasswordDialog(),null);assert.equal(switched.el('dialog').open,false);});
 const duplicate=setup();duplicate.openAdmin();let releaseDuplicate;duplicate.state.resetGate=new Promise(resolve=>releaseDuplicate=resolve);const first=duplicate.N.sendAdminPasswordReset();await tick();assert.equal(await duplicate.N.sendAdminPasswordReset(),false);releaseDuplicate();await first;
 check('Repeated clicks while sending issue only one reset request',()=>assert.equal(duplicate.count('reset'),1));
 const error=setup();error.openAdmin();error.state.resetError={code:'auth/network-request-failed',message:'Do not expose this raw detail'};assert.equal(await error.N.sendAdminPasswordReset(),false);
 check('Reset failures allow retry without claiming success or exposing raw errors',()=>{assert.equal(error.el('adminPasswordResetButton').disabled,false);assert(!error.el('passwordActionMessage').textContent.includes('Do not expose'));assert(!error.el('passwordActionMessage').textContent.includes('accepted'));});error.state.resetError=null;assert.equal(await error.N.sendAdminPasswordReset(),true);
 const limited=setup();limited.openAdmin();limited.state.resetError={code:'auth/too-many-requests'};await limited.N.sendAdminPasswordReset();await limited.N.sendAdminPasswordReset();
 check('Firebase throttling adds a retry delay',()=>assert.equal(limited.count('reset'),1));
 for(const level of ['admin','surveyor','concierge','contractor']){
  const e=setup(level),before=copy(e.T.store());assert.equal(e.N.changePasswordDialog(),true);e.fill();assert.equal(await e.N.changeAccountPassword(),true);
  check(level+' can change only their own password after reauthentication',()=>{assert.equal(e.count('reauth'),1);assert.equal(e.count('update'),1);const update=e.calls.find(call=>call.kind==='update');assert.equal(update.account,e.T.getUser());assert.equal(update.password,'New-Secret-82');assert.deepEqual(copy(e.T.store()),before);assert.equal(e.T.getPasswordDialog(),null);assert.equal(e.el('newAccountPassword').value,'');assert.equal(e.count('reset'),0);assert(![...e.saved.values()].join('').includes('Secret-'));});
 }
 for(const level of ['unverified','signed-out']){const e=setup(level);assert.equal(e.N.changePasswordDialog(),false);assert.equal(await e.N.changeAccountPassword(),false);check(level+' cannot invoke an in-app password change',()=>assert.equal(e.calls.length,0));}
 for(const [name,args] of [['empty fields',['','','']],['mismatched confirmation',['old-pass','new-pass','other-pass']],['unchanged password',['same-pass','same-pass','same-pass']]]){const e=setup();e.N.changePasswordDialog();e.fill(...args);assert.equal(await e.N.changeAccountPassword(),false);check(name+' stops before an Auth call',()=>assert.equal(e.calls.length,0));}
 const policy=setup();policy.N.changePasswordDialog();policy.fill();policy.state.policy={isValid:false,meetsMinPasswordLength:false,containsNumericCharacter:false,passwordPolicy:{customStrengthOptions:{minPasswordLength:12}}};assert.equal(await policy.N.changeAccountPassword(),false);
 check('Project password policy is checked and unmet requirements are explained',()=>{assert.equal(policy.count('reauth'),0);assert.equal(policy.count('update'),0);assert(policy.el('passwordActionMessage').textContent.includes('at least 12 characters'));assert(policy.el('passwordActionMessage').textContent.includes('a number'));assert.equal(policy.el('newAccountPassword').value,'');});
 const wrong=setup();wrong.N.changePasswordDialog();wrong.fill();wrong.state.reauthError={code:'auth/invalid-credential',message:'Current-Secret-71'};assert.equal(await wrong.N.changeAccountPassword(),false);
 check('An incorrect current password never reaches updatePassword and credentials are cleared',()=>{assert.equal(wrong.count('update'),0);assert.equal(wrong.el('currentAccountPassword').value,'');assert.equal(wrong.el('newAccountPassword').value,'');assert(!wrong.el('passwordActionMessage').textContent.includes('Current-Secret'));assert.equal(wrong.el('changeAccountPasswordButton').disabled,false);});
 const spaces=setup();spaces.N.changePasswordDialog();spaces.fill('  current pass  ','  new pass  ');await spaces.N.changeAccountPassword();
 check('Password whitespace is preserved, not trimmed',()=>{assert.equal(spaces.calls.find(call=>call.kind==='reauth').credential.password,'  current pass  ');assert.equal(spaces.calls.find(call=>call.kind==='update').password,'  new pass  ');});
 const changing=setup();changing.N.changePasswordDialog();changing.fill();let reauthRelease;changing.state.reauthGate=new Promise(resolve=>reauthRelease=resolve);const changePending=changing.N.changeAccountPassword();await tick();assert.equal(await changing.N.changeAccountPassword(),false);reauthRelease();await changePending;
 check('Repeated change-password submissions perform one update',()=>{assert.equal(changing.count('reauth'),1);assert.equal(changing.count('update'),1);});
 for(const [name,interrupt] of [['closing the dialog',e=>e.N.close()],['account switch',e=>e.login('contractor')],['opening another dialog',e=>e.N.account()],['navigation',e=>e.N.nav('details')]]){
  const e=setup();e.N.changePasswordDialog();e.fill();let done;e.state.reauthGate=new Promise(resolve=>done=resolve);const promise=e.N.changeAccountPassword();await tick();interrupt(e);done();await promise;
  check(name+' after reauthentication starts prevents a subsequent password update',()=>{assert.equal(e.count('update'),0);assert.equal(e.el('currentAccountPassword').value,'');assert.equal(e.el('newAccountPassword').value,'');assert.equal(e.T.getPasswordBusy(),false);});
 }
 const staleAuth=setup();staleAuth.N.changePasswordDialog();staleAuth.fill();staleAuth.auth.currentUser={...staleAuth.T.getUser()};assert.equal(await staleAuth.N.changeAccountPassword(),false);
 check('An Auth session mismatch prevents use of stale credentials',()=>assert.equal(staleAuth.calls.length,0));
 const updateError=setup();updateError.N.changePasswordDialog();updateError.fill();updateError.state.updateError={code:'auth/requires-recent-login'};assert.equal(await updateError.N.changeAccountPassword(),false);
 check('An unsuccessful password update never displays a success message',()=>{assert(updateError.el('passwordActionMessage').textContent.includes('sign-in needs refreshing'));assert(!updateError.messages.some(message=>message.includes('password has been changed')));});
 console.log(JSON.stringify({passed:checks.length,checks,productionDataTouched:false,realEmailsSent:false},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});

// Local Firebase Auth emulator only. The UI's Firestore role/profile reads are isolated doubles.
const assert=require('node:assert/strict');
const {initializeApp,deleteApp}=require('firebase/app'),A=require('firebase/auth');
const {start,fixture}=require('./schedule-versions.cjs');
const projectId='demo-tbrn-password-tools',host=process.env.FIREBASE_AUTH_EMULATOR_HOST;
assert.equal(host,'127.0.0.1:9098','Refusing to use any non-local Auth service');
const apps=[];
function makeAuth(name){const app=initializeApp({apiKey:'fake-api-key',projectId,authDomain:projectId+'.firebaseapp.com'},name);apps.push(app);const auth=A.initializeAuth(app,{persistence:A.inMemoryPersistence});A.connectAuthEmulator(auth,'http://'+host,{disableWarnings:true});return auth;}
async function oob(){const response=await fetch('http://'+host+'/emulator/v1/projects/'+projectId+'/oobCodes');assert.equal(response.status,200);return (await response.json()).oobCodes||[];}
async function createVerified(auth,email,password){await A.createUserWithEmailAndPassword(auth,email,password);await A.sendEmailVerification(auth.currentUser);const code=(await oob()).filter(value=>value.email===email&&value.requestType==='VERIFY_EMAIL').at(-1);assert(code);await A.applyActionCode(auth,code.oobCode);await A.reload(auth.currentUser);assert(auth.currentUser.emailVerified);return auth.currentUser;}
const checks=[];
(async()=>{
 const staffAuth=makeAuth('password-tools-admin'),builderAuth=makeAuth('password-tools-builder'),probeAuth=makeAuth('password-tools-probe');
 const admin=await createVerified(staffAuth,'password-tools-admin@tbrn.co.uk','Start-Admin-Secret-01'),builder=await createVerified(builderAuth,'password-tools-builder@example.test','Start-Builder-Secret-02');
 const e=start(fixture,`Object.assign(api.__check,{setPage:value=>{page=value;},setContractors:entries=>{contractorAccounts=entries;contractorAccountsState='loaded';}});`);
 // Auth emulator 13 does not implement getPasswordPolicy. Policy outcomes are covered in password-tools.cjs.
 const checkedAuth={...A,validatePassword:async()=>({isValid:true})};
 e.T.setUser(builder);e.T.setLive({A:checkedAuth,auth:builderAuth});e.N.changePasswordDialog();
 const fill=(current,next)=>{e.el('currentAccountPassword').value=current;e.el('newAccountPassword').value=next;e.el('confirmAccountPassword').value=next;};
 fill('Wrong-Current-Secret','Changed-Builder-Secret-03');assert.equal(await e.N.changeAccountPassword(),false);checks.push('Real Auth rejects the wrong current password');
 fill('Start-Builder-Secret-02','Changed-Builder-Secret-03');assert.equal(await e.N.changeAccountPassword(),true);
 await assert.rejects(()=>A.signInWithEmailAndPassword(probeAuth,builder.email,'Start-Builder-Secret-02'));await A.signInWithEmailAndPassword(probeAuth,builder.email,'Changed-Builder-Secret-03');checks.push('In-app change updates the real emulator account and invalidates the old password');
 e.T.setUser(admin);e.T.setStaffLevel('admin');e.T.setPage('contractor-access');e.T.setContractors([{id:builder.uid,email:builder.email,contractorName:'Synthetic contractor'}]);
 const F={doc:(_db,collection,id)=>({collection,id}),getDocFromServer:async ref=>({exists:()=>true,metadata:{fromCache:false,hasPendingWrites:false},data:()=>ref.collection==='staffAccess'?{email:admin.email,level:'admin'}:{email:builder.email}})};
 e.T.setLive({A,F,auth:staffAuth,db:{}});assert.equal(e.N.adminPasswordResetDialog('contractor',builder.uid),true);assert.equal(await e.N.sendAdminPasswordReset(),true);
 const resetCodes=(await oob()).filter(value=>value.requestType==='PASSWORD_RESET');assert.equal(resetCodes.length,1);assert.equal(resetCodes[0].email,builder.email);checks.push('Admin reset creates exactly one reset action for the chosen registered user');
 assert.equal(staffAuth.currentUser.uid,admin.uid);assert.equal(e.el('adminPasswordResetButton').disabled,true);checks.push('Admin reset preserves the admin session and prevents duplicate requests');
 await A.confirmPasswordReset(probeAuth,resetCodes[0].oobCode,'Reset-Builder-Secret-04');await A.signInWithEmailAndPassword(probeAuth,builder.email,'Reset-Builder-Secret-04');await assert.rejects(()=>A.signInWithEmailAndPassword(probeAuth,builder.email,'Changed-Builder-Secret-03'));checks.push('The reset action accepts a new password and replaces the previous password');
 console.log(JSON.stringify({passed:checks.length,checks,projectId,passwordPolicy:'Stubbed because getPasswordPolicy is not implemented by the Auth emulator; policy validation is covered by the application checks.',productionDataTouched:false,realEmailsSent:false},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{for(const app of apps)await deleteApp(app);});

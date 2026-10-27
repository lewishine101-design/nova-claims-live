'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createPasswordService}=require('../service');
class HttpsError extends Error{constructor(code,message,details){super(message);this.code=code;this.details=details;}}
function fixture(){
 const time=1800000000000,docs=new Map([['staffAccess/admin',{email:'admin@tbrn.co.uk',level:'admin'}],['users/target',{email:'builder@example.test'}]]),calls=[],logs=[];
 const users=new Map([['admin',{uid:'admin',email:'admin@tbrn.co.uk',emailVerified:true,providerData:[{providerId:'password'}]}],['target',{uid:'target',email:'builder@example.test',emailVerified:true,providerData:[{providerId:'password'}]}]]);
 const state={token:{uid:'admin',auth_time:time/1000},constraints:{},clock:time};
 const snapshot=path=>({exists:docs.has(path),data:()=>structuredClone(docs.get(path))});
 const doc=path=>({path,get:async()=>snapshot(path),update:async value=>{if(state.auditError)throw Error('Audit offline');docs.set(path,{...docs.get(path),...structuredClone(value)});}});
 const db={doc,runTransaction:async fn=>{
  if(state.reserveError)throw Error('Transaction unavailable');
  const writes=[],result=await fn({get:async ref=>snapshot(ref.path),set:(ref,value)=>writes.push([ref.path,structuredClone(value)])});
  for(const [path,value] of writes)docs.set(path,value);return result;
 }};
 const auth={
  verifyIdToken:async(token,revoked)=>{calls.push(['verify',revoked]);if(state.revoked)throw Error('Revoked');return state.token;},
  getUser:async uid=>{if(!users.has(uid))throw {code:'auth/user-not-found'};return structuredClone(users.get(uid));},
  projectConfigManager:()=>({getProjectConfig:async()=>{if(state.policyError)throw Error('Config unavailable');return {passwordPolicyConfig:{constraints:state.constraints}};}}),
  updateUser:async(uid,changes)=>{calls.push(['update',uid,changes]);if(state.updateError)throw Error('Sensitive SDK detail '+changes.password);users.set(uid,{...users.get(uid),...changes});},
  revokeRefreshTokens:async uid=>{calls.push(['revoke',uid]);if(state.revokeError)throw Error('Revocation failed');}
 };
 const service=createPasswordService({auth,db,HttpsError,now:()=>state.clock,log:(...args)=>logs.push(args)});
 const request={auth:{uid:'admin'},rawRequest:{headers:{authorization:'Bearer synthetic-token'}},data:{action:'setPassword',targetUid:'target',expectedEmail:'builder@example.test',newPassword:'  New-test-password-71  ',requestId:'12345678-1234-4321-8123-123456789012'}};
 return {state,docs,calls,users,logs,service,request,changed:()=>calls.filter(call=>call[0]==='update').length};
}
const denies=async(e,code,reason)=>{await assert.rejects(()=>e.service(e.request),error=>error.code===code&&(!reason||error.details.reason===reason));assert.equal(e.changed(),0);};

test('status checks identity, target, and policy without altering credentials',async()=>{const e=fixture();e.request.data.action='status';const result=await e.service(e.request);assert.equal(result.ready,true);assert.equal(result.minLength,12);assert.equal(e.changed(),0);assert.equal(e.docs.size,2);assert(e.calls.every(call=>call[0]!=='verify'||call[1]===true));});
test('direct set updates only the selected password; audit contains no secret',async()=>{const e=fixture(),actor=structuredClone(e.users.get('admin')),profile=structuredClone(e.docs.get('users/target'));const result=await e.service(e.request);assert.equal(result.changed,true);assert.equal(result.sessionsRevoked,true);assert.equal(result.auditRecorded,true);assert.equal(e.users.get('target').password,e.request.data.newPassword);assert.deepEqual(e.users.get('admin'),actor);assert.deepEqual(e.docs.get('users/target'),profile);assert.deepEqual(Object.keys(e.calls.find(call=>call[0]==='update')[2]),['password']);assert(!JSON.stringify([...e.docs]).includes(e.request.data.newPassword));assert(!JSON.stringify(e.logs).includes(e.request.data.newPassword));assert.equal(e.docs.get('adminAccountActions/'+e.request.data.requestId).status,'completed');});
test('no authenticated identity is denied',async()=>{const e=fixture();delete e.request.auth;await denies(e,'unauthenticated');});
test('revoked tokens are denied even when callable supplies request.auth',async()=>{const e=fixture();e.state.revoked=true;await denies(e,'unauthenticated');});
test('token identity must match callable identity',async()=>{const e=fixture();e.request.auth.uid='target';await denies(e,'permission-denied');});
for(const [name,modify] of [
 ['missing role',e=>e.docs.delete('staffAccess/admin')],
 ['concierge role',e=>e.docs.get('staffAccess/admin').level='concierge'],
 ['surveyor role',e=>e.docs.get('staffAccess/admin').level='surveyor'],
 ['role email mismatch',e=>e.docs.get('staffAccess/admin').email='other@tbrn.co.uk'],
 ['unverified staff',e=>e.users.get('admin').emailVerified=false],
 ['disabled admin',e=>e.users.get('admin').disabled=true],
 ['non-TBRN admin',e=>{e.users.get('admin').email='admin@elsewhere.test';e.docs.get('staffAccess/admin').email='admin@elsewhere.test';}]
])test(name+' cannot set a password',async()=>{const e=fixture();modify(e);e.request.data.level='admin';await denies(e,'permission-denied');});
test('expired reauthentication is denied before any write',async()=>{const e=fixture();e.state.token.auth_time-=301;await denies(e,'failed-precondition','recent-login');assert.equal(e.docs.size,2);});
test('future or missing auth_time cannot pass recent-login check',async()=>{for(const value of [undefined,eFuture()]){const e=fixture();e.state.token.auth_time=value;await denies(e,'failed-precondition','recent-login');}function eFuture(){return fixture().state.clock/1000+100;}});
for(const [name,modify] of [
 ['unknown UID',e=>e.users.delete('target')],
 ['missing profile',e=>e.docs.delete('users/target')],
 ['profile email mismatch',e=>e.docs.get('users/target').email='changed@example.test'],
 ['Auth email mismatch',e=>e.users.get('target').email='changed@example.test'],
 ['disabled account',e=>e.users.get('target').disabled=true],
 ['federated-only account',e=>e.users.get('target').providerData=[{providerId:'google.com'}]],
 ['own account',e=>e.request.data.targetUid='admin']
])test(name+' cannot be changed via an admin target request',async()=>{const e=fixture();modify(e);await denies(e,'failed-precondition');});
test('UID path injection and invalid request IDs are rejected',async()=>{const e=fixture();e.request.data.targetUid='x/y';await denies(e,'invalid-argument');const f=fixture();f.request.data.requestId='../bad';await denies(f,'invalid-argument');});
test('policy cannot be bypassed by calling the service directly',async()=>{for(const password of ['short','onlylowercase','UPPERCASEONLY','UpperLowerOnly','UpperLower123','UpperLower123!'+'x'.repeat(100)]){const e=fixture();e.state.constraints={minLength:14,maxLength:50,requireUppercase:true,requireLowercase:true,requireNumeric:true,requireNonAlphanumeric:true};e.request.data.newPassword=password;await denies(e,'invalid-argument','password-policy');}});
test('server enforces project length and character rules on a valid value',async()=>{const e=fixture();e.request.data.newPassword='Long-valid-password-71!';e.state.constraints={minLength:20,maxLength:50,requireUppercase:true,requireLowercase:true,requireNumeric:true,requireNonAlphanumeric:true};assert.equal((await e.service(e.request)).changed,true);});
test('spaces, hyphens, equals, plus and backticks do not bypass Firebase special-character policy',async()=>{for(const password of ['LongPassword123 ','LongPassword123-','LongPassword123=','LongPassword123+','LongPassword123`']){const e=fixture();e.state.constraints={requireNonAlphanumeric:true};e.request.data.newPassword=password;await denies(e,'invalid-argument','password-policy');}});
test('missing policy service fails closed',async()=>{const e=fixture();e.state.policyError=true;await denies(e,'unavailable');});
test('audit reservation failure prevents password mutation',async()=>{const e=fixture();e.state.reserveError=true;await denies(e,'unavailable');});
test('a repeated request returns the receipt without a second mutation',async()=>{const e=fixture();const first=await e.service(e.request);assert.deepEqual(await e.service(e.request),first);assert.equal(e.changed(),1);});
test('another request cannot immediately overwrite the same account password',async()=>{const e=fixture();await e.service(e.request);e.request.data.requestId='22345678-1234-4321-8123-123456789012';await assert.rejects(()=>e.service(e.request),error=>error.code==='resource-exhausted');assert.equal(e.changed(),1);});
test('lost admin access between reservation and mutation prevents update',async()=>{const e=fixture(),original=e.service;let verifies=0;const authDb=e.docs; // Swap protected state on the second role read through token verification.
 const request=structuredClone(e.request);Object.defineProperty(request.rawRequest.headers,'authorization',{get(){verifies++;if(verifies===2)authDb.get('staffAccess/admin').level='concierge';return 'Bearer synthetic-token';}});
 await assert.rejects(()=>original(request),error=>error.code==='permission-denied');assert.equal(e.changed(),0);});
test('uncertain Auth failure never becomes a false success or leaks raw SDK text',async()=>{const e=fixture();e.state.updateError=true;await assert.rejects(()=>e.service(e.request),error=>error.code==='unavailable'&&error.details.reason==='not-confirmed'&&!error.message.includes('Sensitive'));assert.equal(e.docs.get('adminAccountActions/'+e.request.data.requestId).status,'not-confirmed');await assert.rejects(()=>e.service(e.request),error=>error.code==='aborted');assert.equal(e.changed(),1);});
test('revocation failure honestly reports that the password was changed',async()=>{const e=fixture();e.state.revokeError=true;const result=await e.service(e.request);assert.equal(result.changed,true);assert.equal(result.sessionsRevoked,false);assert.equal(e.logs.length,1);});
test('audit completion failure honestly reports changed status and a safe log',async()=>{const e=fixture();e.state.auditError=true;const result=await e.service(e.request);assert.equal(result.changed,true);assert.equal(result.auditRecorded,false);assert(!JSON.stringify(e.logs).includes(e.request.data.newPassword));});
test('request receipt cannot be stolen by another authorized admin',async()=>{const e=fixture();await e.service(e.request);e.users.set('other',{...e.users.get('admin'),uid:'other',email:'other@tbrn.co.uk'});e.docs.set('staffAccess/other',{email:'other@tbrn.co.uk',level:'admin'});e.state.token.uid='other';e.request.auth.uid='other';await assert.rejects(()=>e.service(e.request),error=>error.code==='permission-denied');assert.equal(e.changed(),1);});

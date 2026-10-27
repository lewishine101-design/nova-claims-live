'use strict';

const {createHash}=require('node:crypto');
const normalise=value=>typeof value==='string'?value.trim().toLowerCase():'';
const validUid=value=>typeof value==='string'&&value.length>0&&value.length<=128&&!value.includes('/');

// All authorization is performed here, independently of the account menu.
// Injected dependencies allow isolated tests without production Auth or Firestore.
function createPasswordService({auth,db,HttpsError,now=()=>Date.now(),log=()=>{}}){
 const fail=(code,reason,message)=>{throw new HttpsError(code,message,{reason});};
 async function authorize(request,recent=false){
  if(!request.auth?.uid)fail('unauthenticated','sign-in','Sign in again.');
  const bearer=request.rawRequest?.headers?.authorization;
  if(typeof bearer!=='string'||!bearer.startsWith('Bearer '))fail('unauthenticated','sign-in','Sign in again.');
  let token,actor;
  try{token=await auth.verifyIdToken(bearer.slice(7),true);actor=await auth.getUser(token.uid);}catch{fail('unauthenticated','sign-in','Sign in again.');}
  const email=normalise(actor.email);
  if(token.uid!==request.auth.uid||actor.disabled||!actor.emailVerified||!email.endsWith('@tbrn.co.uk')||!email.split('@')[0]||email.split('@').length!==2)fail('permission-denied','admin-access','TBRN admin access is required.');
  const role=await db.doc('staffAccess/'+actor.uid).get();
  if(!role.exists||role.data().level!=='admin'||normalise(role.data().email)!==email)fail('permission-denied','admin-access','TBRN admin access is required.');
  const age=Math.floor(now()/1000)-Number(token.auth_time);
  if(recent&&(!Number.isFinite(age)||age< -30||age>300))fail('failed-precondition','recent-login','Confirm your own password again.');
  return actor;
 }
 async function targetAccount(data,actor){
  if(!validUid(data.targetUid)||!normalise(data.expectedEmail))fail('invalid-argument','target','Select a registered account.');
  if(data.targetUid===actor.uid)fail('failed-precondition','own-account','Use Change my password for your own account.');
  let target;
  try{target=await auth.getUser(data.targetUid);}catch(error){if(error.code==='auth/user-not-found')fail('failed-precondition','account-changed','The selected account is unavailable.');throw error;}
  const profile=await db.doc('users/'+data.targetUid).get(),email=normalise(target.email);
  if(target.disabled||!profile.exists||email!==normalise(data.expectedEmail)||normalise(profile.data().email)!==email)fail('failed-precondition','account-changed','The registered account has changed or is unavailable.');
  if(!target.providerData?.some(provider=>provider.providerId==='password'))fail('failed-precondition','provider','This account does not use a password sign-in.');
  return {uid:target.uid,email};
 }
 async function policy(){
  // A failed policy lookup must not silently weaken the configured requirements.
  const config=await auth.projectConfigManager().getProjectConfig();
  return config.passwordPolicyConfig?.constraints||{};
 }
 function checkPassword(value,constraints){
  const minLength=Math.max(12,constraints.minLength||6),maxLength=Math.min(4096,constraints.maxLength||4096);
  // Firebase's documented non-alphanumeric set excludes spaces, hyphens and plus signs.
  // https://firebase.google.com/docs/auth/web/password-auth#recommended_set_a_password_policy
  const specials='^$*.[]{}()?"!@#%&/\\,><\':;|_~';
  const valid=typeof value==='string'&&value.length>=minLength&&value.length<=maxLength&&(!constraints.requireUppercase||/[A-Z]/.test(value))&&(!constraints.requireLowercase||/[a-z]/.test(value))&&(!constraints.requireNumeric||/[0-9]/.test(value))&&(!constraints.requireNonAlphanumeric||[...value].some(char=>specials.includes(char)));
  if(!valid)fail('invalid-argument','password-policy','Choose a password of at least '+minLength+' characters that meets the account password policy.');
 }
 async function handler(request){
  const data=request.data;
  if(!data||typeof data!=='object'||!['status','setPassword'].includes(data.action))fail('invalid-argument','action','Unsupported account action.');
  const actor=await authorize(request,data.action==='setPassword'),target=await targetAccount(data,actor);
  const constraints=await policy();
  if(data.action==='status')return {ready:true,targetUid:target.uid,email:target.email,minLength:Math.max(12,constraints.minLength||6)};
  checkPassword(data.newPassword,constraints);
  if(typeof data.requestId!=='string'||!/^[-a-zA-Z0-9]{20,80}$/.test(data.requestId))fail('invalid-argument','request','A new password request is required.');
  const audit=db.doc('adminAccountActions/'+data.requestId),lock=db.doc('adminAccountLocks/'+createHash('sha256').update(target.uid).digest('hex'));
  const prior=await db.runTransaction(async tx=>{
   const [receipt,busy]=await Promise.all([tx.get(audit),tx.get(lock)]);
   if(receipt.exists){
    const value=receipt.data();
    if(value.actorUid!==actor.uid||value.targetUid!==target.uid)fail('permission-denied','request','This request cannot be reused.');
    if(value.status==='completed')return value.result;
    fail('aborted','not-confirmed','This request has already started. Check the account before trying again.');
   }
   if(busy.exists&&busy.data().until>now())fail('resource-exhausted','busy','A password change for this account was requested recently. Wait two minutes before trying again.');
   tx.set(audit,{action:'setPassword',actorUid:actor.uid,targetUid:target.uid,status:'started',createdAtMs:now()});
   tx.set(lock,{requestId:data.requestId,until:now()+120000});return null;
  });
  if(prior)return prior;
  let changed=false;
  try{
   // Recheck role and target immediately before the privileged Auth mutation.
   await authorize(request,true);await targetAccount(data,actor);
   await auth.updateUser(target.uid,{password:data.newPassword});changed=true;
  }catch(error){
   await audit.update({status:'not-confirmed',finishedAtMs:now()}).catch(()=>{});
   if(error instanceof HttpsError)throw error;
   fail('unavailable','not-confirmed','The password change could not be confirmed. Check the account before trying again.');
  }
  let sessionsRevoked=false;
  try{await auth.revokeRefreshTokens(target.uid);sessionsRevoked=true;}catch{log('session-revocation-pending',{actorUid:actor.uid,targetUid:target.uid,requestId:data.requestId});}
  const result={changed,targetUid:target.uid,email:target.email,sessionsRevoked,auditRecorded:true};
  try{
   // Retain the two-minute lock as a small per-account cooldown, even on success.
   await audit.update({status:'completed',finishedAtMs:now(),result});
  }catch{result.auditRecorded=false;log('audit-completion-pending',{actorUid:actor.uid,targetUid:target.uid,requestId:data.requestId});}
  return result;
 }
 return async request=>{
  try{return await handler(request);}catch(error){
   if(error instanceof HttpsError)throw error;
   // No raw request, token, password, or SDK error is ever logged or returned.
   throw new HttpsError('unavailable','The account service could not confirm the request. Please try again later.',{reason:'service-unavailable'});
  }
 };
}
module.exports={createPasswordService};

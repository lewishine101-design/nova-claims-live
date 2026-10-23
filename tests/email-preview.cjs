// Run: node tests/email-preview.cjs [path/to/index.html]
// Clipboard and mail-app launch are mocked; no real email is sent or opened.
const assert=require('node:assert/strict');
const {start,fixture}=require('./schedule-versions.cjs');
const hooks=`Object.assign(api.__check,{emailDialog,emailMessageForSending,getEmail:()=>pendingEmail,portalLink,setLocation:href=>{location.href=href;},setClipboard:fn=>{navigator.clipboard={writeText:fn};},mockMail:fn=>{document.createElement=()=>({href:'',click(){fn(this.href);}});}});`;
const checks=[];function check(name,fn){fn();checks.push(name);}
(async()=>{
 const e=start(fixture,hooks);e.asStaff();e.T.setLocation('https://portal.example.test/scheduling/index.html?view=claims');e.N.assignmentEmail();
 const original=e.T.getEmail(),link=original.claimLink,label='[Open claim in Nova Scheduling]';
 check('Assignment email preview shows a labelled claim link without the hosting address',()=>{assert(link.startsWith('https://portal.example.test/'));assert(e.el('dialog').innerHTML.includes(label));assert(!e.el('dialog').innerHTML.includes('portal.example.test'));assert(e.el('dialog').innerHTML.includes('TEST-SOURCE'));});
 e.el('emailBody').value=original.body.split(link).join(label)+'\nAdditional instructions.';
 let copied='';e.T.setClipboard(async text=>{copied=text;});await e.N.copyEmail();
 check('Copy resolves the original working link and preserves edits without exposing it in the preview',()=>{assert(copied.includes(link));assert(copied.endsWith('Additional instructions.'));assert(!copied.includes(label));assert(!e.el('emailBody').value.includes('portal.example.test'));});
 const mail=[];e.T.mockMail(href=>mail.push(href));e.el('emailTo').value='builder@example.test';e.el('emailSubject').value='Schedule approval';e.N.openEmail();const opened=new URL(mail[0]);
 check('Open email app includes a working claim URL and retains subject, recipient and message edits',()=>{assert.equal(opened.protocol,'mailto:');assert.equal(opened.pathname,'builder@example.test');assert.equal(opened.searchParams.get('subject'),'Schedule approval');assert.equal(opened.searchParams.get('body'),copied);});
 e.el('emailTo').value='invalid';e.N.openEmail();check('Invalid recipients cannot launch the mail app',()=>assert.equal(mail.length,1));
 e.T.claim().claimRef='ANOTHER-CLAIM';
 check('A draft keeps its original claim link if another claim becomes active',()=>assert(e.T.emailMessageForSending().includes(link)));
 e.T.setClipboard(async()=>{throw Error('Clipboard blocked');});await e.N.copyEmail();
 check('Blocked clipboard offers the mail-app fallback without claiming a successful copy',()=>assert(e.messages.at(-1).includes('Copy unavailable. Use Open email app')));
 e.T.emailDialog({to:'builder@example.test',subject:'Plain draft',body:'No claim link is needed.'});e.el('emailBody').value='Edited plain draft.';
 check('Emails without a claim link remain ordinary editable messages',()=>{assert.equal(e.T.getEmail().claimLink,'');assert.equal(e.T.emailMessageForSending(),'Edited plain draft.');});
 e.T.setLocation('file:///tmp/scheduling.html');e.N.assignmentEmail();
 check('Downloaded copies use claim-reference instructions without injecting a stale hosted link',()=>{assert.equal(e.T.getEmail().claimLink,'');assert(e.el('dialog').innerHTML.includes('open claim reference: ANOTHER-CLAIM'));assert(!e.el('dialog').innerHTML.includes(label));});
 console.log(JSON.stringify({passed:checks.length,checks,realEmailsSent:false},null,2));
})().catch(error=>{console.error(error);process.exit(1);});

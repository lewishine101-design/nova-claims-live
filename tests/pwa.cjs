// Run: node tests/pwa.cjs [path/to/index.html]
// Isolated worker/network mocks and existing app harness; no production account or claim writes.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {start,fixture}=require('./schedule-versions.cjs');
const file=path.resolve(process.argv[2]||path.join(__dirname,'../index.html'));
const html=fs.readFileSync(file,'utf8'),root=path.dirname(file);
const scripts=[...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
const app=scripts.find(m=>!m[1].trim())[2];
const shell=app.slice(app.indexOf(' // Standalone app support,'),app.indexOf(' function modal('));
const checks=[];function check(name,fn){fn();checks.push(name);}
function setup(options={}){
 const registrations=[],navigator={};
 if(!options.noWorker)navigator.serviceWorker={register:async(url,opts)=>{registrations.push({url,opts});if(options.registrationFails)throw Error('Denied');}};
 const context=vm.createContext({navigator,location:{href:options.url||'https://example.test/scheduling/?claimRef=TEST-SOURCE',protocol:options.protocol||'https:'},URL});
 vm.runInContext(shell+'\nglobalThis.checkApi={initAppShell};',context);
 return {...context.checkApi,registrations};
}
(async()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.webmanifest'),'utf8'));
 check('Existing app identity and standalone window remain available',()=>{assert.equal(manifest.display,'standalone');assert.equal(manifest.name,'Nova-Scheduling-System');assert.equal(manifest.id,'./');assert.equal(manifest.start_url,'./');assert.equal(manifest.scope,'./');assert.equal(manifest.prefer_related_applications,false);assert(html.includes('rel="manifest" href="./manifest.webmanifest"'));});
 check('Launcher and Apple icons remain present with the declared PNG dimensions',()=>{for(const icon of manifest.icons){const png=fs.readFileSync(path.resolve(root,icon.src));assert.equal(png.toString('hex',0,8),'89504e470d0a1a0a');assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`,icon.sizes);}const apple=fs.readFileSync(path.join(root,'icons/apple-touch-icon.png'));assert.equal(apple.readUInt32BE(16),180);});
 const ui=start(fixture,"Object.assign(api.__check,{render,portalLink,claimAccessInstructions,setLocation:href=>{location.href=href;}});");ui.N.init();
 check('Sign-in page and workspace expose no installation card, button or guide',()=>{assert(!ui.el('authHome').innerHTML.includes('Install app'));assert(!ui.el('authHome').innerHTML.includes('Your workspace, as an app.'));assert.equal(ui.N.installApp,undefined);ui.asStaff();ui.T.render();assert(!html.includes('data-app-install'));assert(!html.includes('Install Nova Scheduling'));assert(!html.includes('beforeinstallprompt'));});
 check('App source contains no fixed GitHub hosting address',()=>{assert(!html.includes('lewishine101-design.github.io'));assert(!html.includes('nova-claims-live'));});
 const e=setup();e.initAppShell();e.initAppShell();
 check('Worker still registers once within the current app directory',()=>{assert.equal(e.registrations.length,1);assert.equal(e.registrations[0].url,'https://example.test/scheduling/sw.js');assert.equal(e.registrations[0].opts.scope,'/scheduling/');});
 const renamed=setup({url:'https://portal.example.test/Nova-Scheduling-System/index.html?claimRef=ABC'});renamed.initAppShell();
 check('Worker follows the current host and app path without a fixed deployment address',()=>assert.equal(renamed.registrations[0].url,'https://portal.example.test/Nova-Scheduling-System/sw.js'));
 const local=setup({protocol:'file:',url:'file:///tmp/index.html'});local.initAppShell();
 check('Downloaded HTML does not try to register a service worker',()=>assert.equal(local.registrations.length,0));
 const unsupported=setup({noWorker:true});unsupported.initAppShell();
 check('Missing service worker support does not block app initialization',()=>assert.equal(unsupported.registrations.length,0));
 const denied=setup({registrationFails:true});denied.initAppShell();await Promise.resolve();
 check('Worker registration failures remain non-blocking',()=>assert.equal(denied.registrations.length,1));
 ui.T.claim().claimRef='CLM / 42 & A+B #1';ui.T.setLocation('https://portal.example.test/scheduling/index.html?session=private#workspace');
 const link=new URL(ui.T.portalLink());
 check('Emailed claim links resolve on the active host, preserve the reference and omit session parameters',()=>{assert.equal(link.origin,'https://portal.example.test');assert.equal(link.pathname,'/scheduling/');assert.equal(link.searchParams.get('claimRef'),'CLM / 42 & A+B #1');assert.equal(link.searchParams.size,1);assert.equal(link.hash,'');assert.equal(ui.T.claimAccessInstructions()[1],link.href);});
 ui.T.setLocation('file:///tmp/scheduling.html');
 check('Downloaded copies provide claim-reference instructions rather than a broken or stale website link',()=>{assert.equal(ui.T.portalLink(),'');assert(ui.T.claimAccessInstructions()[0].includes('CLM / 42 & A+B #1'));assert(!ui.T.claimAccessInstructions()[0].includes('file:'));});
 const workerCode=fs.readFileSync(path.join(root,'sw.js'),'utf8'),workerEvents={},requests=[];let fail=false;
 const workerSelf={location:{href:'https://example.test/nova-claims-live/sw.js'},addEventListener:(n,fn)=>workerEvents[n]=fn,skipWaiting:async()=>{},clients:{claim:async()=>{}}};
 vm.runInNewContext(workerCode,{self:workerSelf,URL,Response,fetch:async(request,options)=>{requests.push({request,options});if(fail)throw Error('Offline');return new Response('live application',{status:200});}});
 function visit(url,mode='navigate',method='GET'){let result;workerEvents.fetch({request:{url,mode,method},respondWith:value=>result=value});return result;}
 const liveResponse=await visit('https://example.test/nova-claims-live/?claimRef=ABC');
 check('Online app navigation fetches the live document with its claim link intact',()=>{assert.equal(liveResponse.status,200);assert.equal(requests.at(-1).request.url,'https://example.test/nova-claims-live/?claimRef=ABC');assert.equal(requests.at(-1).options.cache,'no-store');});
 check('Worker leaves Firebase, account requests, assets and other applications untouched',()=>{assert.equal(visit('https://firestore.googleapis.com/v1/test','cors'),undefined);assert.equal(visit('https://example.test/nova-claims-live/icons/app-192.png','no-cors'),undefined);assert.equal(visit('https://example.test/another-app/'),undefined);assert.equal(visit('https://elsewhere.test/nova-claims-live/'),undefined);assert.equal(visit('https://example.test/nova-claims-live/','navigate','POST'),undefined);});
 fail=true;const offline=await visit('https://example.test/nova-claims-live/index.html?claimRef=PRIVATE-REFERENCE'),offlineText=await offline.text();
 check('Failed launches show a non-cached connection screen without claim details',()=>{assert.equal(offline.status,503);assert.equal(offline.headers.get('Cache-Control'),'no-store');assert(offlineText.includes('Try again'));assert(!offlineText.includes('PRIVATE-REFERENCE'));assert(!offlineText.includes('TEST-SOURCE'));assert(!/caches\./.test(workerCode));});
 console.log(JSON.stringify({passed:checks.length,checks},null,2));
})().catch(error=>{console.error(error);process.exit(1);});

// Run: node tests/pwa.cjs [path/to/index.html]
// All install prompts, storage, network and service worker APIs are isolated mocks.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const file=path.resolve(process.argv[2]||path.join(__dirname,'../index.html'));
const html=fs.readFileSync(file,'utf8'),root=path.dirname(file);
const scripts=[...html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
const app=scripts.find(m=>!m[1].trim())[2];
const install=app.slice(app.indexOf(' // Installation adds a launcher;'),app.indexOf(' function modal('));
assert(install.includes('async function installApp()'));
const checks=[];function check(name,fn){fn();checks.push(name);}
function setup(options={}){
 const events={},mediaEvents={},messages=[],dialogs=[],registrations=[];
 const nodes=[{hidden:false,disabled:false},{hidden:false,disabled:false}];
 const media={matches:!!options.standalone,addEventListener:(n,fn)=>mediaEvents[n]=fn};
 const navigator={userAgent:options.ua||'Chrome Windows',maxTouchPoints:options.touch||0,standalone:options.iosStandalone||false};
 if(!options.noWorker)navigator.serviceWorker={register:async(url,opts)=>{registrations.push({url,opts});if(options.registrationFails)throw Error('Denied');}};
 const context=vm.createContext({window:{matchMedia:()=>media,addEventListener:(n,fn)=>events[n]=fn},navigator,document:{querySelectorAll:()=>nodes},location:{href:options.url||'https://example.test/nova-claims-live/?claimRef=TEST-SOURCE',protocol:options.protocol||'https:'},URL,toast:message=>messages.push(message),esc:x=>String(x),modal:(title,body)=>dialogs.push({title,body}),btn:()=>'<button>Done</button>'});
 vm.runInContext(install+'\nglobalThis.checkApi={installApp,initAppInstall,syncAppInstall,isStandaloneApp};',context);
 return {...context.checkApi,events,media,mediaEvents,messages,dialogs,registrations,nodes};
}
function promptEvent(result='dismissed'){
 let prevented=0,prompted=0;
 return {event:{preventDefault(){prevented++;},async prompt(){prompted++;},userChoice:Promise.resolve({outcome:result})},prevented:()=>prevented,prompted:()=>prompted};
}
(async()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.webmanifest'),'utf8'));
 check('Manifest requests an installed standalone window with a stable app identity',()=>{assert.equal(manifest.display,'standalone');assert.equal(manifest.name,'Nova-Scheduling-System');assert.equal(manifest.id,'./');assert.equal(manifest.start_url,'./');assert.equal(manifest.scope,'./');assert.equal(manifest.prefer_related_applications,false);});
 check('Launcher and Apple icons exist with the declared PNG dimensions',()=>{for(const icon of manifest.icons){const png=fs.readFileSync(path.resolve(root,icon.src));assert.equal(png.toString('hex',0,8),'89504e470d0a1a0a');assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`,icon.sizes);}const apple=fs.readFileSync(path.join(root,'icons/apple-touch-icon.png'));assert.equal(apple.readUInt32BE(16),180);assert(manifest.icons.some(i=>i.purpose==='maskable'));});
 check('Manifest, worker and icons retain the application directory after a repository rename',()=>{for(const folder of ['nova-claims-live','Nova-Scheduling-System']){const base=new URL(`https://example.test/${folder}/manifest.webmanifest`);for(const item of [manifest.id,manifest.start_url,manifest.scope,...manifest.icons.map(i=>i.src)])assert(new URL(item,base).pathname.startsWith('/'+folder+'/'));assert.equal(new URL(manifest.start_url,base).search,'');}});
 check('Install controls are available before sign-in and in the workspace; installed-mode CSS hides them',()=>{assert(html.includes('rel="manifest" href="./manifest.webmanifest"'));assert(app.includes('<div class="login-install" data-app-install>'));assert(html.includes('class="nav-item" data-app-install data-app-install-button'));assert(html.includes('@media(display-mode:standalone){[data-app-install]{display:none!important}}'));assert(app.includes("innerHTML=authHomeHtml();syncAppInstall();"));});
 const e=setup();e.initAppInstall();e.initAppInstall();
 check('Worker registration is scoped to this application and happens once',()=>{assert.equal(e.registrations.length,1);assert.equal(e.registrations[0].url,'https://example.test/nova-claims-live/sw.js');assert.equal(e.registrations[0].opts.scope,'/nova-claims-live/');});
 const renamed=setup({url:'https://example.test/Nova-Scheduling-System/index.html?claimRef=ABC'});renamed.initAppInstall();
 check('Worker registration follows a renamed app path without including the linked claim',()=>assert.equal(renamed.registrations[0].url,'https://example.test/Nova-Scheduling-System/sw.js'));
 const local=setup({protocol:'file:',url:'file:///tmp/index.html'});local.initAppInstall();
 check('Opening a downloaded HTML file does not register a service worker',()=>assert.equal(local.registrations.length,0));
 const unsupported=setup({noWorker:true});unsupported.initAppInstall();await unsupported.installApp();
 check('Browsers without a service worker or native prompt still receive installation guidance',()=>assert(unsupported.dialogs[0].body.includes('Computer · Chrome or Edge')));
 const dismissed=promptEvent();e.events.beforeinstallprompt(dismissed.event);
 check('Browser install eligibility never triggers a prompt without a user click',()=>{assert.equal(dismissed.prevented(),1);assert.equal(dismissed.prompted(),0);});
 await e.installApp();await e.installApp();
 check('Dismissed prompts are consumed once and controls remain usable',()=>{assert.equal(dismissed.prompted(),1);assert(e.messages.includes('Installation cancelled. You can install the app later.'));assert(e.nodes.every(n=>!n.disabled&&!n.hidden));assert.equal(e.dialogs.length,1);});
 const accepted=setup(),accept=promptEvent('accepted');accepted.events.beforeinstallprompt(accept.event);await accepted.installApp();
 check('Accepting the prompt does not claim installation completed before the browser confirms it',()=>{assert(accepted.nodes.every(n=>!n.hidden));assert(!accepted.messages.some(m=>m.startsWith('App installed.')));});
 accepted.events.appinstalled();
 check('Browser installation confirmation hides install controls and explains how to launch the app',()=>{assert(accepted.nodes.every(n=>n.hidden));assert(accepted.messages.at(-1).startsWith('App installed.'));accepted.nodes.push({hidden:false});accepted.syncAppInstall();assert(accepted.nodes.at(-1).hidden);});
 const busy=setup();let finish;const choice=new Promise(resolve=>finish=resolve),pending=promptEvent();pending.event.userChoice=choice;busy.events.beforeinstallprompt(pending.event);const attempt=busy.installApp();await busy.installApp();
 check('Repeated clicks cannot launch overlapping installation prompts',()=>{assert.equal(pending.prompted(),1);assert(busy.nodes.every(n=>n.disabled));});finish({outcome:'dismissed'});await attempt;
 const broken=setup(),brokenPrompt=promptEvent();brokenPrompt.event.prompt=async()=>{throw Error('Blocked');};broken.events.beforeinstallprompt(brokenPrompt.event);await broken.installApp();
 check('A blocked native prompt opens manual instructions and re-enables controls',()=>{assert(broken.dialogs[0].body.includes('could not open its install prompt'));assert(broken.nodes.every(n=>!n.disabled));});
 for(const options of [{ua:'iPhone Safari'},{ua:'Macintosh Safari',touch:5}]){const ios=setup(options);await ios.installApp();check('Apple installation guidance explains Add to Home Screen and Open as Web App ('+options.ua+')',()=>{assert(ios.dialogs[0].body.indexOf('iPhone or iPad · Safari')<ios.dialogs[0].body.indexOf('<details>'));assert(ios.dialogs[0].body.includes('Open as Web App'));});}
 const android=setup({ua:'Android Chrome'});await android.installApp();
 check('Android installation guidance leads with the Chrome app-install flow',()=>assert(android.dialogs[0].body.indexOf('Android · Chrome')<android.dialogs[0].body.indexOf('<details>')));
 const standalone=setup({standalone:true});standalone.initAppInstall();await standalone.installApp();
 check('Standalone app windows hide install promotions without opening another install prompt',()=>{assert(standalone.nodes.every(n=>n.hidden));assert.equal(standalone.dialogs.length,0);});standalone.media.matches=false;standalone.mediaEvents.change();
 check('Display-mode changes update installation controls without reloading a claim',()=>assert(standalone.nodes.every(n=>!n.hidden)));
 const iosInstalled=setup({iosStandalone:true});iosInstalled.initAppInstall();
 check('iOS standalone mode is recognised even without a matching display media query',()=>assert(iosInstalled.nodes.every(n=>n.hidden)));
 const denied=setup({registrationFails:true});denied.initAppInstall();await Promise.resolve();await denied.installApp();
 check('Worker registration failure does not block login or installation guidance',()=>assert.equal(denied.dialogs.length,1));
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

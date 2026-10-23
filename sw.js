/* Nova Scheduling: online application, with a connection-help screen on failed launches.
   No CacheStorage, claim data, credentials or application HTML are stored by this worker. */
'use strict';
const appBase=new URL('./',self.location.href);
const offlinePage=`<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#17343b"><title>Nova-Scheduling-System</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f8faf8;color:#17343b;font:16px/1.7 system-ui,sans-serif}main{max-width:390px;padding:32px}small{font-size:12px;letter-spacing:3px;font-weight:700;color:#54734f}h1{font-size:29px;line-height:1.25;margin:20px 0}p{color:#61786b;font-size:14px}button{margin-top:12px;padding:12px 22px;border:0;border-radius:8px;background:#345e45;color:white;font:600 14px system-ui;cursor:pointer}button:focus-visible{outline:3px solid #91b581;outline-offset:3px}</style></head><body><main><small>TBRN · NOVA SCHEDULING</small><h1>Let’s get you connected.</h1><p>Nova Scheduling could not connect. Check your internet connection and try again to sign in and open your live claims.</p><button type="button" onclick="location.reload()">Try again</button></main></body></html>`;
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
 const request=event.request;
 if(request.method!=='GET'||request.mode!=='navigate')return;
 const url=new URL(request.url);
 if(url.origin!==appBase.origin||![appBase.pathname,appBase.pathname+'index.html'].includes(url.pathname))return;
 // Each launch uses the live application. Other pages and all API calls pass through untouched.
 event.respondWith(fetch(request,{cache:'no-store'}).catch(()=>new Response(offlinePage,{status:503,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})));
});

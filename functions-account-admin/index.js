'use strict';
const {initializeApp}=require('firebase-admin/app');
const {getAuth}=require('firebase-admin/auth');
const {getFirestore}=require('firebase-admin/firestore');
const {onCall,HttpsError}=require('firebase-functions/v2/https');
const {warn}=require('firebase-functions/logger');
const {createPasswordService}=require('./service');
initializeApp();

exports.adminAccountPassword=onCall({
 region:'europe-west2',
 serviceAccount:'tbrn-account-admin@nova-claims-system.iam.gserviceaccount.com',
 memory:'256MiB',timeoutSeconds:30,minInstances:0,maxInstances:2,invoker:'public',
 cors:['https://nova-scheduling-system.co.uk','https://www.nova-scheduling-system.co.uk'],
 // Identity and protected admin permissions are verified inside the handler.
 // App Check is not configured on the existing web app.
 enforceAppCheck:false
},createPasswordService({auth:getAuth(),db:getFirestore(),HttpsError,log:warn}));

const {spawnSync}=require('node:child_process'),path=require('node:path');
let total=0;
for(const name of ['schedule-versions','schedule-changes','staff-access','login-home','pwa','email-preview','staff-roles','contractor-access','contractor-hub']){
 const args=[path.join(__dirname,name+'.cjs')];if(process.argv[2])args.push(path.resolve(process.argv[2]));
 const result=spawnSync(process.execPath,args,{encoding:'utf8'});
 if(result.status!==0){console.error(name+' failed\n'+result.stderr);process.exit(1);}
 const {passed}=JSON.parse(result.stdout);total+=passed;console.log(name+': '+passed+' passed');
}
console.log('Application total: '+total);

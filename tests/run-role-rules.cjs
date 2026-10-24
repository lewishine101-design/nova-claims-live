const {spawnSync}=require('node:child_process'),fs=require('node:fs');
let failed=false;
for(const name of ['staff-roles.rules','staff-access.rules','rules-test']){
 const args=[name+'.cjs'];if(name==='staff-access.rules')args.push('../firestore.rules');
 const r=spawnSync(process.execPath,args,{encoding:'utf8'});fs.writeFileSync(name+'.log',r.stdout+r.stderr);
 try{const parsed=JSON.parse(r.stdout);console.log(name+': '+parsed.passed+' passed');}catch{console.log(name+': FAILED\n'+r.stdout.slice(-1000)+'\n'+r.stderr.slice(-3500));}
 if(r.status!==0)failed=true;
}
process.exitCode=failed?1:0;

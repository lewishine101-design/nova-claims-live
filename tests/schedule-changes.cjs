// Run: node tests/schedule-changes.cjs [path/to/index.html]
const assert=require('node:assert/strict');
const {start,fixture,variation,status}=require('./schedule-versions.cjs');
const clone=x=>JSON.parse(JSON.stringify(x));
const checks=[];function check(name,fn){fn();checks.push(name);}
const env=start(),T=env.T;
const before={...clone(fixture),scheduleVersion:{number:1},schedule:[
 {id:'a',room:'Living room',code:'DEC1',trade:'Decoration',description:'Paint walls',unit:'m2',qty:5,rate:10,note:'Preparation'},
 {id:'b',room:'Living room',code:'SK1',trade:'Carpentry',description:'Replace skirting',unit:'lm',qty:2,rate:8},
 {id:'c',room:'Living room',code:'DEC1',trade:'Decoration',description:'Paint ceiling',unit:'m2',qty:3,rate:12},
 {id:'d',room:'Living room',code:'MANUAL',trade:'Carpentry',description:'Repair door',unit:'Door',qty:1,rate:100}
]};
const after={...clone(before),scheduleVersion:{number:2,reason:'Additional damage.'},scheduleStatus:'In Progress',regionalVariance:30,vat:5,surveyorNotes:'Revised instructions.',schedule:[
 {...before.schedule[2],contractorSubmitted:true,tbrnEdited:true},
 {...before.schedule[0],qty:8,rate:11,note:'Extra preparation'},
 {...before.schedule[3],description:'Repair fire door',room:'Kitchen',unit:'Item'},
 {id:'e',room:'Kitchen',code:'MANUAL',trade:'Plumbing',description:'Replace tap',unit:'Item',qty:1,rate:50}
]};
after.roomDimensions['Living room'].length=5;
const originalJson=JSON.stringify({before,after}),diff=T.scheduleChangeData(before,after);
check('Added, removed and amended items are classified separately',()=>{assert.equal(diff.added.length,1);assert.equal(diff.added[0].id,'e');assert.equal(diff.removed.length,1);assert.equal(diff.removed[0].id,'b');assert.equal(diff.amended.length,2);assert.equal(diff.unchanged,1);});
check('Stable line identifiers distinguish repeated rate codes and moved rows',()=>{assert.deepEqual(clone(diff.amended.map(item=>item.after.id)),['a','d']);assert.deepEqual(clone(diff.amended[0].fields.map(field=>field.key)),['qty','rate','note']);assert.deepEqual(clone(diff.amended[1].fields.map(field=>field.key)),['room','description','unit']);});
check('Cost comparison uses full quantities, rates, variance and VAT',()=>{assert.equal(diff.beforeTotals.net,202);assert.equal(diff.afterTotals.net,274);assert.equal(diff.delta.net,72);assert(Math.abs(diff.delta.gross-95.25)<1e-8);const itemDelta=diff.added.reduce((sum,item)=>sum+item.qty*item.rate,0)-diff.removed.reduce((sum,item)=>sum+item.qty*item.rate,0)+diff.amended.reduce((sum,item)=>sum+item.after.qty*item.after.rate-item.before.qty*item.before.rate,0);assert.equal(itemDelta,diff.delta.net);});
check('Changes to scope, dimensions and pricing settings are included',()=>{for(const key of ['surveyorNotes','dimensions','regionalVariance','vat'])assert(diff.other.some(field=>field.key===key));});
check('Generating comparison data leaves both schedules untouched',()=>assert.equal(JSON.stringify({before,after}),originalJson));
const report={recordId:'source',claimRef:before.claimRef,from:{number:1,payload:before,current:false},to:{number:2,payload:after,current:true},priced:true,generatedAt:'2026-10-22T11:00:00Z'};
const rendered=T.changeReportHtml(report);
check('Separate report includes branded title, before/after details and costs',()=>{for(const text of ['Schedule change report','TBRN','Items added (1)','Items removed (1)','Items amended (2)','Previous','Revised','Extra preparation','Repair fire door','£95.25','not approved'])assert(rendered.includes(text),text);});
check('Assigned contractor remains absent from the separate final report',()=>{for(const text of ['Assigned contractor','Example Builder','builder@example.test'])assert(!rendered.includes(text));});
const unpriced=T.changeReportHtml({...report,priced:false});
check('Unpriced comparison hides rates, totals and pricing percentages',()=>{assert(!unpriced.includes('£'));assert(!unpriced.includes('Total including VAT'));assert(!unpriced.includes('VAT (%)'));assert(unpriced.includes('The rate changed; costs are excluded'));assert(unpriced.includes('Extra preparation'));});
const reordered=clone(before);reordered.schedule.reverse();reordered.schedule.forEach(item=>{item.contractorSubmitted=true;item.tbrnEdited=true;item.editedAt='2026-10-22';});
const same=T.scheduleChangeData(before,reordered);
check('Reordering and approval flags do not create false changes',()=>{assert.equal(same.added.length+same.removed.length+same.amended.length+same.other.length,0);assert.equal(same.unchanged,4);});
check('No-change comparison reports that explicitly',()=>assert(T.changeReportHtml({...report,to:{number:2,payload:reordered,current:false}}).includes('No changes to repair items or schedule settings')));
const legacyBefore=clone(before);legacyBefore.schedule=legacyBefore.schedule.slice(0,1);delete legacyBefore.schedule[0].id;legacyBefore.schedule[0].quantity=legacyBefore.schedule[0].qty;delete legacyBefore.schedule[0].qty;legacyBefore.schedule[0].notes=legacyBefore.schedule[0].note;delete legacyBefore.schedule[0].note;
const legacyAfter=clone(legacyBefore);legacyAfter.schedule[0].id='imported';legacyAfter.schedule[0].qty=8;
check('Legacy quantity and notes aliases match an unambiguous amendment',()=>{const result=T.scheduleChangeData(legacyBefore,legacyAfter);assert.equal(result.amended.length,1);assert.deepEqual(clone(result.amended[0].fields.map(field=>field.key)),['qty']);assert.equal(result.added.length+result.removed.length,0);});
const repeated={...clone(before),schedule:[{...legacyBefore.schedule[0],quantity:1},{...legacyBefore.schedule[0],quantity:1}]};
const fewer=clone(repeated);fewer.schedule.pop();
check('Identical repeated legacy items cancel one-for-one',()=>{const result=T.scheduleChangeData(repeated,fewer);assert.equal(result.removed.length,1);assert.equal(result.added.length+result.amended.length,0);assert.equal(result.unchanged,1);});
const ambiguous=clone(repeated);ambiguous.schedule[0].quantity=2;ambiguous.schedule[1].quantity=3;
check('Ambiguous legacy lines are not falsely paired as amendments',()=>{const result=T.scheduleChangeData(repeated,ambiguous);assert.equal(result.amended.length,0);assert.equal(result.added.length,2);assert.equal(result.removed.length,2);});
const replacement=clone(before);replacement.schedule[0].id='replacement';replacement.schedule[0].qty=99;
check('Replacing a distinct identified item remains an addition and removal',()=>{const result=T.scheduleChangeData(before,replacement);assert.equal(result.added.length,1);assert.equal(result.removed.length,1);assert.equal(result.amended.length,0);});
const rateBefore={...clone(before),schedule:[{...before.schedule[0],rate:12.00001}]},rateAfter={...clone(rateBefore),schedule:[{...rateBefore.schedule[0],rate:12.00002}]};
check('Small stored rate amendments remain visible at their original precision',()=>{const output=T.changeReportHtml({...report,from:{number:1,payload:rateBefore},to:{number:2,payload:rateAfter}});assert(output.includes('£12.00001'));assert(output.includes('£12.00002'));});
const unsafe=clone(after);unsafe.schedule[0].description='<img src=x onerror=alert(1)>';unsafe.surveyorNotes='<script>bad()</script>';
check('Report text is escaped safely',()=>{const output=T.changeReportHtml({...report,to:{number:2,payload:unsafe}});assert(!output.includes('<img'));assert(!output.includes('<script'));assert(output.includes('&lt;img'));});
(async()=>{
 const e=start();e.connect();await variation(e,'First variation.');e.editQty('20');await status(e,'TBRN Approved Schedule');await variation(e,'Second variation.');e.editQty('30');
 const savedBefore=JSON.stringify(e.T.claim()),commitCount=e.commits();e.N.changeReportDialog();
 check('Dialog defaults to previous saved version against current working schedule',()=>{assert.equal(e.T.getChangeReport().from.number,2);assert.equal(e.T.getChangeReport().to.number,3);assert(e.el('changeReportPreview').innerHTML.includes('not approved'));});
 e.N.printChangeReport();
 check('Print/PDF uses the same standalone report shown in the preview',()=>{assert.equal(e.prints.at(-1).html,e.el('changeReportPreview').innerHTML);assert(e.prints.at(-1).title.includes('Schedule Changes - V2 to V3'));assert(!e.prints.at(-1).html.includes('change-report-controls'));});
 e.el('changeFrom').value='saved:0';e.N.refreshChangeReport();check('Original-to-current comparison can be selected',()=>{assert.equal(e.T.getChangeReport().from.number,1);assert.equal(e.T.getChangeReport().to.number,3);});
 e.el('changeTo').value='saved:1';e.N.refreshChangeReport();check('A saved variation can be compared against the original',()=>{assert.equal(e.T.getChangeReport().to.number,2);assert.equal(e.T.getChangeReport().from.number,1);assert(!e.el('changeReportPreview').innerHTML.includes('not approved'));});
 e.el('changePrices').checked=false;e.N.refreshChangeReport();e.N.printChangeReport();check('Unpriced preview and printed report both omit costs',()=>{assert(!e.el('changeReportPreview').innerHTML.includes('£'));assert(!e.prints.at(-1).html.includes('£'));});
 check('Preview and printing do not save or alter the claim or history',()=>{assert(JSON.stringify(e.T.claim())===savedBefore,'Report changed claim data');assert.equal(e.commits(),commitCount);});
 e.asContractor();e.N.changeReportDialog();check('Assigned contractor can view the comparison for their claim',()=>assert(e.T.getChangeReport()));
 const prints=e.prints.length;e.T.setUser({email:'other@example.test',emailVerified:true});e.N.changeReportDialog();e.N.printChangeReport();check('Unassigned contractor cannot generate or print the report',()=>assert.equal(e.prints.length,prints));
 const final=start();final.connect();await variation(final);final.editQty('22');await status(final,'TBRN Approved Schedule');final.N.changeReportDialog();check('Approved schedule defaults to its exact saved copy for comparison',()=>{assert.equal(final.T.getChangeReport().to.current,false);assert.equal(final.T.getChangeReport().to.number,2);assert.equal(final.T.getChangeReport().from.number,1);assert.equal(final.T.getChangeReport().to.payload.schedule[0].qty,22);});
 const empty=start();empty.N.changeReportDialog();check('A claim with no earlier version explains when comparison becomes available',()=>{assert(empty.el('dialog').innerHTML.includes('needs an earlier saved schedule'));assert.equal(empty.T.getChangeReport(),null);});
 console.log(JSON.stringify({passed:checks.length,checks,productionDataTouched:false},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});

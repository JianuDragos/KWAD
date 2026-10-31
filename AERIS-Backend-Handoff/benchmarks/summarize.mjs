import fs from 'node:fs';
import path from 'node:path';
const root=process.argv[2]||path.join(import.meta.dirname,'results');
const median=a=>{a=a.filter(x=>typeof x==='number').sort((a,b)=>a-b);return a.length?(a[Math.floor((a.length-1)/2)]+a[Math.ceil((a.length-1)/2)])/2:null};
const rows=[];
let audits=[];try{audits=JSON.parse(fs.readFileSync(path.join(root,'revalidation.json'),'utf8').replace(/^\uFEFF/,''));}catch{}
const auditMap=new Map(audits.map(x=>[x.key,x]));
for(const name of fs.readdirSync(root)){
 const dir=path.join(root,name);if(!fs.statSync(dir).isDirectory())continue;
 const runs=fs.readdirSync(dir).filter(f=>/^(A|B|C|D|E|F|G|H|I|J|J2)-\d+\.json$/.test(f)).map(f=>JSON.parse(fs.readFileSync(path.join(dir,f),'utf8').replace(/^\uFEFF/,'')));
 const quality=runs.filter(r=>r.case_id!=='F'),tools=runs.filter(r=>r.case_id==='F');
 for(const r of quality){const a=auditMap.get(`${name}/${r.case_id}-${r.repeat}.json`);if(a){r.validation=a.validation;r.timing_valid=a.timing_valid;}}
 const timed=quality.filter(r=>r.timing_valid!==false);
 const pass=k=>quality.filter(r=>r.validation?.[k]).length;
 const seconds=median(timed.map(r=>r.total_seconds)),first=median(timed.map(r=>r.first_content_seconds));
 const peak=quality.length?Math.max(...quality.map(r=>r.peak_process_working_set_bytes))/2**30:null;
 let load=null;try{load=JSON.parse(fs.readFileSync(path.join(dir,'load.json'),'utf8').replace(/^\uFEFF/,''))}catch{}
 const expected=30;const components={grounding:30*pass('grounding')/expected,instructions:20*pass('instructions')/expected,structure:15*pass('structure')/expected,stability:15*pass('completion')/expected,speed:seconds&&first?10*Math.min(1,10/seconds)*Math.min(1,2/first):0,efficiency:peak!==null?5+5*Math.max(0,Math.min(1,(8-peak)/6)):0};
 const row={label:name,model:quality[0]?.model??load?.arguments?.[2]??name,observed_requests:quality.length,expected_requests:expected,passed:pass('pass'),grounded:pass('grounding'),instruction_pass:pass('instructions'),structure_pass:pass('structure'),completed:pass('completion'),repetitions:quality.filter(r=>r.repetition).length,errors:quality.filter(r=>r.error).length,tool_pass:tools.filter(r=>r.validation?.pass).length,tool_test_count:tools.length,median_total_seconds:seconds,median_first_content_seconds:first,peak_process_working_set_gib:peak,minimum_system_available_gib:quality.length?Math.min(...quality.map(r=>r.minimum_system_available_bytes))/2**30:null,median_reported_tokens_per_second:median(quality.map(r=>r.reported_tokens_per_second)),score_components:components,weighted_score:Object.values(components).reduce((a,b)=>a+b,0),automatic_gate:pass('completion')===30&&pass('grounding')>=27&&pass('pass')>=27,load_seconds:load?.total_seconds??null,load_exit_code:load?.exit_code??null,manual_review_required:true};
 row.timing_excluded=quality.length-timed.length;row.scoring_validation=audits.length?'v2-revalidation':'original';row.median_reported_tokens_per_second=median(timed.map(r=>r.reported_tokens_per_second));
 rows.push(row);
}
rows.sort((a,b)=>b.weighted_score-a.weighted_score);fs.writeFileSync(path.join(root,'summary.json'),JSON.stringify(rows,null,2));
console.log(JSON.stringify(rows,null,2));

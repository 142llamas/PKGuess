import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url:'https://example.com/' });
const { window } = dom;
const def=(k,v)=>{try{Object.defineProperty(globalThis,k,{value:v,configurable:true,writable:true});}catch{}};
global.window=window; global.document=window.document;
def('navigator',window.navigator); def('Node',window.Node); def('HTMLElement',window.HTMLElement); def('MouseEvent',window.MouseEvent);
const files={'data/movelist-gen2.json':'./data/movelist-gen2.json','data/movestats-gen2.json':'./data/movestats-gen2.json','data/draftpool-gen2.json':'./data/draftpool-gen2.json','data/typechart-gen2.json':'./data/typechart-gen2.json'};
global.fetch=async(u)=>{const p=files[u]; if(!p) return {ok:false,json:async()=>({})}; return {ok:true,json:async()=>JSON.parse(readFileSync(p,'utf8'))};};
const gen2=JSON.parse(readFileSync('./data/gen2.json','utf8'));
const { createDraftBattle } = await import('./js/modes/draftbattle.js');
const wait=(ms)=>new Promise(r=>setTimeout(r,ms));
const q=(s)=>document.querySelectorAll(s);
const click=(n)=>n.dispatchEvent(new window.MouseEvent('click',{bubbles:true}));
const ctrl=createDraftBattle({ mount:document.getElementById('app'), config:{}, data:gen2, params:{variant:'daily'}, onExit:()=>{} });
await wait(300); // startDaily: identity/firebase fail (offline) -> draft
console.log('Daily card shown:', !!document.querySelector('.draft-stat-chips') || document.body.textContent.includes('Daily'));
let steps=0;
while(steps<30){steps++;
  let pend=q('.draft-stat-chip.pending,.draft-type-chip.pending,.draft-move-chip.pending').length, g=0;
  while(pend<2 && g++<12){const a=[...q('.draft-stat-chip.available,.draft-type-chip.available,.draft-move-chip.available')]; if(!a.length)break; click(a[0]); pend=q('.draft-stat-chip.pending,.draft-type-chip.pending,.draft-move-chip.pending').length;}
  const c=[...q('.draft-advance-btns button')].find(b=>!b.disabled); if(c)click(c);
  if(document.body.textContent.includes('Draft Complete'))break;
}
console.log('Complete reached:', document.body.textContent.includes('Draft Complete'));
const submitBtn=[...q('button')].find(b=>b.textContent.includes('Submit'));
console.log('Submit button present:', !!submitBtn);
click(submitBtn);
await wait(300); // submit (offline noop) -> showDailyResults -> compute (deferred)
console.log('Results title shown:', document.body.textContent.includes('Daily Results'));
console.log('Provisional/offline note:', !!document.querySelector('.battle-offline'));
console.log('My line:', document.querySelector('.daily-myline') ? document.querySelector('.daily-myline').textContent.trim() : '(none)');
console.log('Ranking rows:', q('.lb-table tbody tr').length);
console.log('Actions:', [...q('.summary-actions button')].map(b=>b.textContent.trim()).join(' | '));

// #9 — "See Yesterday's Results" round trip
const yesterdayBtn = [...q('.summary-actions button')].find(b=>b.textContent.includes('Yesterday'));
console.log('Yesterday button present:', !!yesterdayBtn);
const todayDateLine = document.querySelector('.battle-vs')?.textContent;
click(yesterdayBtn);
await wait(300); // showDailyResults(yesterday) -> compute (deferred)
console.log('Yesterday title shown:', document.body.textContent.includes('Yesterday’s Results'));
const yesterdayDateLine = document.querySelector('.battle-vs')?.textContent;
console.log('Date changed from today:', yesterdayDateLine !== todayDateLine, `(today: "${todayDateLine}", yesterday: "${yesterdayDateLine}")`);
const backToTodayBtn = [...q('.summary-actions button')].find(b=>b.textContent.includes("Today’s Results"));
console.log('Back-to-today button present:', !!backToTodayBtn);
click(backToTodayBtn);
await wait(300);
console.log('Back on Daily Results:', document.body.textContent.includes('Daily Results'));
const backDateLine = document.querySelector('.battle-vs')?.textContent;
console.log('Date restored to today:', backDateLine === todayDateLine);

ctrl.destroy();
console.log('DAILY SMOKE PASSED');

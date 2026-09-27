(() => {
"use strict";
const LS_KEY="budgetPackStateV1", PROFILE_KEY="budgetPackProfileV1", THEME_KEY="budgetPackThemeV1";
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const pad=n=>String(n).padStart(2,"0");
const isoDate=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const today=()=>isoDate(new Date());
const uid=(p="id")=>`${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,9)}`;
const money=n=>new Intl.NumberFormat("fr-CA",{style:"currency",currency:"CAD",maximumFractionDigits:2}).format(Number(n||0));
const fmtDate=s=>new Date(`${s}T12:00:00`).toLocaleDateString("fr-CA",{weekday:"short",day:"numeric",month:"short"});
const monthKey=s=>String(s).slice(0,7);
const parseLocal=s=>new Date(`${s}T12:00:00`);
const addDays=(s,n)=>{const d=parseLocal(s);d.setDate(d.getDate()+n);return isoDate(d)};
const daysBetween=(a,b)=>Math.round((parseLocal(b)-parseLocal(a))/86400000);
const deepClone=o=>JSON.parse(JSON.stringify(o));
const nowIso=()=>new Date().toISOString();

const merchants=["Tim Hortons","Dépanneur","Épicerie","McDo / resto","Pharmacie","Amazon","Maison / réno","Enfants","Vêtements","Loisirs","Cadeaux","Auto","Animaux","Autre"];
const categories=["Épicerie","Resto / café","Dépanneur","Maison / réno","Enfants","Pharmacie","Vêtements","Loisirs","Cadeaux","Auto","Animaux","Facture","Autre"];

function seedBills(){
  const mk=(name,amount,dueDay,category="Facture",variable=false)=>({id:uid("bill"),name,amount,dueDay,category,frequency:"monthly",variable,autopay:false,active:true,statuses:{},createdAt:nowIso(),updatedAt:nowIso()});
  return [
    mk("Assurances",615,1), mk("Hydro",445,20,"Facture",true), mk("Netflix",20,20),
    mk("Visa",300,20,"Facture",true), mk("Fairstone",672,21), mk("Prêt 1",225,21),
    mk("Vidéotron",160,22), mk("Cogeco",80,24), mk("Hypothèque",1054,30),
    mk("Taxes municipales",200,15)
  ];
}
function defaultState(){
  return {
    settings:{familyName:"Budget familial",startBalance:0,startBalanceDate:today(),trackingStartDate:today(),overdraftLimit:1000,groceryBudget:300,categoryBudgets:{},historyMonths:"12",reminderHour:9,sundayReminder:true,dayBeforeReminder:true,lateReminder:true,timezone:"America/Toronto",updatedAt:nowIso()},
    bills:seedBills(),
    transactions:[],
    incomeSchedules:[
      {id:uid("inc"),name:"Ma paie",frequency:"weekly",weekday:4,amount:null,active:true,updatedAt:nowIso()},
      {id:uid("inc"),name:"Paie conjointe",frequency:"monthly",dueDay:1,amount:1534,active:true,updatedAt:nowIso()},
      {id:uid("inc"),name:"Paie conjointe",frequency:"monthly",dueDay:20,amount:3600,active:true,updatedAt:nowIso()}
    ],
    goals:[],
    monthlyPlans:{},
    archives:{},
    updatedAt:nowIso()
  };
}
let state=loadState(), summaryCursor=new Date(), calendarDays=14, historyFilter="all", cloudBusy=false, cloudTimer=null, oneSignalReady=false;
let profile=loadProfile();

function loadState(){try{return JSON.parse(localStorage.getItem(LS_KEY))||defaultState()}catch{return defaultState()}}
function loadProfile(){try{return JSON.parse(localStorage.getItem(PROFILE_KEY))||{apiUrl:"",token:"",memberId:"",memberName:"",familyId:"",joinCode:"",cloudVersion:0,oneSignalAppId:""}}catch{return {apiUrl:"",token:"",memberId:"",memberName:"",familyId:"",joinCode:"",cloudVersion:0,oneSignalAppId:""}}}
function saveProfile(){localStorage.setItem(PROFILE_KEY,JSON.stringify(profile))}
function saveState(skipCloud=false){
  state.updatedAt=nowIso(); localStorage.setItem(LS_KEY,JSON.stringify(state)); render();
  if(!skipCloud && profile.token && profile.apiUrl){clearTimeout(cloudTimer);cloudTimer=setTimeout(pushCloud,650)}
}
function touchSettings(){state.settings.updatedAt=nowIso()}
function toast(msg){const t=$("#toast");t.textContent=msg;t.classList.remove("hidden");clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.add("hidden"),2200)}
function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}

function applyTheme(name,custom){
  const r=document.documentElement, themes={
    beast:["#090b0a","#151816","#1d211e","#f7f8f7","#aab2ac","#7CFF00","#081000"],
    rose:["#130d11","#21141d","#2b1a27","#fff6fb","#ceb6c6","#ff74b7","#250011"],
    violet:["#100d17","#1b1626","#241d33","#fbf8ff","#bfb6cf","#b18cff","#120625"],
    blue:["#091118","#101d26","#172935","#f5fbff","#aac0cf","#52b7ff","#00131f"],
    light:["#f4f5f4","#ffffff","#edf0ed","#151915","#667066","#47a800","#ffffff"],
    dark:["#080808","#141414","#202020","#fafafa","#b5b5b5","#eeeeee","#111111"]
  };
  let vals=themes[name]||themes.beast;if(name==="custom"&&custom){vals=[...themes.beast];vals[5]=custom}
  ["--bg","--card","--card2","--text","--muted","--accent","--accentText"].forEach((k,i)=>r.style.setProperty(k,vals[i]));
  document.querySelector('meta[name="theme-color"]').setAttribute("content",vals[0]);
  localStorage.setItem(THEME_KEY,JSON.stringify({name,custom}));
}
function initTheme(){try{const t=JSON.parse(localStorage.getItem(THEME_KEY));if(t)applyTheme(t.name,t.custom)}catch{}}

function lastDay(y,m){return new Date(y,m,0).getDate()}
function monthlyDate(year,month1,day){return `${year}-${pad(month1)}-${pad(Math.min(day,lastDay(year,month1)))}`}
function billOccurrences(bill,from,to){
  if(bill.deletedAt) return [];
  if(!bill.active && !bill.endedAt) return [];
  let out=[];
  if(bill.frequency==="one"){
    if(bill.dueDate>=from&&bill.dueDate<=to) out=[bill.dueDate];
  } else if(bill.frequency==="weekly"){
    let d=bill.startDate||from;
    while(d<from)d=addDays(d,7);
    while(d<=to){out.push(d);d=addDays(d,7)}
  } else {
    let d=parseLocal(from), end=parseLocal(to);
    d.setDate(1);
    while(d<=end){
      const s=monthlyDate(d.getFullYear(),d.getMonth()+1,bill.dueDay||1);
      if(s>=from&&s<=to)out.push(s);
      d.setMonth(d.getMonth()+1);
    }
  }
  const activeFrom=bill.activeFrom||state.settings.trackingStartDate||state.settings.startBalanceDate||today();
  out=out.filter(x=>x>=activeFrom);
  if(bill.endedAt) out=out.filter(x=>x<=bill.endedAt);
  return out;
}
function incomeOccurrences(sched,from,to){
  if(!sched.active||sched.deletedAt)return [];
  let out=[];
  if(sched.frequency==="one"){
    if(!sched.receivedAt&&sched.dueDate>=from&&sched.dueDate<=to)out=[sched.dueDate];
  }else if(sched.frequency==="monthly"){
    let d=parseLocal(from),end=parseLocal(to);d.setDate(1);
    while(d<=end){const s=monthlyDate(d.getFullYear(),d.getMonth()+1,sched.dueDay||1);if(s>=from&&s<=to)out.push(s);d.setMonth(d.getMonth()+1)}
  }else if(sched.frequency==="weekly"){
    let d=parseLocal(from),target=sched.weekday??4;
    while(d.getDay()!==target)d.setDate(d.getDate()+1);
    while(isoDate(d)<=to){out.push(isoDate(d));d.setDate(d.getDate()+7)}
  }
  out=out.filter(date=>!(sched.coveredDates||{})[date]);
  return out;
}
function billStatus(bill,due){return (bill.statuses||{})[due]||{}}
function setBillStatus(bill,due,patch){
  bill.statuses=bill.statuses||{};bill.statuses[due]={...bill.statuses[due],...patch,updatedAt:nowIso()};bill.updatedAt=nowIso();saveState()
}
function dueItems(from=addDays(today(),-30),to=addDays(today(),31)){
  const arr=[];
  state.bills.forEach(b=>billOccurrences(b,from,to).forEach(due=>{
    const status=billStatus(b,due);
    if(status.coveredByMonthlyPlan)return;
    arr.push({kind:"bill",bill:b,due,status});
  }));
  return arr.sort((a,b)=>a.due.localeCompare(b.due));
}
function nextPayDate(){
  const from=today(),to=addDays(from,60), dates=[];
  state.incomeSchedules.forEach(s=>incomeOccurrences(s,from,to).forEach(d=>dates.push({date:d,s})));
  dates.sort((a,b)=>a.date.localeCompare(b.date)); return dates[0]||null;
}
function currentBalance(){
  const start=state.settings.startBalanceDate||"1900-01-01";
  let v=Number(state.settings.startBalance||0);
  state.transactions.forEach(t=>{
    if(t.date<start)return;
    if(t.kind==="income")v+=Number(t.amount||0);
    if(t.kind==="expense")v-=Number(t.amount||0);
  });
  state.bills.forEach(b=>Object.entries(b.statuses||{}).forEach(([due,st])=>{
    const paidDate=(st.paidAt||"").slice(0,10);
    if(st.paidAt && paidDate>=start)v-=Number(st.paidAmount??b.amount??0);
  }));
  return v;
}
function overMonth(key=monthKey(today())){return state.transactions.filter(t=>t.kind==="over"&&monthKey(t.date)===key).reduce((s,t)=>s+Number(t.amount||0),0)}
function expensesWeek(){
  const d=new Date();const day=(d.getDay()+6)%7;const start=isoDate(new Date(d.getFullYear(),d.getMonth(),d.getDate()-day));const end=addDays(start,6);
  const out=state.transactions.filter(t=>t.kind==="expense"&&t.date>=start&&t.date<=end).map(t=>({...t}));
  state.bills.forEach(b=>{
    if(!b.importedMonthlyPlan)return;
    Object.entries(b.statuses||{}).forEach(([due,st])=>{
      const pd=(st.paidAt||"").slice(0,10);
      if(pd>=start&&pd<=end)out.push({kind:"expense",date:pd,amount:Number(st.paidAmount??b.amount??0),category:b.category||"Autre",merchant:b.name});
    });
  });
  return out;
}
function nextPayGroup(){
  const from=today(),to=addDays(from,60),events=[];
  state.incomeSchedules.forEach(s=>incomeOccurrences(s,from,to).forEach(date=>events.push({date,s})));
  events.sort((a,b)=>a.date.localeCompare(b.date));
  if(!events.length)return null;
  const date=events[0].date, same=events.filter(x=>x.date===date);
  const known=same.filter(x=>x.s.amount!=null);
  const amount=known.reduce((sum,x)=>sum+Number(x.s.amount||0),0);
  return {date,events:same,amount,hasUnknown:known.length!==same.length};
}
function nextPayProjection(){
  const bal=Number(currentBalance());
  const group=nextPayGroup();
  if(!group){
    const end=addDays(today(),14);
    const beforeBills=dueItems(today(),end).filter(x=>!x.status.paidAt);
    const dueBefore=beforeBills.reduce((sum,x)=>sum+Number(x.bill.amount||0),0);
    return {bal,payDate:null,dueBefore,before:bal-dueBefore,payAmount:null,hasUnknown:true,sameDayDue:0,after:null,count:0};
  }
  const beforeEnd=addDays(group.date,-1);
  const beforeBills=beforeEnd>=today()?dueItems(today(),beforeEnd).filter(x=>!x.status.paidAt):[];
  const sameDayBills=dueItems(group.date,group.date).filter(x=>!x.status.paidAt);
  const dueBefore=beforeBills.reduce((sum,x)=>sum+Number(x.bill.amount||0),0);
  const sameDayDue=sameDayBills.reduce((sum,x)=>sum+Number(x.bill.amount||0),0);
  const before=Number((bal-dueBefore).toFixed(2));
  const after=group.hasUnknown?null:Number((before+group.amount-sameDayDue).toFixed(2));
  return {bal,payDate:group.date,dueBefore,before,payAmount:group.amount,hasUnknown:group.hasUnknown,sameDayDue,after,count:group.events.length};
}
function availableToPay(){return nextPayProjection().before}

function render(){
  renderHome();renderGoals();renderCalendar();renderHistory();renderSummary();renderSettings();renderQuickMerchants();updateSyncLine();ensureNegativeBalanceButton();ensureNightBalanceHomeButton();ensureBudgetImportHomeButton();ensureMonthlyPlanHomeButton();
}

// ----- Suivi du plan : solde réel vs repères « restant prévu » -----
function planRemainingMarkers(){
  const out=[];
  Object.entries(state.monthlyPlans||{}).forEach(([month,plan])=>{
    (plan?.items||[]).forEach((item,index)=>{
      if(item?.kind!=="remaining"||!validImportDate(item.date))return;
      const amount=Number(item.amount);if(!Number.isFinite(amount))return;
      out.push({month,date:item.date,amount,label:item.label||"Restant prévu",line:Number(item.line||index),index});
    });
  });
  return out.sort((a,b)=>a.date.localeCompare(b.date)||(a.line-b.line)||(a.index-b.index));
}
function planTrackerData(){
  const markers=planRemainingMarkers(), now=today();
  if(!markers.length)return {active:null,next:null};
  const past=markers.filter(x=>x.date<=now);
  const active=past.length?past[past.length-1]:null;
  // S'il y a plusieurs « restants » la même journée (ex. Frank, Mari, familial),
  // le suivi utilise le DERNIER repère de cette journée, donc le restant familial final.
  const future=markers.filter(x=>x.date>now);
  let next=null;
  if(future.length){
    const firstDate=future[0].date;
    const sameDate=future.filter(x=>x.date===firstDate);
    next=sameDate[sameDate.length-1]||future[0];
  }
  if(!active)return {active:null,next};
  const actual=Number(currentBalance().toFixed(2));
  const planned=Number(active.amount.toFixed(2));
  const diff=Number((actual-planned).toFixed(2));
  return {active,next,actual,planned,diff};
}
function ensurePlanTrackerHome(){
  let box=document.getElementById("planTrackerCard");
  if(box)return box;
  const stats=document.querySelector("#homePage .stats4");
  if(!stats)return null;
  box=document.createElement("div");
  box.id="planTrackerCard";
  box.className="card";
  box.style.marginTop="12px";
  stats.insertAdjacentElement("afterend",box);
  return box;
}
function renderPlanTracker(){
  const box=ensurePlanTrackerHome();if(!box)return;
  const t=planTrackerData();
  if(!t.active){
    if(t.next){
      box.innerHTML=`<div class="catTop"><strong>📊 Suivi du plan</strong><strong>${money(t.next.amount)}</strong></div><div class="sub">Prochain repère : ${esc(fmtDate(t.next.date))} · ${esc(t.next.label||"Restant prévu")}</div><div class="sub" style="margin-top:6px">Le suivi réel vs prévu commencera à ce repère.</div>`;
    }else{
      box.innerHTML=`<div class="catTop"><strong>📊 Suivi du plan</strong></div><div class="sub">Ajoute un « Restant prévu » dans le budget importé pour activer le suivi.</div>`;
    }
    return;
  }
  const d=t.diff;
  const status=Math.abs(d)<0.01
    ? `<strong class="okText">✅ Pile sur le budget</strong>`
    : d>0
      ? `<strong class="okText">🟢 ${money(d)} mieux que prévu</strong>`
      : `<strong class="dangerText">🔴 ${money(Math.abs(d))} sous le budget prévu</strong>`;
  const next=t.next?`<div class="sub" style="margin-top:8px">Prochain repère : <b>${money(t.next.amount)}</b> · ${esc(fmtDate(t.next.date))}</div>`:"";
  box.innerHTML=`<div class="catTop"><strong>📊 Suivi du plan</strong>${status}</div><div class="catTop" style="margin-top:8px"><span>Prévu au dernier repère</span><strong>${money(t.planned)}</strong></div><div class="catTop"><span>Solde réel dans l'app</span><strong>${money(t.actual)}</strong></div><div class="sub" style="margin-top:6px">Repère du ${esc(fmtDate(t.active.date))} · ${esc(t.active.label||"Restant prévu")}</div>${next}`;
}

function ensureNextPayProjectionHome(){
  let box=document.getElementById("nextPayProjectionCard");
  if(box)return box;
  const grid=document.querySelector("#homePage .heroGrid");
  if(!grid)return null;
  box=document.createElement("div");
  box.id="nextPayProjectionCard";
  box.style.marginTop="12px";
  box.style.padding="12px";
  box.style.border="1px solid var(--card2)";
  box.style.borderRadius="16px";
  box.style.background="var(--card2)";
  grid.insertAdjacentElement("afterend",box);
  return box;
}
function renderNextPayProjection(){
  const p=nextPayProjection();
  const cell=document.getElementById("availableUntilPay")?.parentElement;
  const label=cell?.querySelector("span");
  if(label)label.textContent="Avant prochaine paie";
  const box=ensureNextPayProjectionHome();if(!box)return;
  if(!p.payDate){
    box.innerHTML=`<div class="catTop"><strong>💵 Projection prochaine paie</strong></div><div class="sub">Aucune paie planifiée dans les 60 prochains jours. Le montant « Avant prochaine paie » réserve seulement les paiements des 14 prochains jours.</div>`;
    return;
  }
  const payLabel=p.count>1?"Paies prévues":"Paie prévue";
  const payValue=p.hasUnknown?"Montant à confirmer":money(p.payAmount);
  const afterLine=p.after==null
    ? `<div class="catTop"><span>Après paie + paiements du jour</span><strong>À confirmer</strong></div>`
    : `<div class="catTop"><span>Après paie + paiements du jour</span><strong>${money(p.after)}</strong></div>`;
  box.innerHTML=`<div class="catTop"><strong>💵 Projection prochaine paie</strong><strong>${esc(fmtDate(p.payDate))}</strong></div>
    <div class="catTop" style="margin-top:8px"><span>Solde réel maintenant</span><strong>${money(p.bal)}</strong></div>
    <div class="catTop"><span>À payer AVANT la paie</span><strong>−${money(p.dueBefore)}</strong></div>
    <div class="catTop"><span>Juste avant la paie</span><strong>${money(p.before)}</strong></div>
    <div class="catTop"><span>${payLabel}</span><strong>${payValue}</strong></div>
    <div class="catTop"><span>Paiements prévus le même jour</span><strong>−${money(p.sameDayDue)}</strong></div>
    ${afterLine}
    <div class="sub" style="margin-top:6px">Les paiements déjà couverts par ton budget mensuel ne sont pas comptés une deuxième fois.</div>`;
}
function renderHome(){
  const bal=currentBalance();$("#budgetBalance").textContent=money(bal);$("#availableUntilPay").textContent=money(availableToPay());$("#overThisMonth").textContent=money(overMonth());
  const od=$("#overdraftCard");
  if(bal<0){const used=Math.abs(bal),limit=Number(state.settings.overdraftLimit||1000);od.innerHTML=`<div class="overdraft">🚨 <strong>Découvert utilisé ${money(used)} / ${money(limit)}</strong><div class="sub">Il reste ${money(Math.max(0,limit-used))} avant la limite.</div></div>`}else od.innerHTML="";
  const items=dueItems(addDays(today(),-31),addDays(today(),7));
  const upcoming=items.filter(x=>x.due>=today()&&!x.status.paidAt), late=items.filter(x=>x.due<today()&&!x.status.paidAt && (!x.status.snoozedUntil||x.status.snoozedUntil<=today()));
  $("#bills7").textContent=upcoming.length;$("#lateCount").textContent=late.length;
  const week=expensesWeek(), spend=week.reduce((s,t)=>s+Number(t.amount||0),0), groc=week.filter(t=>t.category==="Épicerie").reduce((s,t)=>s+Number(t.amount||0),0);
  $("#spendWeek").textContent=money(spend);$("#groceryWeek").textContent=`${money(groc)} / ${money(state.settings.groceryBudget||0)}`;
  const show=items.filter(x=>!x.status.paidAt && (x.due>=addDays(today(),-14))).slice(0,7);
  $("#homeBills").innerHTML=show.length?show.map(renderBillRow).join(""):`<div class="card muted">Aucun paiement urgent 🎉</div>`;
  renderNextPayProjection();
  renderPlanTracker();
}
function renderBillRow(x){
  const late=x.due<today(), snooze=x.status.snoozedUntil&&x.status.snoozedUntil>today();
  let badge=late?`<span class="badge red">EN RETARD</span>`:`<span class="badge orange">${esc(fmtDate(x.due))}</span>`;
  if(snooze)badge=`<span class="badge orange">REPORTÉ AU ${esc(fmtDate(x.status.snoozedUntil))}</span>`;
  return `<div class="billRow"><div class="billMain"><div class="billTitle">${esc(x.bill.name)}</div><div class="sub">${esc(x.bill.category||"Facture")}</div>${badge}</div><div class="amount">${money(x.bill.amount)}</div><div class="rowActions"><button onclick="BP.payBill('${x.bill.id}','${x.due}')" title="Marquer payée">✅</button><button onclick="BP.snooze('${x.bill.id}','${x.due}')" title="Reporter">⏰</button><button onclick="BP.editBill('${x.bill.id}')" title="Modifier">✏️</button><button onclick="BP.deleteBill('${x.bill.id}')" title="Supprimer">🗑️</button></div></div>`
}
function renderGoals(){
  const el=$("#homeGoals");if(!el)return;
  el.innerHTML=state.goals.length?state.goals.map(g=>{const pct=Math.min(100,Math.round((Number(g.saved||0)/Math.max(1,Number(g.target||0)))*100));return `<div class="card"><div class="catTop"><strong>🎯 ${esc(g.name)}</strong><strong>${money(g.saved)} / ${money(g.target)}</strong></div><div class="bar"><i style="width:${pct}%"></i></div><button class="smallBtn" style="margin-top:9px" onclick="BP.addGoalMoney('${g.id}')">＋ Mettre de côté</button></div>`}).join(""):`<div class="card muted">Aucun objectif pour l'instant.</div>`;
}
function renderCalendar(){
  const from=today(),to=addDays(from,calendarDays), events=[];
  dueItems(from,to).forEach(x=>events.push({date:x.due,type:"bill",x}));
  state.incomeSchedules.forEach(s=>incomeOccurrences(s,from,to).forEach(date=>events.push({date,type:"income",sched:s})));
  events.sort((a,b)=>a.date.localeCompare(b.date));
  $("#calendarList").innerHTML=events.length?events.map(e=>{
    const d=parseLocal(e.date);
    if(e.type==="income"){
      const received=!!e.sched.receivedAt;
      return `<div class="timelineRow"><div class="timelineDate">${d.toLocaleDateString("fr-CA",{weekday:"short"})}<b>${d.getDate()}</b></div><div class="historyMain"><div class="historyTitle">💵 ${esc(e.sched.name)}</div><div class="sub">${received?"Reçue":(e.sched.amount==null?"Montant à entrer":money(e.sched.amount))}</div></div>${e.sched.amount!=null?`<div class="amount ${received?"okText":""}">${money(e.sched.receivedAmount??e.sched.amount)}</div>`:""}${e.sched.importedMonthlyPlan&&!received?`<div class="rowActions"><button onclick="BP.receiveIncome('${e.sched.id}','${e.date}')" title="Marquer reçue">✅</button></div>`:""}</div>`;
    }
    const st=e.x.status, paid=!!st.paidAt;
    return `<div class="timelineRow"><div class="timelineDate">${d.toLocaleDateString("fr-CA",{weekday:"short"})}<b>${d.getDate()}</b></div><div class="historyMain"><div class="historyTitle">🧾 ${esc(e.x.bill.name)}</div><div class="sub">${paid?"Payée":(st.snoozedUntil?`Reportée au ${fmtDate(st.snoozedUntil)}`:"À payer")}</div></div><div class="amount ${paid?"okText":""}">${money(st.paidAmount??e.x.bill.amount)}</div><div class="rowActions"><button onclick="BP.editBill('${e.x.bill.id}')" title="Modifier">✏️</button><button onclick="BP.deleteBill('${e.x.bill.id}')" title="Supprimer">🗑️</button></div></div>`;
  }).join(""):`<div class="card muted">Rien à afficher.</div>`;
}
function historyItems(){
  const arr=[];
  state.transactions.forEach(t=>arr.push({date:t.date,kind:t.kind,id:t.id,title:t.merchant||t.name||(t.kind==="income"?"Paie":"OVER"),amount:t.amount,category:t.category,member:t.memberName,note:t.note,raw:t}));
  state.bills.forEach(b=>Object.entries(b.statuses||{}).forEach(([due,st])=>{if(st.paidAt)arr.push({date:st.paidAt.slice(0,10),kind:"bill",id:`${b.id}|${due}`,title:b.name,amount:st.paidAmount??b.amount,category:b.category||"Facture",member:st.paidBy,note:`Échéance ${due}`,raw:{bill:b,due,st}})}));
  return arr.sort((a,b)=>b.date.localeCompare(a.date));
}
function renderHistory(){
  let arr=historyItems();if(historyFilter!=="all")arr=arr.filter(x=>x.kind===historyFilter);
  $("#historyList").innerHTML=arr.slice(0,250).map(x=>`<div class="historyRow"><div class="historyMain"><div class="historyTitle">${x.kind==="expense"?"💸":x.kind==="income"?"💵":x.kind==="over"?"⚡":"🧾"} ${esc(x.title)}</div><div class="sub">${esc(fmtDate(x.date))}${x.category?` · ${esc(x.category)}`:""}${x.member?` · ${esc(x.member)}`:""}</div></div><div class="amount ${x.kind==="income"?"okText":x.kind==="over"?"warnText":""}">${x.kind==="income"?"+":x.kind==="expense"||x.kind==="bill"?"−":""}${money(x.amount)}</div><div class="rowActions"><button onclick="BP.editHistory('${x.kind}','${x.id}')">✏️</button></div></div>`).join("")||`<div class="card muted">Aucun historique.</div>`;
}
function monthData(key){
  const tx=state.transactions.filter(t=>monthKey(t.date)===key), bills=[];
  state.bills.forEach(b=>Object.entries(b.statuses||{}).forEach(([due,st])=>{if(st.paidAt&&monthKey(st.paidAt)===key)bills.push({bill:b,due,st})}));
  const income=tx.filter(t=>t.kind==="income").reduce((s,t)=>s+Number(t.amount||0),0), over=tx.filter(t=>t.kind==="over").reduce((s,t)=>s+Number(t.amount||0),0), expenses=tx.filter(t=>t.kind==="expense").reduce((s,t)=>s+Number(t.amount||0),0), billPaid=bills.reduce((s,x)=>s+Number(x.st.paidAmount??x.bill.amount??0),0);
  const cats={};tx.filter(t=>t.kind==="expense").forEach(t=>cats[t.category||"Autre"]=(cats[t.category||"Autre"]||0)+Number(t.amount||0));bills.forEach(x=>{const k=(x.bill.category&&x.bill.category!=="Facture")?x.bill.category:"Factures";cats[k]=(cats[k]||0)+Number(x.st.paidAmount??x.bill.amount??0)});
  let minBal=null,negDays=0;
  const first=`${key}-01`,last=monthlyDate(Number(key.slice(0,4)),Number(key.slice(5,7)),31);
  let b=Number(state.settings.startBalance||0); // approximation month path from start
  const daily={};
  state.transactions.filter(t=>t.date<=last&&t.date>=state.settings.startBalanceDate).forEach(t=>{daily[t.date]=daily[t.date]||0;daily[t.date]+=t.kind==="income"?Number(t.amount||0):t.kind==="expense"?-Number(t.amount||0):0});
  state.bills.forEach(bl=>Object.entries(bl.statuses||{}).forEach(([d,st])=>{const p=(st.paidAt||"").slice(0,10);if(p&&p<=last&&p>=state.settings.startBalanceDate){daily[p]=daily[p]||0;daily[p]-=Number(st.paidAmount??bl.amount??0)}}));
  let cur=state.settings.startBalanceDate; if(cur<=last){while(cur<=last){b+=daily[cur]||0;if(cur>=first){if(b<0)negDays++;minBal=minBal===null?b:Math.min(minBal,b)}cur=addDays(cur,1)}}
  return {income,over,expenses,billPaid,totalOut:expenses+billPaid,net:income-expenses-billPaid,cats,negDays,minBal:minBal??0,tx,bills};
}
function renderSummary(){
  const key=`${summaryCursor.getFullYear()}-${pad(summaryCursor.getMonth()+1)}`, m=monthData(key);
  $("#summaryMonth").textContent=summaryCursor.toLocaleDateString("fr-CA",{month:"long",year:"numeric"});
  const prev=new Date(summaryCursor);prev.setMonth(prev.getMonth()-1);const pk=`${prev.getFullYear()}-${pad(prev.getMonth()+1)}`,pm=monthData(pk);const diff=m.totalOut-pm.totalOut;
  const cells=[["Revenus",m.income],["Dépenses",m.totalOut],["OVER séparé",m.over],["Résultat",m.net],["Jours découvert",m.negDays],["Plus bas solde",m.minBal],["Vs mois passé",diff]];
  $("#summaryCards").innerHTML=cells.map(([a,v],i)=>`<div class="summaryCell"><span>${a}</span><strong>${i===4?v:money(v)}</strong></div>`).join("");
  const max=Math.max(1,...Object.values(m.cats));$("#categoryBreakdown").innerHTML=Object.entries(m.cats).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<div class="catRow"><div class="catTop"><span>${esc(k)}</span><strong>${money(v)}</strong></div><div class="bar"><i style="width:${Math.max(4,v/max*100)}%"></i></div></div>`).join("")||`<div class="muted small">Pas encore de dépenses ce mois-ci.</div>`;
}
function renderQuickMerchants(){
  const recent=state.transactions.filter(t=>t.kind==="expense"&&t.merchant).slice().sort((a,b)=>b.date.localeCompare(a.date)).map(t=>t.merchant);
  const list=[...new Set([...recent,...merchants])].slice(0,16);
  $("#quickMerchants").innerHTML=list.map(m=>`<button class="chip" onclick="BP.quickMerchant('${encodeURIComponent(m)}')">${esc(m)}</button>`).join("");
}
function renderSettings(){
  const s=state.settings;
  $("#startBalance").value=s.startBalance;$("#startBalanceDate").value=s.startBalanceDate;$("#overdraftLimit").value=s.overdraftLimit;$("#groceryBudget").value=s.groceryBudget;$("#reminderHour").value=s.reminderHour;$("#sundayReminder").checked=s.sundayReminder;$("#dayBeforeReminder").checked=s.dayBeforeReminder;$("#lateReminder").checked=s.lateReminder;$("#historyMonths").value=s.historyMonths;
  $("#apiUrl").value=profile.apiUrl||"";$("#memberName").value=profile.memberName||"";$("#oneSignalAppId").value=profile.oneSignalAppId||"";
  const cb=state.settings.categoryBudgets||{};$("#categoryBudgetList").innerHTML=Object.keys(cb).length?Object.entries(cb).map(([k,v])=>`<div class="billRow"><div class="billMain"><div class="billTitle">${esc(k)}</div><div class="sub">Budget mensuel</div></div><div class="amount">${money(v)}</div><div class="rowActions"><button onclick="BP.removeCategoryBudget('${encodeURIComponent(k)}')">✕</button></div></div>`).join(""):`<div class="muted small">Aucun budget mensuel supplémentaire.</div>`;
  $("#cloudStatus").innerHTML=profile.token?`✅ Connecté comme <b>${esc(profile.memberName||"membre")}</b><br>Code famille : <b>${esc(profile.joinCode||"—")}</b>`:`Pas encore connecté — l'app fonctionne localement.`;
  ensureBalanceTools();
}
function updateSyncLine(){
  $("#syncLine").textContent=profile.token?`Budget partagé · ${profile.memberName||"connecté"}`:"Mode local · prêt à utiliser";
}

function openModal(html){$("#modal").innerHTML=html;$("#modalBackdrop").classList.remove("hidden")}
function closeModal(){$("#modalBackdrop").classList.add("hidden")}
function modalHeader(title){return `<div class="modalHeader"><h2>${title}</h2><button class="closeBtn" onclick="BP.close()">✕</button></div>`}
function expenseForm(prefill=""){
  openModal(`${modalHeader("Ajouter une dépense")}<form id="expenseForm" class="formGrid">
    <label class="span2">Montant<input name="amount" type="number" step=".01" inputmode="decimal" required autofocus></label>
    <label class="span2">Commerce / dépense<input name="merchant" value="${esc(prefill)}" list="merchantList" required></label>
    <datalist id="merchantList">${merchants.map(m=>`<option>${esc(m)}</option>`).join("")}</datalist>
    <label>Catégorie<select name="category">${categories.map(c=>`<option>${c}</option>`).join("")}</select></label>
    <label>Date<input name="date" type="date" value="${today()}" required></label>
    <label>Type<select name="needFun"><option value="">Non précisé</option><option>Besoin</option><option>Plaisir</option></select></label>
    <label>Qui<input name="memberName" value="${esc(profile.memberName||"Moi")}"></label>
    <label class="span2">Note (facultatif)<input name="note"></label>
    <button class="fullBtn primary span2">Enregistrer</button>
  </form>`);
  $("#expenseForm").onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);state.transactions.unshift({id:uid("tx"),kind:"expense",amount:Number(f.get("amount")),merchant:f.get("merchant"),category:f.get("category"),date:f.get("date"),needFun:f.get("needFun"),memberName:f.get("memberName"),note:f.get("note"),createdAt:nowIso(),updatedAt:nowIso()});saveState();closeModal();toast("Dépense ajoutée ✅")}
}
function incomeForm(kind="income"){
  const over=kind==="over";
  openModal(`${modalHeader(over?"Ajouter de l'OVER":"Ajouter une paie")}<form id="incomeForm">
    <label>Montant<input name="amount" type="number" step=".01" inputmode="decimal" required autofocus></label>
    <label>Date<input name="date" type="date" value="${today()}" required></label>
    <label>Note<input name="note" placeholder="${over?"Ex. heures supplémentaires":"Facultatif"}"></label>
    <button class="fullBtn primary">Enregistrer</button>
    ${over?`<p class="muted small">⚡ L'OVER est suivi séparément et n'augmente pas le budget disponible.</p>`:""}
  </form>`);
  $("#incomeForm").onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);state.transactions.unshift({id:uid("tx"),kind,amount:Number(f.get("amount")),date:f.get("date"),name:over?"OVER":"Paie",memberName:profile.memberName||"Moi",note:f.get("note"),createdAt:nowIso(),updatedAt:nowIso()});saveState();closeModal();toast(over?"OVER enregistré ⚡":"Paie ajoutée 💵")}
}
function billForm(editId=null){
  const b=editId?state.bills.find(x=>x.id===editId):null;
  openModal(`${modalHeader(b?"Modifier facture":"Ajouter une facture")}<form id="billForm" class="formGrid">
    <label class="span2">Nom<input name="name" value="${esc(b?.name||"")}" required></label>
    <label>Montant<input name="amount" type="number" step=".01" value="${b?.amount??""}" required></label>
    <label>Catégorie<select name="category">${categories.map(c=>`<option ${b?.category===c?"selected":""}>${c}</option>`).join("")}</select></label>
    <label>Fréquence<select name="frequency"><option value="monthly" ${b?.frequency==="monthly"?"selected":""}>Mensuelle</option><option value="weekly" ${b?.frequency==="weekly"?"selected":""}>Hebdomadaire</option><option value="one" ${b?.frequency==="one"?"selected":""}>Une fois</option></select></label>
    <label>Jour du mois<input name="dueDay" type="number" min="1" max="31" value="${b?.dueDay??1}"></label>
    <label>Date unique / départ<input name="dueDate" type="date" value="${b?.dueDate||b?.startDate||today()}"></label>
    <label class="switchRow"><span>Montant variable</span><input name="variable" type="checkbox" ${b?.variable?"checked":""}></label>
    <label class="switchRow"><span>Prélèvement auto</span><input name="autopay" type="checkbox" ${b?.autopay?"checked":""}></label>
    <button class="fullBtn primary span2">${b?"Enregistrer":"Ajouter"}</button>
    ${b?`<button type="button" class="fullBtn span2" onclick="BP.endBill('${b.id}')">🏁 Prêt/facture terminé</button><button type="button" class="fullBtn span2" onclick="BP.deleteBill('${b.id}')">🗑️ Supprimer la facture</button>`:""}
  </form>`);
  $("#billForm").onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);const obj=b||{id:uid("bill"),statuses:{},createdAt:nowIso()};Object.assign(obj,{name:f.get("name"),amount:Number(f.get("amount")),category:f.get("category"),frequency:f.get("frequency"),dueDay:Number(f.get("dueDay")||1),dueDate:f.get("dueDate"),startDate:f.get("dueDate"),activeFrom:b?.activeFrom||today(),variable:f.get("variable")==="on",autopay:f.get("autopay")==="on",active:true,updatedAt:nowIso()});if(!b)state.bills.push(obj);saveState();closeModal();toast(b?"Facture modifiée":"Facture ajoutée")}
}
function goalForm(){
  openModal(`${modalHeader("Nouvel objectif")}<form id="goalForm"><label>Nom<input name="name" required placeholder="Noël, vacances, urgence..."></label><label>Objectif $<input name="target" type="number" step=".01" required></label><label>Déjà mis de côté<input name="saved" type="number" step=".01" value="0"></label><button class="fullBtn primary">Ajouter</button></form>`);
  $("#goalForm").onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);state.goals.push({id:uid("goal"),name:f.get("name"),target:Number(f.get("target")),saved:Number(f.get("saved")),updatedAt:nowIso()});saveState();closeModal();toast("Objectif ajouté 🎯")}
}
function afford(){
  openModal(`${modalHeader("Peut-on se le permettre?")}<form id="affordForm"><label>Montant de l'achat<input name="amount" type="number" step=".01" required autofocus></label><button class="fullBtn primary">Calculer</button><div id="affordResult"></div></form>`);
  $("#affordForm").onsubmit=e=>{e.preventDefault();const a=Number(new FormData(e.target).get("amount")||0), before=availableToPay(), after=before-a, limit=Number(state.settings.overdraftLimit||1000);let txt;
    if(after>=0)txt=`<div class="card"><h3 class="okText">✅ Oui sans découvert</h3><p>Il resterait <b>${money(after)}</b> avant la prochaine paie après les obligations prévues.</p></div>`;
    else if(after>=-limit)txt=`<div class="card"><h3 class="warnText">⚠️ Ça utiliserait le découvert</h3><p>Projection : <b>${money(after)}</b>. Techniquement possible, mais pas avec les salaires disponibles seulement.</p></div>`;
    else txt=`<div class="card"><h3 class="dangerText">🚨 Non</h3><p>Projection : <b>${money(after)}</b>, donc sous la limite de découvert de ${money(-limit)}.</p></div>`;
    $("#affordResult").innerHTML=txt;
  }
}
function payBill(id,due){
  const b=state.bills.find(x=>x.id===id);if(!b)return;
  const st=billStatus(b,due), planned=Number(st.paidAmount??b.amount??0);
  let amount=planned;

  // Les paiements provenant du budget mensuel gardent le montant prévu,
  // mais permettent de confirmer ou corriger le montant réellement payé.
  if(b.importedMonthlyPlan){
    const exact=confirm(`🧾 ${b.name}\n\nMontant prévu : ${money(planned)}\n\nAs-tu payé exactement ce montant?\n\nOK = oui\nAnnuler = corriger le montant`);
    if(!exact){
      const raw=prompt(`Entre le montant réellement payé pour ${b.name}`,String(planned));
      if(raw===null)return;
      amount=importTextMoney(raw);
      if(!Number.isFinite(amount)||amount<0)return toast("Entre un montant valide");
    }
  }else if(b.variable){
    const raw=prompt(`Montant réellement payé pour ${b.name}`,String(planned));
    if(raw===null)return;
    amount=importTextMoney(raw);
    if(!Number.isFinite(amount)||amount<0)return toast("Entre un montant valide");
  }

  setBillStatus(b,due,{paidAt:nowIso(),paidAmount:Number(amount),paidBy:profile.memberName||"Moi",snoozedUntil:null});
  toast(Math.abs(Number(amount)-planned)>0.005?`Paiement réel ${money(amount)} · prévu ${money(planned)} ✅`:"Facture payée ✅")
}
function snooze(id,due){
  const b=state.bills.find(x=>x.id===id);if(!b)return;const proposed=addDays(today(),2),d=prompt(`Reporter l'alerte de "${b.name}" jusqu'à quelle date?`,proposed);if(!d)return;
  setBillStatus(b,due,{snoozedUntil:d});toast(`Rappels reportés au ${fmtDate(d)} ⏰`)
}
function endBill(id){
  const b=state.bills.find(x=>x.id===id);if(!b)return;if(!confirm(`Terminer "${b.name}"? L'historique restera conservé.`))return;b.active=false;b.endedAt=today();b.updatedAt=nowIso();saveState();closeModal();toast(`🎉 ${b.name} terminé`)
}
function deleteBill(id){
  const b=state.bills.find(x=>x.id===id);if(!b)return;
  if(!confirm(`Supprimer "${b.name}"?\n\nElle disparaîtra du calendrier et des rappels. Les paiements déjà enregistrés resteront dans l'historique.`))return;
  b.active=false;
  b.deletedAt=nowIso();
  delete b.endedAt;
  b.updatedAt=nowIso();
  saveState();
  closeModal();
  toast(`🗑️ ${b.name} supprimée`)
}

function addGoalMoney(id){
  const g=state.goals.find(x=>x.id===id);if(!g)return;const v=prompt(`Combien ajouter à "${g.name}" ?`,"0");if(v===null)return;g.saved=Number(g.saved||0)+Number(v||0);g.updatedAt=nowIso();saveState();toast("Objectif mis à jour 🎯")
}
function addCategoryBudget(){
  openModal(`${modalHeader("Budget par catégorie")}<form id="catBudgetForm"><label>Catégorie<select name="category">${categories.map(c=>`<option>${c}</option>`).join("")}</select></label><label>Budget mensuel<input name="amount" type="number" step=".01" required></label><button class="fullBtn primary">Enregistrer</button></form>`);
  $("#catBudgetForm").onsubmit=e=>{e.preventDefault();const f=new FormData(e.target);state.settings.categoryBudgets=state.settings.categoryBudgets||{};state.settings.categoryBudgets[f.get("category")]=Number(f.get("amount"));touchSettings();saveState();closeModal();toast("Budget catégorie ajouté")}
}
function removeCategoryBudget(encoded){
  const k=decodeURIComponent(encoded);if(!confirm(`Enlever le budget "${k}" ?`))return;delete state.settings.categoryBudgets[k];touchSettings();saveState()
}
function editHistory(kind,id){
  if(kind==="bill"){
    const [billId,due]=id.split("|"),b=state.bills.find(x=>x.id===billId);if(!b)return;
    if(confirm(`Annuler le statut PAYÉ de "${b.name}" ?`)){delete b.statuses[due];b.updatedAt=nowIso();saveState();toast("Paiement annulé")}
    return;
  }
  const t=state.transactions.find(x=>x.id===id);if(!t)return;
  const amount=prompt("Modifier le montant",String(t.amount));if(amount===null)return;
  t.amount=Number(amount||0);
  if(kind==="expense"){const name=prompt("Modifier le nom / commerce",t.merchant||"");if(name!==null)t.merchant=name}
  const date=prompt("Modifier la date (AAAA-MM-JJ)",t.date);if(date)t.date=date;
  t.updatedAt=nowIso();saveState();toast("Entrée modifiée ✅")
}
function summaryText(){
  const key=`${summaryCursor.getFullYear()}-${pad(summaryCursor.getMonth()+1)}`,m=monthData(key);
  const cats=Object.entries(m.cats).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}: ${money(v)}`).join("; ");
  return `BUDGET PACK — BILAN ${key}
Revenus normaux: ${money(m.income)}
Dépenses totales: ${money(m.totalOut)}
Résultat sans OVER: ${money(m.net)}
OVER séparé: ${money(m.over)}
Jours à découvert: ${m.negDays}
Plus bas solde estimé: ${money(m.minBal)}
Catégories: ${cats||"aucune"}
Analyse ce bilan. Dis-moi clairement ce qui est bon, ce qui est à surveiller et 3 actions concrètes pour améliorer le prochain mois sans compter l'OVER comme revenu normal.`;
}
async function shareSummary(){
  const text=summaryText();try{if(navigator.share)await navigator.share({title:"BUDGET PACK — Bilan",text});else{await navigator.clipboard.writeText(text);toast("Bilan copié — colle-le dans ChatGPT 🤖")}}catch(e){if(e.name!=="AbortError")toast("Impossible de partager")}
}
function exportData(){
  const blob=new Blob([JSON.stringify({version:1,exportedAt:nowIso(),state},null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`budget-pack-${today()}.json`;a.click();URL.revokeObjectURL(a.href)
}
function importData(file){
  const r=new FileReader();r.onload=()=>{try{const j=JSON.parse(r.result);if(!j.state)throw Error();state=j.state;saveState();toast("Sauvegarde importée ✅")}catch{toast("Fichier invalide")}};r.readAsText(file)
}

// ----- Cloud sync -----
function apiBase(){return (profile.apiUrl||"").replace(/\/+$/,"")}
async function api(path,opts={}){
  const headers={...(opts.headers||{})};
  // Sans jeton (création/join), text/plain évite le pré-test CORS sur certains navigateurs Android.
  // Le Worker lit quand même le corps avec request.json().
  if(opts.body) headers["Content-Type"]=profile.token?"application/json":"text/plain;charset=UTF-8";
  if(profile.token) headers.Authorization=`Bearer ${profile.token}`;
  const r=await fetch(apiBase()+path,{...opts,headers});const j=await r.json().catch(()=>({}));if(!r.ok){const err=new Error(j.error||`Erreur ${r.status}`);err.status=r.status;err.data=j;throw err}return j
}
function mergeById(a=[],b=[]){
  const m=new Map();[...a,...b].forEach(x=>{const old=m.get(x.id);if(!old||String(x.updatedAt||"")>=String(old.updatedAt||""))m.set(x.id,x)});return [...m.values()]
}
function mergeMonthlyPlans(localPlans={},remotePlans={}){
  const out={...remotePlans};
  Object.entries(localPlans||{}).forEach(([k,v])=>{
    const r=out[k];
    if(!r||String(v?.updatedAt||"")>=String(r?.updatedAt||""))out[k]=v;
  });
  return out;
}
function mergeState(local,remote){
  if(!remote||!remote.settings)return local;
  const settings=String(local.settings?.updatedAt||"")>=String(remote.settings?.updatedAt||"")?local.settings:remote.settings;
  return {...remote,...local,settings,bills:mergeById(local.bills,remote.bills),transactions:mergeById(local.transactions,remote.transactions),incomeSchedules:mergeById(local.incomeSchedules,remote.incomeSchedules),goals:mergeById(local.goals,remote.goals),monthlyPlans:mergeMonthlyPlans(local.monthlyPlans,remote.monthlyPlans),archives:{...(remote.archives||{}),...(local.archives||{})},updatedAt:nowIso()}
}
async function pullCloud(){
  if(!profile.token||!apiBase()||cloudBusy)return;cloudBusy=true;
  try{
    const j=await api("/api/state");
    if(j.data&&j.data.settings){state=mergeState(state,j.data);profile.cloudVersion=j.version||0;saveProfile();localStorage.setItem(LS_KEY,JSON.stringify(state));render();await pushCloud(true)}
    else{profile.cloudVersion=j.version||0;saveProfile();await pushCloud(true)}
  }catch(e){console.warn(e)}finally{cloudBusy=false}
}
async function pushCloud(force=false){
  if(!profile.token||!apiBase()||cloudBusy)return;cloudBusy=true;
  try{
    const j=await api("/api/state",{method:"PUT",body:JSON.stringify({version:profile.cloudVersion||0,data:state})});profile.cloudVersion=j.version;saveProfile();$("#syncLine").textContent=`Synchronisé · ${profile.memberName||""}`;
  }catch(e){
    if(e.status===409&&e.data?.data){state=mergeState(state,e.data.data);profile.cloudVersion=e.data.version;saveProfile();localStorage.setItem(LS_KEY,JSON.stringify(state));cloudBusy=false;return pushCloud(true)}
    $("#syncLine").textContent="Sync à vérifier";console.warn(e)
  }finally{cloudBusy=false}
}
async function createFamily(){
  profile.apiUrl=$("#apiUrl").value.trim();profile.memberName=$("#memberName").value.trim()||"Moi";if(!profile.apiUrl)return toast("Entre l'adresse du serveur");
  try{const j=await api("/api/family/create",{method:"POST",body:JSON.stringify({familyName:state.settings.familyName||"Budget familial",memberName:profile.memberName,timezone:state.settings.timezone||"America/Toronto"})});Object.assign(profile,{token:j.token,memberId:j.memberId,familyId:j.familyId,joinCode:j.joinCode,cloudVersion:j.version||0});saveProfile();await pushCloud(true);await initOneSignal();render();toast(`Budget partagé créé · code ${j.joinCode}`)}catch(e){toast("Création impossible : "+e.message)}
}
async function joinFamily(){
  profile.apiUrl=$("#apiUrl").value.trim();profile.memberName=$("#memberName").value.trim()||"Membre";const code=$("#joinCode").value.trim().toUpperCase();if(!profile.apiUrl||!code)return toast("Adresse serveur + code requis");
  try{const j=await api("/api/family/join",{method:"POST",body:JSON.stringify({joinCode:code,memberName:profile.memberName})});Object.assign(profile,{token:j.token,memberId:j.memberId,familyId:j.familyId,joinCode:j.joinCode,cloudVersion:0});saveProfile();await pullCloud();await initOneSignal();render();toast("Budget partagé rejoint ✅")}catch(e){toast("Impossible de rejoindre : "+e.message)}
}
function leaveCloud(){if(!confirm("Déconnecter ce téléphone du budget partagé? Les données locales restent ici."))return;profile={...profile,token:"",memberId:"",familyId:"",joinCode:"",cloudVersion:0};saveProfile();render();toast("Téléphone déconnecté")}
async function initOneSignal(){
  const appId=profile.oneSignalAppId;if(!appId||oneSignalReady)return;
  window.OneSignalDeferred=window.OneSignalDeferred||[];
  window.OneSignalDeferred.push(async OneSignal=>{
    try{const swUrl=new URL("push/onesignal/OneSignalSDKWorker.js",location.href), swPath=swUrl.pathname.replace(/^\//,""), swScope=swUrl.pathname.replace(/OneSignalSDKWorker\.js$/,"");await OneSignal.init({appId,serviceWorkerPath:swPath,serviceWorkerParam:{scope:swScope}});if(profile.memberId)await OneSignal.login(profile.memberId);oneSignalReady=true}catch(e){console.warn("OneSignal",e)}
  })
}
async function enablePush(){
  profile.oneSignalAppId=$("#oneSignalAppId").value.trim();saveProfile();if(!profile.oneSignalAppId)return toast("Ajoute le OneSignal App ID");
  await initOneSignal();window.OneSignalDeferred=window.OneSignalDeferred||[];window.OneSignalDeferred.push(async OneSignal=>{try{if(profile.memberId)await OneSignal.login(profile.memberId);await OneSignal.Notifications.requestPermission();toast("Notifications activées 🔔")}catch(e){toast("Impossible d'activer les notifications")}})
}

// ----- settings / nav -----

function ensureNegativeBalanceButton(){
  const input=document.getElementById("startBalance");
  if(!input || document.getElementById("startBalanceSignBtn")) return;
  const wrap=document.createElement("div");
  wrap.style.display="grid";
  wrap.style.gridTemplateColumns="1fr 54px";
  wrap.style.gap="8px";
  wrap.style.alignItems="end";
  input.parentNode.insertBefore(wrap,input);
  wrap.appendChild(input);
  const btn=document.createElement("button");
  btn.type="button";
  btn.id="startBalanceSignBtn";
  btn.className="smallBtn";
  btn.textContent="±";
  btn.style.height="44px";
  btn.style.marginTop="6px";
  btn.onclick=()=>{
    input.value=String(-Number(input.value||0));
    input.dispatchEvent(new Event("change",{bubbles:true}));
    input.focus();
  };
  wrap.appendChild(btn);
}

function ensureNightBalanceHomeButton(){
  if(document.getElementById("nightBalanceHomeBtn"))return;
  const balance=document.getElementById("budgetBalance");
  if(!balance)return;
  const host=balance.closest(".card")||balance.parentElement;
  if(!host)return;
  const btn=document.createElement("button");
  btn.type="button";
  btn.id="nightBalanceHomeBtn";
  btn.className="fullBtn primary";
  btn.style.marginTop="12px";
  btn.textContent="🌙 Entrer le solde du soir";
  btn.onclick=nightBalance;
  host.appendChild(btn);
}

function ensureBudgetImportHomeButton(){
  if(document.getElementById("budgetImportHomeBtn"))return;
  const night=document.getElementById("nightBalanceHomeBtn");
  if(!night||!night.parentNode)return;
  const btn=document.createElement("button");
  btn.type="button";
  btn.id="budgetImportHomeBtn";
  btn.className="fullBtn";
  btn.style.marginTop="8px";
  btn.textContent="📥 Importer un budget";
  btn.onclick=openBudgetImport;
  night.parentNode.appendChild(btn);
}

function ensureMonthlyPlanHomeButton(){
  if(document.getElementById("monthlyPlanHomeBtn"))return;
  const imp=document.getElementById("budgetImportHomeBtn");
  if(!imp||!imp.parentNode)return;
  const btn=document.createElement("button");
  btn.type="button";
  btn.id="monthlyPlanHomeBtn";
  btn.className="fullBtn";
  btn.style.marginTop="8px";
  btn.textContent="📅 Voir budget du mois";
  btn.onclick=openMonthlyPlan;
  imp.parentNode.appendChild(btn);
}

function monthLabel(key){
  const m=/^(\d{4})-(\d{2})$/.exec(String(key||""));
  if(!m)return key||"Budget";
  return new Date(Number(m[1]),Number(m[2])-1,1).toLocaleDateString("fr-CA",{month:"long",year:"numeric"});
}
function monthlyPlanKeys(){return Object.keys(state.monthlyPlans||{}).sort()}
function nearestMonthlyPlanKey(){
  const keys=monthlyPlanKeys();if(!keys.length)return null;
  const cur=monthKey(today());
  return keys.find(k=>k>=cur)||keys[keys.length-1];
}
function operationalBillForPlanItem(item){
  return (state.bills||[]).find(b=>b.importedMonthlyPlan&&b.sourcePlanItemId===item.id&&!b.deletedAt)||null;
}
function operationalIncomeForPlanItem(item){
  return (state.incomeSchedules||[]).find(x=>x.importedMonthlyPlan&&x.sourcePlanItemId===item.id&&!x.deletedAt)||null;
}
function openMonthlyPlan(key=null){
  const keys=monthlyPlanKeys();
  if(!keys.length){
    openModal(`${modalHeader("📅 Budget du mois")}<div class="card"><strong>Aucun budget mensuel importé.</strong><div class="sub">Envoie-moi la photo du budget papier, puis colle ici le bloc que je te prépare avec le bouton « Importer un budget ».</div></div>`);
    return;
  }
  key=key&&state.monthlyPlans?.[key]?key:nearestMonthlyPlanKey();
  const plan=state.monthlyPlans[key]||{items:[]};
  const items=(plan.items||[]).slice().sort((a,b)=>String(a.date||"").localeCompare(String(b.date||"")));
  const income=items.filter(x=>x.kind==="income").reduce((a,x)=>a+Number(x.amount||0),0);
  const expense=items.filter(x=>x.kind==="expense").reduce((a,x)=>a+Number(x.amount||0),0);
  const carryover=items.filter(x=>x.kind==="carryover").reduce((a,x)=>a+Number(x.amount||0),0);
  const options=keys.map(k=>`<option value="${esc(k)}" ${k===key?"selected":""}>${esc(monthLabel(k))}</option>`).join("");
  const groups={};items.forEach(x=>(groups[x.date||`${key}-01`]=groups[x.date||`${key}-01`]||[]).push(x));
  const rows=Object.entries(groups).map(([date,list])=>{
    const body=list.map(x=>{
      if(x.kind==="income"){
        const sched=operationalIncomeForPlanItem(x),received=!!sched?.receivedAt;
        return `<div class="historyRow"><div class="historyMain"><div class="historyTitle">💵 ${esc(x.name)}</div><div class="sub">${received?"✅ Reçue":"Prévue · enregistrée au calendrier"}</div></div><div class="amount ${received?"okText":""}">+${money(x.amount)}</div>${sched&&!received?`<div class="rowActions"><button onclick="BP.receiveIncome('${sched.id}','${x.date}')">✅</button></div>`:""}</div>`;
      }
      if(x.kind==="expense"){
        const b=operationalBillForPlanItem(x),st=b?billStatus(b,x.date):{},paid=!!st.paidAt;
        const actual=paid?Number(st.paidAmount??x.amount):Number(x.amount||0);
        const changed=paid&&Math.abs(actual-Number(x.amount||0))>0.005;
        const sub=paid
          ? `${esc(x.category||"Dépense prévue")} · ✅ Payée${changed?` · prévu ${money(x.amount)} · réel ${money(actual)}`:""}`
          : `${esc(x.category||"Dépense prévue")} · À payer · montant prévu ${money(x.amount)}`;
        return `<div class="historyRow"><div class="historyMain"><div class="historyTitle">💸 ${esc(x.name)}</div><div class="sub">${sub}</div></div><div class="amount ${paid?"okText":""}">−${money(actual)}</div>${b&&!paid?`<div class="rowActions"><button onclick="BP.payBill('${b.id}','${x.date}')">✅</button></div>`:""}</div>`;
      }
      if(x.kind==="carryover")return `<div class="historyRow"><div class="historyMain"><div class="historyTitle">↩️ ${esc(x.label||x.name||"Retard reporté")}</div><div class="sub">Argent déjà manquant de la période précédente · pas un paiement</div></div><div class="amount">−${money(Math.abs(Number(x.amount||0)))}</div></div>`;
      if(x.kind==="remaining")return `<div class="historyRow"><div class="historyMain"><div class="historyTitle">💰 ${esc(x.label||"Restant prévu")}</div><div class="sub">Repère du budget papier</div></div><div class="amount">${money(x.amount)}</div></div>`;
      return `<div class="historyRow"><div class="historyMain"><div class="historyTitle">📝 ${esc(x.text||x.name||"Note")}</div><div class="sub">Note du budget</div></div></div>`;
    }).join("");
    return `<div class="card" style="margin-top:10px"><strong>${esc(fmtDate(date))}</strong>${body}</div>`;
  }).join("")||`<div class="card muted">Aucune ligne dans ce budget.</div>`;
  openModal(`${modalHeader("📅 Budget du mois")}
    <label>Mois<select id="monthlyPlanSelect">${options}</select></label>
    <div class="card"><div class="catTop"><span>Revenus prévus</span><strong>${money(income)}</strong></div><div class="catTop"><span>Dépenses prévues</span><strong>${money(expense)}</strong></div>${carryover?`<div class="catTop"><span>Retard reporté</span><strong>−${money(Math.abs(carryover))}</strong></div>`:""}<div class="catTop"><span>Écart prévu après retard</span><strong>${money(income-expense-carryover)}</strong></div><div class="sub" style="margin-top:6px">Les vraies dépenses du plan deviennent des paiements avec rappel et bouton ✅ Payé. Un « retard reporté » représente seulement de l'argent déjà manquant de la période précédente : il n'est jamais créé comme facture. Les paies prévues restent hors du solde jusqu'à ce que tu les marques reçues.</div></div>
    ${rows}`);
  const sel=document.getElementById("monthlyPlanSelect");if(sel)sel.onchange=e=>openMonthlyPlan(e.target.value);
}

function ensureBalanceTools(){
  if(document.getElementById("balanceTools"))return;
  const seed=document.getElementById("seedBtn");
  if(!seed||!seed.parentNode)return;
  const box=document.createElement("div");
  box.id="balanceTools";
  box.innerHTML=`
    <button type="button" id="nightBalanceBtn" class="fullBtn primary" style="margin-bottom:10px">🌙 Solde du soir</button>
    <button type="button" id="budgetImportBtn" class="fullBtn primary" style="margin-bottom:10px">📥 Importer un budget</button>
    <button type="button" id="monthlyPlanBtn" class="fullBtn" style="margin-bottom:10px">📅 Voir budget du mois</button>
    <button type="button" id="setCurrentBalanceBtn" class="fullBtn" style="margin-bottom:10px">💰 Définir le solde actuel</button>
    <button type="button" id="restartBudgetBtn" class="fullBtn" style="margin-bottom:10px">🔄 Repartir le budget à zéro</button>`;
  seed.parentNode.insertBefore(box,seed);
  document.getElementById("nightBalanceBtn").onclick=nightBalance;
  document.getElementById("budgetImportBtn").onclick=openBudgetImport;
  document.getElementById("monthlyPlanBtn").onclick=()=>openMonthlyPlan();
  document.getElementById("setCurrentBalanceBtn").onclick=setCurrentBalance;
  document.getElementById("restartBudgetBtn").onclick=restartBudget;
}

function todayMoneySummary(date=today()){
  const expenses=(state.transactions||[]).filter(t=>t.kind==="expense"&&t.date===date).reduce((s,t)=>s+Number(t.amount||0),0);
  const incomes=(state.transactions||[]).filter(t=>t.kind==="income"&&t.date===date).reduce((s,t)=>s+Number(t.amount||0),0);
  let bills=0;
  (state.bills||[]).forEach(b=>Object.values(b.statuses||{}).forEach(st=>{
    if((st.paidAt||"").slice(0,10)===date)bills+=Number(st.paidAmount??b.amount??0);
  }));
  return {expenses,incomes,bills};
}

function nightBalance(){
  const expected=Number(currentBalance().toFixed(2));
  const value=prompt(`🌙 SOLDE DU SOIR\n\nQuel est le solde exact dans ton compte présentement?\n\nSolde calculé par l'app : ${money(expected)}\nTu peux écrire un montant négatif, exemple : -250`,String(expected));
  if(value===null)return;
  const normalized=String(value).trim().replace(/\s/g,"").replace(",",".").replace("$","");
  const actual=Number(normalized);
  if(!Number.isFinite(actual))return toast("Entre un montant valide");

  const diff=Number((expected-actual).toFixed(2));
  const info=todayMoneySummary();

  if(Math.abs(diff)<0.01){
    toast("Solde déjà à jour ✅");
    return;
  }

  if(diff>0){
    const ok=confirm(`🌙 RÉSUMÉ DU JOUR\n\nSolde calculé : ${money(expected)}\nSolde réel : ${money(actual)}\n\nDépenses déjà entrées : ${money(info.expenses)}\nFactures marquées payées : ${money(info.bills)}\nRevenus entrés : ${money(info.incomes)}\n\n👉 Dépenses non entrées détectées : ${money(diff)}\n\nAjouter automatiquement ${money(diff)} dans l'historique comme « Dépenses du jour » ?`);
    if(!ok)return;
    state.transactions.unshift({
      id:uid("tx"),kind:"expense",amount:diff,merchant:"Dépenses du jour (solde du soir)",category:"Autre",date:today(),needFun:"",memberName:profile.memberName||"Moi",
      note:`Ajustement automatique du solde du soir. Solde prévu ${money(expected)} → solde réel ${money(actual)}.`,createdAt:nowIso(),updatedAt:nowIso()
    });
    saveState();
    toast(`Solde du soir enregistré · ${money(diff)} de dépenses ✅`);
    return;
  }

  const gain=Math.abs(diff);
  const ok=confirm(`🌙 SOLDE PLUS HAUT QUE PRÉVU\n\nSolde calculé : ${money(expected)}\nSolde réel : ${money(actual)}\n\nIl y a ${money(gain)} de plus que prévu. Ça peut être une paie, un remboursement ou un dépôt non entré.\n\nAjouter ${money(gain)} comme ajustement de revenu pour remettre le budget au bon solde ?`);
  if(!ok)return;
  state.transactions.unshift({
    id:uid("tx"),kind:"income",amount:gain,name:"Ajustement solde du soir",date:today(),memberName:profile.memberName||"Moi",
    note:`Ajustement automatique du solde du soir. Solde prévu ${money(expected)} → solde réel ${money(actual)}.`,createdAt:nowIso(),updatedAt:nowIso()
  });
  saveState();
  toast(`Solde du soir ajusté de +${money(gain)} ✅`);
}



// ----- Correction anciens plans : « Retard » = déficit reporté, jamais une facture -----
function migrateLegacyPlanRetards(){
  let changed=false;
  state.monthlyPlans=state.monthlyPlans||{};
  Object.values(state.monthlyPlans).forEach(plan=>{
    (plan?.items||[]).forEach(item=>{
      if(item?.kind!=="expense"||!isPlanCarryoverName(item.name))return;
      item.kind="carryover";
      item.label=item.label||item.name||"Retard reporté";
      delete item.category;
      item.updatedAt=nowIso();
      (state.bills||[]).forEach(b=>{
        if(!b.importedMonthlyPlan||b.sourcePlanItemId!==item.id||b.deletedAt)return;
        const paid=Object.values(b.statuses||{}).some(st=>st?.paidAt);
        if(!paid){b.active=false;b.deletedAt=nowIso();b.updatedAt=nowIso()}
      });
      changed=true;
    });
  });
  if(changed){state.updatedAt=nowIso();localStorage.setItem(LS_KEY,JSON.stringify(state))}
  return changed;
}

// ----- Correction du plan du 1er octobre 2026 -----
// Sur la feuille papier : Frank finit à +60 $, Mari finit à -217 $ (arrondi à -220 $),
// puis le restant familial est d'environ -160 $. Le 220 $ n'est PAS une dépense à payer.
function migrateOct2026CombinedRemainders(){
  const plan=state.monthlyPlans?.["2026-10"];
  if(!plan?.items?.length)return false;
  const items=plan.items;
  let changed=false;

  const sameDay=x=>x?.date==="2026-10-01";
  const norm=x=>importName(x||"");
  const approx=(a,b)=>Math.abs(Number(a||0)-Number(b||0))<0.01;
  const isMistaken220=x=>sameDay(x)&&x.kind==="expense"&&approx(x.amount,220)&&(
    norm(x.name).includes("depense a identifier") ||
    norm(x.name).includes("depense a id") ||
    norm(x.name)==="depense"
  );

  // Le 220 $ de la feuille n'était pas une dépense : c'était l'arrondi du -217 $ de Mari.
  // On retire toutes les anciennes versions de ce faux paiement et leur rappel opérationnel.
  const bad220=items.filter(isMistaken220);
  bad220.forEach(item=>{
    (state.bills||[]).forEach(b=>{
      if(!b.importedMonthlyPlan||b.sourcePlanItemId!==item.id||b.deletedAt)return;
      const paid=Object.values(b.statuses||{}).some(st=>st?.paidAt);
      if(!paid){b.active=false;b.deletedAt=nowIso();b.updatedAt=nowIso()}
    });
  });
  if(bad220.length){
    plan.items=plan.items.filter(x=>!bad220.includes(x));
    changed=true;
  }

  let list=plan.items;

  // Corrige les vieux libellés sans transformer à répétition les bons repères.
  list.forEach(x=>{
    if(!sameDay(x)||x.kind!=="remaining")return;
    const label=norm(x.label);
    if(label.includes("restant frank")&&approx(x.amount,-160)){
      x.label="Restant familial (arrondi feuille)";x.updatedAt=nowIso();changed=true;
    }
    if(label.includes("restant mari")&&approx(x.amount,-160)){
      x.label="Restant familial (arrondi feuille)";x.updatedAt=nowIso();changed=true;
    }
  });

  const canonicalKind=x=>{
    if(!sameDay(x)||x.kind!=="remaining")return null;
    const label=norm(x.label);
    if(label.includes("restant frank")&&approx(x.amount,60))return "frank";
    if(label.includes("restant mari")&&approx(x.amount,-217))return "mari";
    if(label.includes("restant familial")&&approx(x.amount,-160))return "family";
    return null;
  };

  // Supprime les doublons créés par l'ancienne migration (un seul Frank, Mari et familial).
  const seen=new Set();
  const cleaned=[];
  list.forEach(x=>{
    const k=canonicalKind(x);
    if(k&&seen.has(k)){changed=true;return}
    if(k)seen.add(k);
    cleaned.push(x);
  });
  if(cleaned.length!==list.length)plan.items=cleaned;
  list=plan.items;

  const maxOtherLine=Math.max(0,...list.filter(x=>sameDay(x)&&!canonicalKind(x)).map((x,i)=>Number(x.line||i+1)));
  const ensureMarker=(kind,amount,label,line)=>{
    let item=list.find(x=>canonicalKind(x)===kind);
    if(!item){
      item={id:uid("plan"),type:"plan",kind:"remaining",date:"2026-10-01",amount,label,line,createdAt:nowIso(),updatedAt:nowIso()};
      list.push(item);changed=true;
    }
    const before=JSON.stringify([item.type,item.kind,item.date,item.amount,item.label,item.line]);
    Object.assign(item,{type:"plan",kind:"remaining",date:"2026-10-01",amount,label,line});
    const after=JSON.stringify([item.type,item.kind,item.date,item.amount,item.label,item.line]);
    if(before!==after){item.updatedAt=nowIso();changed=true}
    return item;
  };

  ensureMarker("frank",60,"Restant Frank",maxOtherLine+1);
  ensureMarker("mari",-217,"Restant Mari",maxOtherLine+2);
  ensureMarker("family",-160,"Restant familial (arrondi feuille)",maxOtherLine+3);

  if(changed){
    plan.updatedAt=nowIso();
    state.updatedAt=nowIso();
    localStorage.setItem(LS_KEY,JSON.stringify(state));
  }
  return changed;
}

// ----- Liaison automatique Budget du mois -> factures / paies -----
function nextMonthStart(key){
  const m=/^(\d{4})-(\d{2})$/.exec(String(key||""));if(!m)return null;
  const d=new Date(Number(m[1]),Number(m[2]),1);return isoDate(d);
}
function clearMonthlyPlanCoverage(month){
  let changed=false;
  (state.bills||[]).forEach(b=>{
    Object.keys(b.statuses||{}).forEach(due=>{
      const st=b.statuses[due];
      if(st?.coveredByMonthlyPlan===month){
        const copy={...st};
        if(copy.planSnoozedUntil&&copy.snoozedUntil===copy.planSnoozedUntil)delete copy.snoozedUntil;
        delete copy.planSnoozedUntil;delete copy.coveredByMonthlyPlan;delete copy.coveredByPlanItemId;
        if(!Object.keys(copy).length)delete b.statuses[due];else b.statuses[due]=copy;
        b.updatedAt=nowIso();changed=true;
      }
    });
  });
  (state.incomeSchedules||[]).forEach(x=>{
    if(!x.coveredDates)return;
    Object.keys(x.coveredDates).forEach(date=>{if(x.coveredDates[date]===month){delete x.coveredDates[date];x.updatedAt=nowIso();changed=true}});
  });
  return changed;
}
function coverRecurringTemplateForPlanItem(item,month){
  const planName=importName(item.name);
  const templates=(state.bills||[]).filter(b=>{
    if(b.deletedAt||b.importedMonthlyPlan||b.frequency==="one")return false;
    const billName=importName(b.name);
    if(!billName||!planName)return false;
    return billName===planName || planName.includes(billName) || billName.includes(planName);
  });
  if(!templates.length)return false;
  let changed=false;
  templates.forEach(template=>{
    let due="";
    if(template.frequency==="monthly")due=monthlyDate(Number(month.slice(0,4)),Number(month.slice(5,7)),template.dueDay||1);
    else if(template.frequency==="weekly")due=item.date;
    if(!due)return;
    template.statuses=template.statuses||{};
    const old=template.statuses[due]||{}, until=nextMonthStart(month);
    if(old.coveredByMonthlyPlan===month&&old.coveredByPlanItemId===item.id&&old.planSnoozedUntil===until)return;
    template.statuses[due]={...old,coveredByMonthlyPlan:month,coveredByPlanItemId:item.id,planSnoozedUntil:until,snoozedUntil:old.snoozedUntil&&old.snoozedUntil>until?old.snoozedUntil:until,updatedAt:nowIso()};
    template.updatedAt=nowIso();
    changed=true;
  });
  return changed;
}
function coverRecurringIncomeForPlanItem(item,month){
  const candidates=(state.incomeSchedules||[]).filter(x=>!x.deletedAt&&!x.importedMonthlyPlan&&x.active!==false&&x.frequency!=="one");
  const matches=candidates.filter(x=>incomeOccurrences(x,item.date,item.date).includes(item.date));
  if(!matches.length)return false;
  const exact=matches.find(x=>Math.abs(Number(x.amount||0)-Number(item.amount||0))<0.005&&x.amount!=null);
  const generic=matches.find(x=>x.amount==null);
  const sched=exact||generic||matches.find(x=>importName(x.name)===importName(item.name));
  if(!sched)return false;
  sched.coveredDates=sched.coveredDates||{};
  if(sched.coveredDates[item.date]===month)return false;
  sched.coveredDates[item.date]=month;sched.updatedAt=nowIso();return true;
}
function removeUnfinishedOperationalForPlanMonth(month){
  let changed=false;
  (state.bills||[]).forEach(b=>{
    if(!b.importedMonthlyPlan||b.sourcePlanMonth!==month||b.deletedAt)return;
    const hasPaid=Object.values(b.statuses||{}).some(st=>st?.paidAt);
    if(!hasPaid){b.active=false;b.deletedAt=nowIso();b.updatedAt=nowIso();changed=true}
  });
  (state.incomeSchedules||[]).forEach(x=>{
    if(!x.importedMonthlyPlan||x.sourcePlanMonth!==month||x.deletedAt)return;
    if(!x.receivedAt){x.active=false;x.deletedAt=nowIso();x.updatedAt=nowIso();changed=true}
  });
  if(clearMonthlyPlanCoverage(month))changed=true;
  return changed;
}
function syncMonthlyPlanToOperational(month){
  const plan=state.monthlyPlans?.[month];if(!plan)return 0;
  state.bills=state.bills||[];state.incomeSchedules=state.incomeSchedules||[];
  let changed=0;
  (plan.items||[]).forEach(item=>{
    if(item.kind==="expense"){
      let b=(state.bills||[]).find(x=>x.importedMonthlyPlan&&x.sourcePlanItemId===item.id&&!x.deletedAt);
      if(!b){
        b={id:uid("bill"),name:item.name||"Dépense prévue",amount:Number(item.amount||0),dueDay:Number(String(item.date).slice(8,10))||1,dueDate:item.date,startDate:item.date,category:item.category||"Autre",frequency:"one",variable:false,autopay:false,active:true,statuses:{},activeFrom:item.date,importedMonthlyPlan:true,sourcePlanMonth:month,sourcePlanItemId:item.id,createdAt:nowIso(),updatedAt:nowIso()};
        state.bills.push(b);changed++;
      }else{
        const before=JSON.stringify([b.name,b.amount,b.dueDate,b.category,b.active]);
        Object.assign(b,{name:item.name||b.name,amount:Number(item.amount||0),dueDay:Number(String(item.date).slice(8,10))||1,dueDate:item.date,startDate:item.date,category:item.category||"Autre",frequency:"one",active:true,activeFrom:item.date,updatedAt:nowIso()});
        if(before!==JSON.stringify([b.name,b.amount,b.dueDate,b.category,b.active]))changed++;
      }
      if(coverRecurringTemplateForPlanItem(item,month))changed++;
    }else if(item.kind==="income"){
      let inc=(state.incomeSchedules||[]).find(x=>x.importedMonthlyPlan&&x.sourcePlanItemId===item.id&&!x.deletedAt);
      if(!inc){
        state.incomeSchedules.push({id:uid("inc"),name:item.name||"Revenu prévu",frequency:"one",dueDate:item.date,amount:Number(item.amount||0),active:true,importedMonthlyPlan:true,sourcePlanMonth:month,sourcePlanItemId:item.id,createdAt:nowIso(),updatedAt:nowIso()});changed++;
      }else{
        const before=JSON.stringify([inc.name,inc.amount,inc.dueDate,inc.frequency,inc.active]);
        inc.name=item.name||inc.name;inc.amount=Number(item.amount||0);inc.dueDate=item.date;inc.frequency="one";inc.active=!inc.receivedAt;
        const after=JSON.stringify([inc.name,inc.amount,inc.dueDate,inc.frequency,inc.active]);
        if(before!==after){inc.updatedAt=nowIso();changed++}
      }
      if(coverRecurringIncomeForPlanItem(item,month))changed++;
    }
  });
  plan.operationalLinkedAt=nowIso();plan.updatedAt=nowIso();
  return changed;
}
function migrateMonthlyPlansToOperational(){
  let changed=0;
  state.monthlyPlans=state.monthlyPlans||{};
  Object.keys(state.monthlyPlans).forEach(month=>{changed+=syncMonthlyPlanToOperational(month)});
  if(changed){state.updatedAt=nowIso();localStorage.setItem(LS_KEY,JSON.stringify(state))}
  return changed;
}
function receiveIncome(id,date){
  const sched=(state.incomeSchedules||[]).find(x=>x.id===id);if(!sched)return;
  if(sched.receivedAt)return toast("Paie déjà reçue ✅");
  const suggested=Number(sched.amount||0);
  const raw=prompt(`Montant reçu pour ${sched.name}`,String(suggested));if(raw===null)return;
  const amount=importTextMoney(raw);if(!Number.isFinite(amount)||amount<0)return toast("Entre un montant valide");
  const exists=(state.transactions||[]).some(t=>t.kind==="income"&&t.sourceIncomeScheduleId===sched.id);
  if(!exists)state.transactions.unshift({id:uid("tx"),kind:"income",amount,date:date||sched.dueDate||today(),name:sched.name,memberName:profile.memberName||"Moi",note:"Paie reçue depuis le budget du mois",sourceIncomeScheduleId:sched.id,createdAt:nowIso(),updatedAt:nowIso()});
  sched.receivedAt=nowIso();sched.receivedAmount=amount;sched.active=false;sched.updatedAt=nowIso();saveState();toast("Paie marquée reçue 💵");
}

// ----- Import budget depuis ChatGPT / photo mise au propre -----
function importTextMoney(v){
  const s=String(v??"").trim().replace(/\s/g,"").replace(/\$/g,"").replace(",",".");
  const n=Number(s);return Number.isFinite(n)?n:NaN;
}
function importKey(v){
  return String(v??"").trim().normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/[\s-]+/g,"_");
}
function importName(v){
  return String(v??"").trim().normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/\s+/g," ");
}
function isPlanCarryoverName(v){
  const n=importName(v).replace(/[._-]+/g," ").replace(/\s+/g," ").trim();
  return n==="retard"||n==="retard reporte"||n==="deficit reporte"||n==="report de retard";
}
function validImportDate(v){return /^\d{4}-\d{2}-\d{2}$/.test(String(v||""))}
function findBillByImportName(name){return (state.bills||[]).find(b=>!b.deletedAt&&importName(b.name)===importName(name))||null}
function transactionLooksDuplicate(item){
  return (state.transactions||[]).some(t=>{
    if(t.kind!==item.kind||t.date!==item.date||Math.abs(Number(t.amount||0)-Number(item.amount||0))>0.005)return false;
    const a=item.kind==="expense"?(t.merchant||""):(t.name||"");
    const b=item.kind==="expense"?(item.merchant||""):(item.name||"");
    return importName(a)===importName(b);
  });
}
function parseBudgetImport(text){
  const lines=String(text||"").split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const out={date:today(),items:[],warnings:[],errors:[],planMonth:null};
  lines.forEach((line,idx)=>{
    if(line.startsWith("#")||line.startsWith("//"))return;
    const p=line.split("|").map(x=>x.trim()), type=importKey(p[0]);
    if(type==="BUDGETMOIS"||type==="BUDGET_MOIS"){
      if(/^\d{4}-\d{2}$/.test(p[1]||""))out.planMonth=p[1];
      else out.errors.push(`Ligne ${idx+1}: mois invalide. Utilise AAAA-MM.`);
      return;
    }
    if(type==="BUDGETPACK"||type==="BUDGET_PACK"){
      if(p[1]&&validImportDate(p[1]))out.date=p[1];
      else if(p[1])out.warnings.push(`Ligne ${idx+1}: date d'en-tête ignorée.`);
      return;
    }
    if(type==="PLAN_REVENU"){
      const date=p[1],name=p[2]||"Revenu prévu",amount=importTextMoney(p[3]);
      if(!validImportDate(date)||!Number.isFinite(amount)||amount<0)out.errors.push(`Ligne ${idx+1}: revenu prévu invalide.`);
      else out.items.push({type:"plan",kind:"income",date,name,amount,line:idx+1});
      return;
    }
    if(type==="PLAN_RETARD"||type==="PLAN_REPORT"||type==="PLAN_DEFICIT"||type==="PLAN_DÉFICIT"){
      const date=p[1],amount=importTextMoney(p[2]),label=p[3]||"Retard reporté";
      if(!validImportDate(date)||!Number.isFinite(amount)||amount<0)out.errors.push(`Ligne ${idx+1}: retard reporté invalide.`);
      else out.items.push({type:"plan",kind:"carryover",date,amount,label,line:idx+1});
      return;
    }
    if(type==="PLAN_DEPENSE"||type==="PLAN_DÉPENSE"){
      const date=p[1],name=p[2]||"Dépense prévue",amount=importTextMoney(p[3]),category=p[4]||"Autre";
      if(!validImportDate(date)||!Number.isFinite(amount)||amount<0)out.errors.push(`Ligne ${idx+1}: dépense prévue invalide.`);
      else if(isPlanCarryoverName(name))out.items.push({type:"plan",kind:"carryover",date,amount,label:name||"Retard reporté",line:idx+1});
      else out.items.push({type:"plan",kind:"expense",date,name,amount,category,line:idx+1});
      return;
    }
    if(type==="PLAN_RESTANT"||type==="PLAN_SOLDE"){
      const date=p[1],amount=importTextMoney(p[2]),label=p[3]||"Restant prévu";
      if(!validImportDate(date)||!Number.isFinite(amount))out.errors.push(`Ligne ${idx+1}: restant prévu invalide.`);
      else out.items.push({type:"plan",kind:"remaining",date,amount,label,line:idx+1});
      return;
    }
    if(type==="PLAN_NOTE"){
      const date=p[1],text=p.slice(2).join(" | ").trim();
      if(!validImportDate(date)||!text)out.errors.push(`Ligne ${idx+1}: note prévue invalide.`);
      else out.items.push({type:"plan",kind:"note",date,text,line:idx+1});
      return;
    }
    if(type==="SOLDE"){
      const amount=importTextMoney(p[1]);
      if(!Number.isFinite(amount))out.errors.push(`Ligne ${idx+1}: solde invalide.`);
      else out.items.push({type:"balance",amount,line:idx+1});
      return;
    }
    if(type==="REVENU"||type==="PAIE"){
      const name=p[1]||"Revenu", amount=importTextMoney(p[2]), date=validImportDate(p[3])?p[3]:out.date;
      if(!Number.isFinite(amount)||amount<0)out.errors.push(`Ligne ${idx+1}: revenu invalide.`);
      else out.items.push({type:"income",kind:"income",name,amount,date,line:idx+1});
      return;
    }
    if(type==="DEPENSE"||type==="DÉPENSE"){
      const category=p[1]||"Autre", merchant=p[2]||category||"Dépense", amount=importTextMoney(p[3]), date=validImportDate(p[4])?p[4]:out.date;
      if(!Number.isFinite(amount)||amount<0)out.errors.push(`Ligne ${idx+1}: dépense invalide.`);
      else out.items.push({type:"expense",kind:"expense",category,merchant,amount,date,line:idx+1});
      return;
    }
    if(type==="FACTURE"){
      const name=p[1], amount=importTextMoney(p[2]), rawDue=p[3]||"1", frequency=importKey(p[4]||"monthly").toLowerCase();
      if(!name||!Number.isFinite(amount)||amount<0){out.errors.push(`Ligne ${idx+1}: facture invalide.`);return}
      const dueDate=validImportDate(rawDue)?rawDue:"";
      const dueDay=dueDate?Number(dueDate.slice(8,10)):Math.max(1,Math.min(31,Number(rawDue)||1));
      const freq=["monthly","weekly","one"].includes(frequency)?frequency:(dueDate?"one":"monthly");
      out.items.push({type:"bill",name,amount,dueDay,dueDate,frequency:freq,line:idx+1});
      return;
    }
    if(type==="FACTURE_PAYEE"||type==="FACTURE_PAYÉE"||type==="PAIEMENT_FACTURE"){
      const name=p[1], amount=importTextMoney(p[2]), paidDate=validImportDate(p[3])?p[3]:out.date, dueDate=validImportDate(p[4])?p[4]:paidDate;
      if(!name||!Number.isFinite(amount)||amount<0)out.errors.push(`Ligne ${idx+1}: facture payée invalide.`);
      else out.items.push({type:"paidBill",name,amount,date:paidDate,dueDate,line:idx+1});
      return;
    }
    out.warnings.push(`Ligne ${idx+1} ignorée: ${p[0]||"inconnue"}.`);
  });
  const plans=out.items.filter(x=>x.type==="plan");
  if(plans.length&&!out.planMonth)out.errors.push("Ajoute BUDGETMOIS|AAAA-MM au début du budget mensuel.");
  if(!out.items.length&&!out.errors.length)out.errors.push("Aucune donnée reconnue à importer.");
  return out;
}
function budgetImportItemStatus(item){
  if(item.type==="plan"&&item.kind==="expense")return "Sera créée automatiquement comme paiement à la bonne date";
  if(item.type==="plan"&&item.kind==="income")return "Sera ajoutée au calendrier; tu la confirmeras reçue";
  if(item.type==="plan"&&item.kind==="carryover")return "Retard reporté seulement — aucun paiement ni rappel ne sera créé";
  if(item.type==="plan")return "Repère du budget mensuel";
  if(item.type==="income"||item.type==="expense")return transactionLooksDuplicate(item)?"Déjà présente — ignorée":"Sera ajoutée";
  if(item.type==="balance")return `Solde final sera ajusté à ${money(item.amount)}`;
  if(item.type==="bill")return findBillByImportName(item.name)?"Facture existante — sera mise à jour":"Nouvelle facture — sera ajoutée";
  if(item.type==="paidBill"){
    const b=findBillByImportName(item.name), st=b?.statuses?.[item.dueDate];
    return st?.paidAt?"Déjà marquée payée — ignorée":(b?"Facture existante — sera marquée payée":"Facture absente — sera créée puis marquée payée");
  }
  return "Prête";
}
function budgetImportItemHtml(item){
  let title="",sub="";
  if(item.type==="plan"&&item.kind==="income"){title=`📅 💵 ${esc(item.name)} · +${money(item.amount)}`;sub=`Prévu · ${esc(fmtDate(item.date))}`}
  else if(item.type==="plan"&&item.kind==="expense"){title=`📅 💸 ${esc(item.name)} · −${money(item.amount)}`;sub=`${esc(item.category||"Autre")} · ${esc(fmtDate(item.date))}`}
  else if(item.type==="plan"&&item.kind==="carryover"){title=`📅 ↩️ ${esc(item.label||"Retard reporté")} · −${money(Math.abs(Number(item.amount||0)))}`;sub=`Déficit de la période précédente · ${esc(fmtDate(item.date))}`}
  else if(item.type==="plan"&&item.kind==="remaining"){title=`📅 💰 ${esc(item.label||"Restant prévu")} · ${money(item.amount)}`;sub=`Repère · ${esc(fmtDate(item.date))}`}
  else if(item.type==="plan"&&item.kind==="note"){title=`📅 📝 ${esc(item.text)}`;sub=`Note · ${esc(fmtDate(item.date))}`}
  else if(item.type==="income"){title=`💵 ${esc(item.name)} · +${money(item.amount)}`;sub=fmtDate(item.date)}
  else if(item.type==="expense"){title=`💸 ${esc(item.merchant)} · −${money(item.amount)}`;sub=`${esc(item.category)} · ${fmtDate(item.date)}`}
  else if(item.type==="balance"){title=`💰 Solde final · ${money(item.amount)}`;sub="Ajustement appliqué après le reste"}
  else if(item.type==="bill"){title=`🧾 ${esc(item.name)} · ${money(item.amount)}`;sub=`${item.frequency==="monthly"?`Mensuelle · jour ${item.dueDay}`:item.frequency==="weekly"?"Hebdomadaire":`Une fois${item.dueDate?` · ${esc(item.dueDate)}`:""}`}`}
  else if(item.type==="paidBill"){title=`✅ ${esc(item.name)} · ${money(item.amount)}`;sub=`Payée le ${esc(item.date)}`}
  return `<div class="card" style="margin-top:8px"><strong>${title}</strong><div class="sub">${sub}</div><div class="sub">${esc(budgetImportItemStatus(item))}</div></div>`;
}
function openBudgetImport(){
  openModal(`${modalHeader("📥 Importer un budget")}<form id="budgetImportForm">
    <p class="muted small">Colle ici le bloc que ChatGPT t'a préparé après la photo. Après confirmation, les vraies dépenses du BUDGETMOIS deviennent automatiquement des paiements avec la bonne date, rappel et bouton ✅ Payé. Les lignes « Retard » sont gardées comme déficit reporté seulement : aucun paiement n'est créé. Les paies prévues vont au calendrier et n'augmentent le solde qu'une fois marquées reçues.</p>
    <label>Budget à importer<textarea id="budgetImportText" rows="12" style="width:100%;min-height:220px" placeholder="BUDGETMOIS|2026-10\nPLAN_REVENU|2026-10-01|Ma paie|760\nPLAN_DEPENSE|2026-10-01|Épicerie|300|Épicerie\nPLAN_RESTANT|2026-10-01|-160|Restant prévu\nPLAN_NOTE|2026-10-13|Prévoir argent pour le permis"></textarea></label>
    <button class="fullBtn primary" type="submit">🔎 Vérifier avant d'importer</button>
    <div id="budgetImportPreview" style="margin-top:12px"></div>
  </form>`);
  document.getElementById("budgetImportForm").onsubmit=e=>{
    e.preventDefault();
    const parsed=parseBudgetImport(document.getElementById("budgetImportText").value);
    renderBudgetImportPreview(parsed);
  };
}
function renderBudgetImportPreview(parsed){
  const host=document.getElementById("budgetImportPreview");if(!host)return;
  const errs=parsed.errors.length?`<div class="card"><strong class="dangerText">⚠️ À corriger</strong><div class="sub">${parsed.errors.map(esc).join("<br>")}</div></div>`:"";
  const warns=parsed.warnings.length?`<div class="card"><strong class="warnText">À vérifier</strong><div class="sub">${parsed.warnings.map(esc).join("<br>")}</div></div>`:"";
  const items=parsed.items.map(budgetImportItemHtml).join("");
  const dup=parsed.items.filter(x=>(x.type==="income"||x.type==="expense")&&transactionLooksDuplicate(x)).length;
  const planCount=parsed.items.filter(x=>x.type==="plan").length;
  const planMsg=planCount&&parsed.planMonth?`<div class="card"><strong>📅 ${esc(monthLabel(parsed.planMonth))}</strong><div class="sub">${planCount} ligne(s) de prévision. ${state.monthlyPlans?.[parsed.planMonth]?"Le plan déjà enregistré pour ce mois sera remplacé.":"Un nouveau plan mensuel sera créé."} Les dépenses seront aussi créées comme paiements datés; elles ne réduisent le solde que lorsque tu les marques payées.</div></div>`:"";
  host.innerHTML=`${errs}${warns}${planMsg}<div class="card"><strong>Aperçu</strong><div class="sub">${parsed.items.length} élément(s) reconnu(s)${dup?` · ${dup} doublon(s) seront ignorés`:""}. Aucune donnée existante ne sera supprimée, sauf qu'un BUDGETMOIS remplace uniquement le plan du même mois.</div></div>${items}${parsed.errors.length?"":`<button type="button" id="confirmBudgetImportBtn" class="fullBtn primary" style="margin-top:12px">✅ Confirmer l'import</button>`}`;
  const btn=document.getElementById("confirmBudgetImportBtn");if(btn)btn.onclick=()=>applyBudgetImport(parsed);
}
function applyBudgetImport(parsed){
  if(!parsed||parsed.errors?.length)return toast("Corrige les erreurs avant d'importer");
  let added=0,updated=0,skipped=0,balanceItem=null,planSaved=0;
  const planItems=parsed.items.filter(x=>x.type==="plan");
  if(planItems.length&&parsed.planMonth){
    state.monthlyPlans=state.monthlyPlans||{};
    removeUnfinishedOperationalForPlanMonth(parsed.planMonth);
    state.monthlyPlans[parsed.planMonth]={month:parsed.planMonth,items:planItems.map(x=>({...x,id:uid("plan")})),updatedAt:nowIso()};
    planSaved=planItems.length;
    syncMonthlyPlanToOperational(parsed.planMonth);
  }
  parsed.items.forEach(item=>{
    if(item.type==="plan")return;
    if(item.type==="balance"){balanceItem=item;return}
    if(item.type==="income"||item.type==="expense"){
      if(transactionLooksDuplicate(item)){skipped++;return}
      if(item.type==="income")state.transactions.unshift({id:uid("tx"),kind:"income",amount:item.amount,date:item.date,name:item.name,memberName:profile.memberName||"Moi",note:"Import Budget Pack depuis ChatGPT",createdAt:nowIso(),updatedAt:nowIso()});
      else state.transactions.unshift({id:uid("tx"),kind:"expense",amount:item.amount,merchant:item.merchant,category:item.category||"Autre",date:item.date,needFun:"",memberName:profile.memberName||"Moi",note:"Import Budget Pack depuis ChatGPT",createdAt:nowIso(),updatedAt:nowIso()});
      added++;return;
    }
    if(item.type==="bill"){
      let b=findBillByImportName(item.name);
      if(b){
        b.name=item.name;b.amount=item.amount;b.frequency=item.frequency;b.dueDay=item.dueDay;b.variable=!!b.variable;b.active=true;delete b.deletedAt;delete b.endedAt;
        if(item.dueDate){b.dueDate=item.dueDate;b.startDate=item.dueDate}
        b.updatedAt=nowIso();updated++;
      }else{
        b={id:uid("bill"),name:item.name,amount:item.amount,dueDay:item.dueDay,category:"Facture",frequency:item.frequency,variable:false,autopay:false,active:true,statuses:{},createdAt:nowIso(),updatedAt:nowIso(),activeFrom:item.dueDate||today()};
        if(item.dueDate){b.dueDate=item.dueDate;b.startDate=item.dueDate}
        state.bills.push(b);added++;
      }
      return;
    }
    if(item.type==="paidBill"){
      let b=findBillByImportName(item.name);
      if(!b){
        b={id:uid("bill"),name:item.name,amount:item.amount,dueDay:Number(item.dueDate.slice(8,10))||1,dueDate:item.dueDate,startDate:item.dueDate,category:"Facture",frequency:"one",variable:false,autopay:false,active:true,statuses:{},activeFrom:item.dueDate,createdAt:nowIso(),updatedAt:nowIso()};
        state.bills.push(b);added++;
      }
      b.statuses=b.statuses||{};
      if(b.statuses[item.dueDate]?.paidAt){skipped++;return}
      b.statuses[item.dueDate]={...(b.statuses[item.dueDate]||{}),paidAt:`${item.date}T12:00:00`,paidAmount:item.amount,paidBy:profile.memberName||"Moi",updatedAt:nowIso()};
      b.updatedAt=nowIso();updated++;
    }
  });
  if(balanceItem){
    const before=currentBalance();
    state.settings.startBalance=Number(state.settings.startBalance||0)+(Number(balanceItem.amount)-before);
    touchSettings();updated++;
  }
  saveState();closeModal();
  const bits=[];if(planSaved)bits.push(`${planSaved} prévision(s)`);if(added)bits.push(`${added} ajouté(s)`);if(updated)bits.push(`${updated} mis à jour`);if(skipped)bits.push(`${skipped} ignoré(s)`);
  toast(`Import terminé ✅ ${bits.join(" · ")||"OK"}`);
}

function replaceDisplayedBalance(target){
  const before=currentBalance();
  state.settings.startBalance=Number(state.settings.startBalance||0)+(Number(target)-before);
  touchSettings();
  saveState();
}

function setCurrentBalance(){
  const value=prompt("Quel est le solde exact dans ton compte présentement?\n\nTu peux écrire un montant négatif, exemple : -250",String(Number(currentBalance().toFixed(2))));
  if(value===null)return;
  const normalized=String(value).trim().replace(/\s/g,"").replace(",",".").replace("$","");
  const amount=Number(normalized);
  if(!Number.isFinite(amount))return toast("Entre un montant valide");
  if(!confirm(`Remplacer le solde affiché par ${money(amount)}?\n\nLes factures, l'historique, le partage et les notifications restent intacts.`))return;
  replaceDisplayedBalance(amount);
  toast("Solde actuel défini ✅");
}

function restartBudget(){
  if(!confirm("Repartir le budget à 0,00 $ aujourd'hui?\n\nLes anciennes factures en retard disparaîtront. Tes factures, tes paies planifiées, ton historique, le partage et les notifications seront conservés."))return;
  if(!confirm("Dernière confirmation : mettre le disponible à 0,00 $ et repartir à partir d'aujourd'hui?"))return;
  state.settings.trackingStartDate=today();
  (state.bills||[]).forEach(b=>{if(!b.deletedAt){b.activeFrom=today();b.updatedAt=nowIso()}});
  replaceDisplayedBalance(0);
  toast("Budget reparti à zéro ✅");
}

function settingsChanged(){
  state.settings.startBalance=Number($("#startBalance").value||0);state.settings.startBalanceDate=$("#startBalanceDate").value||today();state.settings.overdraftLimit=Number($("#overdraftLimit").value||1000);state.settings.groceryBudget=Number($("#groceryBudget").value||0);state.settings.reminderHour=Math.max(0,Math.min(23,Number($("#reminderHour").value||9)));state.settings.sundayReminder=$("#sundayReminder").checked;state.settings.dayBeforeReminder=$("#dayBeforeReminder").checked;state.settings.lateReminder=$("#lateReminder").checked;state.settings.historyMonths=$("#historyMonths").value;touchSettings();saveState()
}
function goPage(id){$$(".page").forEach(p=>p.classList.toggle("active",p.id===id));$$(".bottomNav button").forEach(b=>b.classList.toggle("active",b.dataset.page===id));scrollTo(0,0)}
function add(kind){if(kind==="expense")expenseForm();else if(kind==="income"||kind==="over")incomeForm(kind);else if(kind==="bill")billForm();else if(kind==="goal")goalForm()}
function migrateTrackingStart(){
  let changed=false;
  state.settings=state.settings||{};
  if(!state.settings.trackingStartDate){
    state.settings.trackingStartDate=today();
    state.settings.updatedAt=nowIso();
    changed=true;
  }
  (state.bills||[]).forEach(b=>{
    if(!b.activeFrom){
      b.activeFrom=state.settings.trackingStartDate;
      b.updatedAt=nowIso();
      changed=true;
    }
  });
  if(changed)localStorage.setItem(LS_KEY,JSON.stringify(state));
}
function archiveOld(){ // Safe monthly summaries, then detail removal according to preference
  const hm=state.settings.historyMonths;if(hm==="always")return;
  const cutoff=new Date();cutoff.setMonth(cutoff.getMonth()-Number(hm||12));const cut=isoDate(cutoff);
  const old=state.transactions.filter(t=>t.date<cut);if(!old.length)return;
  const groups={};const ensure=k=>groups[k]||(groups[k]={income:0,expense:0,over:0,billAmount:0,billsPaid:0,categories:{}});
  old.forEach(t=>{const k=monthKey(t.date),g=ensure(k);g[t.kind]=(g[t.kind]||0)+Number(t.amount||0);if(t.kind==="expense")g.categories[t.category||"Autre"]=(g.categories[t.category||"Autre"]||0)+Number(t.amount||0)});
  state.bills.forEach(b=>Object.keys(b.statuses||{}).forEach(due=>{const st=b.statuses[due],pd=(st.paidAt||"").slice(0,10);if(pd&&pd<cut){const k=monthKey(pd),g=ensure(k),amt=Number(st.paidAmount??b.amount??0),cat=(b.category&&b.category!=="Facture")?b.category:"Factures";g.billAmount+=amt;g.billsPaid+=1;g.categories[cat]=(g.categories[cat]||0)+amt;delete b.statuses[due];b.updatedAt=nowIso()}}));
  Object.entries(groups).forEach(([k,v])=>state.archives[k]={...(state.archives[k]||{}),...v,archivedAt:nowIso()});
  state.transactions=state.transactions.filter(t=>t.date>=cut);localStorage.setItem(LS_KEY,JSON.stringify(state))
}

// ----- events -----
function on(id,event,handler){const el=$("#"+id);if(el)el.addEventListener(event,handler)}
document.addEventListener("click",e=>{
  const p=e.target.closest("[data-page]");if(p)goPage(p.dataset.page);
  const a=e.target.closest("[data-add]");if(a)add(a.dataset.add);
  const g=e.target.closest("[data-go]");if(g)goPage(g.dataset.go);
});
on("quickExpenseBtn","click",()=>expenseForm());on("addBillBtn","click",()=>billForm());on("affordBtn","click",afford);on("modalBackdrop","click",e=>{if(e.target.id==="modalBackdrop")closeModal()});
on("calendarRange","click",e=>{const b=e.target.closest("button");if(!b)return;calendarDays=Number(b.dataset.days);$$("#calendarRange button").forEach(x=>x.classList.toggle("active",x===b));renderCalendar()});
on("historyFilter","click",e=>{const b=e.target.closest("button");if(!b)return;historyFilter=b.dataset.filter;$$("#historyFilter button").forEach(x=>x.classList.toggle("active",x===b));renderHistory()});
on("prevMonth","click",()=>{summaryCursor.setMonth(summaryCursor.getMonth()-1);renderSummary()});on("nextMonth","click",()=>{summaryCursor.setMonth(summaryCursor.getMonth()+1);renderSummary()});
on("shareSummary","click",shareSummary);on("exportBtn","click",exportData);
["startBalance","startBalanceDate","overdraftLimit","groceryBudget","reminderHour","sundayReminder","dayBeforeReminder","lateReminder","historyMonths"].forEach(id=>on(id,"change",settingsChanged));
$$("[data-theme]").forEach(b=>b.onclick=()=>applyTheme(b.dataset.theme));
on("customAccent","change",e=>applyTheme("custom",e.target.value));
on("apiUrl","change",e=>{profile.apiUrl=e.target.value.trim();saveProfile()});on("memberName","change",e=>{profile.memberName=e.target.value.trim();saveProfile()});
on("oneSignalAppId","change",e=>{profile.oneSignalAppId=e.target.value.trim();saveProfile()});
on("createFamilyBtn","click",createFamily);on("joinFamilyBtn","click",joinFamily);on("leaveCloudBtn","click",leaveCloud);on("enablePushBtn","click",enablePush);
on("addCategoryBudgetBtn","click",addCategoryBudget);
on("seedBtn","click",()=>{if(confirm("Remettre les factures de départ? Ça n'efface pas tes dépenses.")){state.bills=seedBills();saveState();toast("Factures de départ remises")}});
on("importBtn","click",()=>$("#importFile")?.click());on("importFile","change",e=>e.target.files[0]&&importData(e.target.files[0]));

window.BP={close:closeModal,payBill,snooze,endBill,deleteBill,quickMerchant:s=>expenseForm(decodeURIComponent(s)),editBill:billForm,addGoalMoney,removeCategoryBudget,editHistory,openMonthlyPlan,receiveIncome};

initTheme();migrateTrackingStart();migrateLegacyPlanRetards();migrateOct2026CombinedRemainders();migrateMonthlyPlansToOperational();archiveOld();render();if("serviceWorker" in navigator)navigator.serviceWorker.register("sw.js").catch(()=>{});
if(profile.token)pullCloud();if(profile.oneSignalAppId)initOneSignal();
setInterval(()=>{if(profile.token&&document.visibilityState==="visible")pullCloud()},30000);
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="visible"&&profile.token)pullCloud()});
})();

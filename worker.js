// N'OUBLIE RIEN API V1 — partage + WIZZ + notifications de tâches terminées
const json=(data,status=200,extra={})=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","access-control-allow-origin":"*",...extra}});
const now=()=>new Date().toISOString();
const rand=(n=24)=>{const a=new Uint8Array(n);crypto.getRandomValues(a);return [...a].map(x=>x.toString(16).padStart(2,"0")).join("")};
const id=p=>`${p}_${rand(10)}`;
const hash=async s=>[...new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(s)))].map(x=>x.toString(16).padStart(2,"0")).join("");
const ONESIGNAL_APP_ID="4770a678-6329-4944-9d54-b01d0b14fc97";

async function auth(req,env){
  const raw=(req.headers.get("authorization")||"").replace(/^Bearer\s+/i,"");if(!raw)return null;
  const h=await hash(raw);
  return env.DB.prepare("SELECT m.*, f.join_code, f.timezone FROM members m JOIN families f ON f.id=m.family_id WHERE m.token_hash=?").bind(h).first()
}
async function sendPush(env,memberIds,title,message,url="/"){
  const ids=[...new Set((memberIds||[]).map(String).filter(Boolean))];
  if(!env.ONESIGNAL_REST_API_KEY||!ids.length)return false;
  const r=await fetch("https://api.onesignal.com/notifications",{method:"POST",headers:{"content-type":"application/json","authorization":`Key ${env.ONESIGNAL_REST_API_KEY}`},body:JSON.stringify({app_id:ONESIGNAL_APP_ID,include_aliases:{external_id:ids},target_channel:"push",headings:{fr:title,en:title},contents:{fr:message,en:message},url:env.APP_URL||url})});
  if(!r.ok)console.warn("OneSignal",r.status,await r.text().catch(()=>""));
  return r.ok
}
async function sendPushFilters(env,filters,title,message,url="/"){
  if(!env.ONESIGNAL_REST_API_KEY||!filters?.length)return false;
  const r=await fetch("https://api.onesignal.com/notifications",{method:"POST",headers:{"content-type":"application/json","authorization":`Key ${env.ONESIGNAL_REST_API_KEY}`},body:JSON.stringify({app_id:ONESIGNAL_APP_ID,filters,target_channel:"push",headings:{fr:title,en:title},contents:{fr:message,en:message},url:env.MISSION_APP_URL||url})});
  if(!r.ok)console.warn("OneSignal Mission Maison",r.status,await r.text().catch(()=>""));
  return r.ok
}
async function otherMemberIds(env,me,targetMemberId=""){
  const all=await env.DB.prepare("SELECT id FROM members WHERE family_id=? AND id<>?").bind(me.family_id,me.id).all();
  let ids=(all.results||[]).map(x=>String(x.id)).filter(Boolean);
  if(targetMemberId)ids=ids.filter(x=>x===String(targetMemberId));
  return ids
}
async function logOnce(env,familyId,key,fn){
  const found=await env.DB.prepare("SELECT id FROM reminder_log WHERE reminder_key=?").bind(key).first();if(found)return false;
  const ok=await fn();if(ok)await env.DB.prepare("INSERT OR IGNORE INTO reminder_log(id,family_id,reminder_key,sent_at) VALUES(?,?,?,?)").bind(id("rem"),familyId,key,now()).run();
  return !!ok
}
function hubTasks(data){return Array.isArray(data?.familyHubV1?.tasks)?data.familyHubV1.tasks:[]}
async function notifyNewTaskCompletions(env,me,oldData,newData){
  try{
    const oldMap=new Map(hubTasks(oldData).map(t=>[String(t.id),t]));
    const recipients=await otherMemberIds(env,me);
    if(!recipients.length)return;
    for(const t of hubTasks(newData)){
      if(!t?.id||!t.doneAt||t.deletedAt)continue;
      const old=oldMap.get(String(t.id));
      if(old?.doneAt)continue;
      const doneTs=Date.parse(t.doneAt);if(!Number.isFinite(doneTs)||Math.abs(Date.now()-doneTs)>30*60*1000)continue;
      const who=String(t.doneByName||me.name||"Quelqu’un").slice(0,60);
      const title=String(t.title||"une tâche").slice(0,120);
      const key=`${me.family_id}:hub-task-done:${t.id}:${t.doneAt}`;
      await logOnce(env,me.family_id,key,()=>sendPush(env,recipients,"Tâche terminée ✅",`${who} a terminé « ${title} »`,env.APP_URL||"/"));
    }
  }catch(e){console.warn("Hub task completion",e?.message||e)}
}

export default {
  async fetch(req,env){
    if(req.method==="OPTIONS")return new Response(null,{headers:{"access-control-allow-origin":"*","access-control-allow-headers":"authorization,content-type","access-control-allow-methods":"GET,POST,PUT,OPTIONS"}});
    const u=new URL(req.url),path=u.pathname;
    try{
      if(path==="/"||path==="/api/health")return json({ok:true,service:"N'OUBLIE RIEN API",time:now()});
      if(path==="/api/push-config"&&req.method==="GET")return json({appId:ONESIGNAL_APP_ID});

      if(path==="/api/family/create"&&req.method==="POST"){
        const b=await req.json(),familyId=id("fam"),memberId=id("mem"),token=rand(24),joinCode=Math.random().toString(36).slice(2,8).toUpperCase(),t=now();
        await env.DB.batch([
          env.DB.prepare("INSERT INTO families(id,name,join_code,timezone,data_json,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").bind(familyId,b.familyName||"N'OUBLIE RIEN",joinCode,b.timezone||"America/Toronto","{}",0,t,t),
          env.DB.prepare("INSERT INTO members(id,family_id,name,role,token_hash,created_at) VALUES(?,?,?,?,?,?)").bind(memberId,familyId,b.memberName||"Moi","owner",await hash(token),t)
        ]);
        return json({familyId,memberId,token,joinCode,version:0})
      }
      if(path==="/api/family/join"&&req.method==="POST"){
        const b=await req.json(),f=await env.DB.prepare("SELECT * FROM families WHERE join_code=?").bind(String(b.joinCode||"").trim().toUpperCase()).first();
        if(!f)return json({error:"Code famille introuvable"},404);
        const memberId=id("mem"),token=rand(24);
        await env.DB.prepare("INSERT INTO members(id,family_id,name,role,token_hash,created_at) VALUES(?,?,?,?,?,?)").bind(memberId,f.id,b.memberName||"Membre","member",await hash(token),now()).run();
        return json({familyId:f.id,memberId,token,joinCode:f.join_code})
      }

      const me=await auth(req,env);if(!me)return json({error:"Non autorisé"},401);

      // Conservé tel quel pour Mission Maison qui utilise déjà ce Worker.
      if(path==="/api/mission/task-finished"&&req.method==="POST"){
        const b=await req.json();
        const childName=String(b.childName||"Un enfant").slice(0,60),taskTitle=String(b.taskTitle||"une mission").slice(0,120);
        const filters=[
          {field:"tag",key:"mission_family",relation:"=",value:String(me.family_id)},
          {field:"tag",key:"mission_parent",relation:"=",value:"1"}
        ];
        const ok=await sendPushFilters(env,filters,"MISSION MAISON",`${childName} a terminé « ${taskTitle} » ✅`,env.MISSION_APP_URL||"/");
        return json({ok:true,sent:ok})
      }

      if(path==="/api/members"&&req.method==="GET"){
        const rows=await env.DB.prepare("SELECT id,name,role FROM members WHERE family_id=? ORDER BY created_at ASC").bind(me.family_id).all();
        return json({members:rows.results||[]})
      }
      if(path==="/api/wizz"&&req.method==="POST"){
        const b=await req.json(),target=String(b.targetMemberId||""),recipients=await otherMemberIds(env,me,target);
        const title=String(b.title||`⚡ WIZZ de ${me.name||"quelqu’un"}`).slice(0,80);
        const message=String(b.message||"Petit rappel ⚡").slice(0,220);
        const sent=await sendPush(env,recipients,title,message,env.APP_URL||"/");
        return json({ok:true,sent,recipients:recipients.length})
      }
      if(path==="/api/state"&&req.method==="GET"){
        const f=await env.DB.prepare("SELECT data_json,version,updated_at FROM families WHERE id=?").bind(me.family_id).first();
        return json({data:JSON.parse(f.data_json||"{}"),version:f.version,updatedAt:f.updated_at,joinCode:me.join_code})
      }
      if(path==="/api/state"&&req.method==="PUT"){
        const b=await req.json(),f=await env.DB.prepare("SELECT data_json,version FROM families WHERE id=?").bind(me.family_id).first();
        if(Number(b.version)!==Number(f.version))return json({error:"Conflit de synchronisation",data:JSON.parse(f.data_json||"{}"),version:f.version},409);
        let oldData={};try{oldData=JSON.parse(f.data_json||"{}")}catch{}
        const newData=b.data||{},v=Number(f.version)+1,t=now();
        await env.DB.prepare("UPDATE families SET data_json=?,version=?,updated_at=? WHERE id=?").bind(JSON.stringify(newData),v,t,me.family_id).run();
        await notifyNewTaskCompletions(env,me,oldData,newData);
        return json({ok:true,version:v,updatedAt:t})
      }
      if(path==="/api/me"&&req.method==="GET")return json({memberId:me.id,memberName:me.name,familyId:me.family_id,joinCode:me.join_code});
      return json({error:"Route introuvable"},404)
    }catch(e){return json({error:e?.message||"Erreur serveur"},500)}
  },
  // Aucun rappel automatique pour les jobs ou les listes. Le WIZZ est volontaire.
  async scheduled(){return}
};

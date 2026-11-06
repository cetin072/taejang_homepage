// PR #572. Server-only adapter over existing Expo device/ticket/receipt contracts.
// Default OFF, no scheduler or secret/config changes are part of this implementation.
import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
const client=createClient(Deno.env.get('SUPABASE_URL')||'',Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',{auth:{persistSession:false,autoRefreshToken:false}});
const headers={'content-type':'application/json','cache-control':'no-store'};
const json=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});
async function rpc(name:string,args:Record<string,unknown>={}){const {data,error}=await client.rpc(name,args);if(error)throw new Error('RPC_FAILED');return data;}
type Item={delivery_id:string;expo_push_token:string;title:string;body:string;data:Record<string,unknown>;ticket_id?:string};
async function provider(path:string,body:unknown){const token=Deno.env.get('EXPO_PUSH_ACCESS_TOKEN');const response=await fetch(`https://exp.host/--/api/v2/push/${path}`,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('PUSH_OUTCOME_UNKNOWN');return await response.json();}
Deno.serve(async req=>{
 if(req.method!=='POST')return json(405,{code:'METHOD_NOT_ALLOWED'});
 const key=Deno.env.get('NOTIFICATION_DISPATCH_KEY');if(!key||req.headers.get('x-taejang-notification-key')!==key)return json(401,{code:'UNAUTHORIZED'});
 if(Deno.env.get('ATTENDANCE_REMINDERS_ENABLED')!=='true')return json(503,{code:'DISABLED'});
 const body=await req.json().catch(()=>null);if(!body||!['dispatch','receipts','monthly'].includes(body.mode))return json(400,{code:'INVALID_MODE'});
 try{
  if(body.mode==='monthly')return json(200,await rpc('private_reconcile_leave_monthly'));
  const claim=crypto.randomUUID();let sent=0;
  if(body.mode==='receipts'){
   const items=await rpc('private_claim_attendance_receipts',{p_claim:claim}) as Item[];
   if(!items.length)return json(200,{claimed:0});
   let receipts:Record<string,{status?:string;details?:{error?:string}}>={};
   try{receipts=(await provider('getReceipts',{ids:items.map(i=>i.ticket_id)})).data||{};}catch{/* Keep pending; receipt lookup cannot send again. */}
   for(const i of items){const r=receipts[i.ticket_id||''];const code=r?.details?.error;
    await rpc('private_complete_notification_push_receipt',{p_delivery_id:i.delivery_id,p_claim_token:claim,p_outcome:r?.status==='ok'?'delivered':code==='DeviceNotRegistered'?'device_unregistered':r?.status==='error'?'failed':'pending',p_error_code:code||null});}
   return json(200,{claimed:items.length});
  }
  const items=await rpc('private_claim_attendance_reminders',{p_claim:claim,p_limit:50}) as Item[];
  for(const item of items){
   if(await rpc('private_validate_attendance_reminder',{p_id:item.delivery_id,p_claim:claim})!==true)continue;
   let outcome='failed',ticketId:string|null=null,error:string|null='PUSH_OUTCOME_UNKNOWN';
   try{const response=await provider('send',[{to:item.expo_push_token,title:item.title,body:item.body,data:item.data,sound:'default',channelId:'taejang-important-notices'}]);const ticket=response.data?.[0];
    if(ticket?.status==='ok'&&typeof ticket.id==='string'){outcome='accepted';ticketId=ticket.id;error=null;sent++;}
    else{error=ticket?.details?.error||'PUSH_TICKET_ERROR';outcome=error==='DeviceNotRegistered'?'device_unregistered':error==='MessageRateExceeded'?'retry':'failed';}
   }catch{/* Unknown send outcomes are NOT automatically resent. */}
   await rpc('private_complete_notification_push_ticket',{p_delivery_id:item.delivery_id,p_claim_token:claim,p_outcome:outcome,p_ticket_id:ticketId,p_error_code:error,p_retry_seconds:60});
  }
  return json(200,{claimed:items.length,accepted:sent});
 }catch{return json(500,{code:'PROCESSING_FAILED'});}
});

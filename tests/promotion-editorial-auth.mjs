import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function promotionEditorialChecks({apiUrl,rpc,sql,admin,lead,staff,check,equal}) {
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(apiUrl).hostname), 'isolated database only');
  const create = async (extra={},publish=true) => {
    const result=await rpc('save_operations_promotion_draft',admin.token,{
      p_content_type:'homepage_article',p_slug:'ci-editorial-'+randomUUID(),p_title:'CI editorial',p_public_body:'Synthetic article',
      p_byline_kind:'company',p_public_media:[],p_people_photo:'no',p_number_or_amount:'no',...extra
    }); check(result.ok,'editorial fixture draft');
    if(publish) check((await rpc('queue_operations_owned_promotion',admin.token,{p_content_id:result.data.content_id,p_scheduled_for:null})).ok,'editorial fixture published');
    return result.data.content_id;
  };
  const ids=[];for(let i=0;i<5;i++)ids.push(await create());
  const set=(id,slot,expected=null,actor=admin)=>rpc('set_promotion_editorial_slot',actor?.token||null,{p_content_id:id,p_slot:slot,p_expected_slot:expected});
  const slot=id=>sql(`select coalesce(editorial_slot::text,'none') from public.promotion_contents where id='${id}'`);
  for(const actor of [lead,staff,null]) check(!(await set(ids[0],1,null,actor)).ok,'unauthorized pin rejected');
  for(const n of [0,5,-1]) check(!(await set(ids[0],n)).ok,'out-of-range slot rejected');
  const draft=await create({},false);check(!(await set(draft,1)).ok,'draft cannot become public through pinning');
  const external=await create({p_content_type:'external_content',p_external_url:'https://example.org/article'});
  check(!(await set(external,1)).ok,'external link cannot become editorial original');
  for(let i=0;i<4;i++)check((await set(ids[i],i+1)).ok,'select four articles');
  check(!(await set(ids[4],1)).ok,'fifth article cannot replace occupied slot');equal(slot(ids[0]),'1','occupied rejection preserves original');
  const adminList=await rpc('get_promotion_publication_admin',admin.token,{});
  const item=adminList.data.items.find(item=>item.content_id===ids[0]);
  check(item.can_manage_editorial===true&&item.editorial_slot===1,'admin receives checked state and permission');
  const leadList=await rpc('get_promotion_publication_admin',lead.token,{});
  check(leadList.data.items.every(item=>item.can_manage_editorial===false),'lead has no editorial write control');
  check((await set(ids[0],4,1)).ok,'existing articles swap slots');equal(slot(ids[0]),'4','moving article at slot four');equal(slot(ids[3]),'1','occupant moves to original slot');
  check(!(await set(ids[0],2,1)).ok,'stale expected slot rejected');equal(slot(ids[1]),'2','stale reorder preserves occupant');
  const feed=await rpc('list_public_promotion_feed',null,{});
  equal(feed.data.find(item=>item.content_id===ids[0]).editorial_slot,4,'public feed exposes saved order');
  check(!feed.data.some(item=>item.content_id===draft),'draft still absent from public feed');
  check((await set(ids[0],null,4)).ok,'uncheck removes editorial placement');
  check((await rpc('list_public_promotion_feed',null,{})).data.some(item=>item.content_id===ids[0]&&item.editorial_slot===null),'unpin keeps ordinary public article');
  const raced=await Promise.all([set(ids[0],4),set(ids[4],4)]);
  equal(raced.filter(result=>result.ok).length,1,'simultaneous new pins cannot occupy the same slot');
  sql(`update public.promotion_contents set lifecycle='hidden' where id='${ids[1]}'`);
  equal(slot(ids[1]),'none','hidden article releases its slot');
  check(!(await rpc('list_public_promotion_feed',null,{})).data.some(item=>item.content_id===ids[1]),'hidden article absent from public feed');
  equal(sql("select count(*) from public.audit_logs where action='promotion_editorial_slot_changed' and target_id='"+ids[0]+"' and outcome='success'")!=='0',true,'editorial changes audited');
  for(const id of ids){const current=slot(id);if(current!=='none')check((await set(id,null,Number(current))).ok,'clear isolated editorial fixture');}
  console.log('PROMOTION_EDITORIAL_AUTH_PASS');
}

import DateTimePicker from '@react-native-community/datetimepicker';
import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlatform } from '@/src/providers/platform-provider';
import { useMyLeave } from '@/src/features/leave/use-my-leave';
import { cancelMyLeave, editMyPendingLeave, requestMyLeaveChange, leaveError, submitMyLeave, type LeavePortion, type LeaveRequest } from '@/src/features/leave/leave-api';
const labels={full:'종일',first_half:'앞 반차',second_half:'뒤 반차',pending:'승인 대기',approved:'승인',rejected:'반려',cancelled:'취소'};
export default function LeaveScreen(){
 const {client,session}=usePlatform();const {context,error,loading,reload}=useMyLeave();const router=useRouter();const insets=useSafeAreaInsets();
 const [date,setDate]=useState('');const [portion,setPortion]=useState<LeavePortion>('full');const [picker,setPicker]=useState(false);
 const [days,setDays]=useState<{date:string;portion:LeavePortion}[]>([]);const [busy,setBusy]=useState(false);const locked=useRef(false);
 const request=useRef<{id:string;payload:string}|null>(null);
 const [editing,setEditing]=useState<{original:LeaveRequest;action:'amend'|'cancel'}|null>(null);const [reason,setReason]=useState('');
 const changeRequest=useRef<{id:string;payload:string}|null>(null);
 useEffect(()=>{const id=changeRequest.current?.id;if(id&&(context?.change_requests?.some(c=>c.id===id)||context?.requests.some(r=>r.id===id))){changeRequest.current=null;setEditing(null);setReason('');setDate('');}},[context]);
 useEffect(()=>{if(request.current&&context?.requests.some(r=>r.id===request.current?.id)){request.current=null;setDays([]);setDate('');}},[context]);
 const press=(text:string,run:()=>void,disabled=false)=><Pressable key={text} accessibilityRole="button" disabled={disabled} onPress={run} style={[styles.button,disabled?styles.disabled:null]}><Text style={styles.buttonText}>{text}</Text></Pressable>;
 async function submit(){if(!client||locked.current||!context)return;const payload=request.current?JSON.parse(request.current.payload) as {date:string;portion:LeavePortion}[]:days.length?days:[{date,portion}];
  if(!request.current&&payload.some(d=>!d.date||d.date<context.earliest_date)){Alert.alert('신청 기한','연차는 사용일 최소 3일 전에 신청할 수 있습니다.');return;}
  const json=JSON.stringify(payload);if(request.current&&request.current.payload!==json){Alert.alert('신청 확인','이전 전송 결과를 새로고침해 확인한 후 다시 신청해주세요.');return;}
  request.current??={id:Crypto.randomUUID(),payload:json};locked.current=true;setBusy(true);
  try{await submitMyLeave(client,request.current.id,payload);request.current=null;setDays([]);setDate('');Alert.alert('접수 완료','관리자 승인 후 연차가 반영됩니다.');await reload();}catch(e){if(/^(P0|22|23)/.test(String((e as {code?:string})?.code||'')))request.current=null;Alert.alert('연차 신청',leaveError(e));}finally{locked.current=false;setBusy(false);}
 }
 async function cancel(id:string){if(!client||locked.current)return;locked.current=true;setBusy(true);try{await cancelMyLeave(client,id);await reload();}catch(e){Alert.alert('신청 취소',leaveError(e));}finally{locked.current=false;setBusy(false);}}
 function beginChange(original:LeaveRequest,action:'amend'|'cancel'){
  if(original.status==='approved'&&action==='amend'&&(original.modification_count||0)>=1){Alert.alert('수정 요청 제한','승인 후 수정 요청은 1회만 가능합니다. 관리자에게 문의해주세요.');return;}
  setEditing({original,action});setPicker(false);setReason('');setDays([]);setDate(action==='amend'?original.work_date:'');setPortion(original.portion);
 }
 async function sendChange(){
  if(!client||locked.current||!editing||!context)return;
  if(!changeRequest.current&&editing.action==='amend'&&(!date||date<context.earliest_date)){Alert.alert('신청 기한','연차는 사용일 최소 3일 전에 신청할 수 있습니다.');return;}
  if(!changeRequest.current&&editing.original.status==='approved'&&reason.trim().length<2){Alert.alert('사유 확인','취소·수정 사유를 2자 이상 입력해주세요.');return;}
  const payload=changeRequest.current?JSON.parse(changeRequest.current.payload):{requestId:editing.original.id,status:editing.original.status,action:editing.action,date:editing.action==='amend'?date:null,portion:editing.action==='amend'?portion:null,reason:reason.trim()};
  changeRequest.current??={id:Crypto.randomUUID(),payload:JSON.stringify(payload)};locked.current=true;setBusy(true);
  try{
   if(payload.status==='pending')await editMyPendingLeave(client,payload.requestId,changeRequest.current.id,payload.date,payload.portion);
   else await requestMyLeaveChange(client,changeRequest.current.id,payload.requestId,payload.action,payload.date,payload.portion,payload.reason);
   changeRequest.current=null;setEditing(null);setDate('');setReason('');Alert.alert('접수 완료',payload.status==='pending'?'승인 대기 신청을 수정했습니다.':'관리자가 승인하기 전까지 기존 연차가 유지됩니다.');await reload();
  }catch(e){if(/^(P0|22|23)/.test(String((e as {code?:string})?.code||'')))changeRequest.current=null;Alert.alert('취소·수정 요청',leaveError(e));}finally{locked.current=false;setBusy(false);}
 }
 function confirmChange(){
  if(!editing)return;
  const summary=editing.action==='cancel'?`${editing.original.work_date} 연차 취소 요청`:`${editing.original.work_date} → ${date} ${labels[portion]}`;
  Alert.alert('변경 내용 확인',summary+(editing.original.status==='approved'?'\n관리자 승인 전까지 기존 연차가 유지됩니다. 수정 요청은 승인 후 1회만 가능합니다.':''),[{text:'돌아가기',style:'cancel'},{text:'확인 후 보내기',onPress:()=>void sendChange()}]);
 }
 const uncertain=Boolean(request.current||changeRequest.current);
 const earliest=context?.earliest_date;const min=earliest?new Date(`${earliest}T12:00:00`):new Date();
 return <ScrollView style={[styles.page,{paddingTop:insets.top}]} contentContainerStyle={{padding:20,paddingBottom:insets.bottom+50,gap:16}} keyboardShouldPersistTaps="handled">
  {press('← 홈',()=>router.replace('/'))}<Text style={styles.title}>내 연차</Text>
  {!session?<Text>로그인 후 확인해주세요.</Text>:null}
  {loading?<ActivityIndicator/>:null}{error?<Text accessibilityRole="alert">{error}</Text>:null}{press('새로고침',()=>void reload(),busy)}
  {context?<><Text style={styles.balance}>{context.configured?`남은 연차 ${context.remaining}개`:'관리자 등록 대기'}</Text>
   <Text>승인 대기 중인 신청분은 남은 개수에서 제외됩니다.</Text><Text>연차는 사용일 최소 3일 전에 신청해주세요.</Text><Text>반차는 하루 근무시간의 절반이며 연차 0.5개를 사용합니다.</Text>
   <Text>승인 전에는 여러 번 수정할 수 있습니다. 승인된 일정의 수정 요청은 사용일 전까지 1회만 가능합니다.</Text>
   {editing?<View style={styles.record}><Text style={styles.title}>{editing.original.status==='pending'?'승인 전 신청 수정':editing.action==='cancel'?'승인 연차 취소 요청':'승인 연차 수정 요청'}</Text><Text>기존: {editing.original.work_date} {labels[editing.original.portion]}</Text>{editing.original.status==='approved'?<TextInput accessibilityLabel="취소·수정 사유" value={reason} onChangeText={setReason} editable={!busy&&!uncertain} placeholder="사유를 입력해주세요" maxLength={300} style={styles.input}/>:null}{press('변경 입력 닫기',()=>{setEditing(null);setDate('');setReason('');},busy||uncertain)}</View>:null}
   {editing?.action!=='cancel'?press(date||'사용 날짜 선택',()=>setPicker(true),busy||uncertain||!context.configured):null}
   {picker?<DateTimePicker value={date?new Date(`${date}T12:00:00`):min} mode="date" minimumDate={min} onChange={(_event,value)=>{setPicker(false);if(value)setDate(`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`);}}/>:null}
   {editing?.action!=='cancel'?<View style={styles.choices}>{(['full','first_half','second_half'] as LeavePortion[]).map(p=>press(`${portion===p?'✓ ':''}${labels[p]}`,()=>setPortion(p),busy||uncertain))}</View>:null}
   {!editing?press('날짜 추가',()=>{if(date&&!days.some(d=>d.date===date)){setDays([...days,{date,portion}]);setDate('');}},busy||uncertain||!date||days.length>=31):null}
   {days.map(d=>press(`${d.date} ${labels[d.portion]} · 제외`,()=>setDays(days.filter(x=>x.date!==d.date)),busy||uncertain))}
   {uncertain?<Text>전송 결과를 확인하지 못했습니다. 같은 신청을 다시 보내면 중복 없이 결과를 확인합니다.</Text>:null}
   {editing?press(busy?'처리 중…':uncertain?'같은 변경 다시 보내기':'변경 내용 확인',confirmChange,busy||loading):press(busy?'처리 중…':uncertain?'같은 신청 다시 보내기':'연차 신청',()=>void submit(),busy||loading||!context.configured||(!date&&!days.length))}
   <Text style={styles.title}>내 신청</Text>{context.requests.map(r=>{
    const pendingChange=context.change_requests?.find(c=>c.request_id===r.id&&c.status==='pending');const active=r.status==='pending'||r.status==='approved';const beforeUse=r.work_date>context.server_today;
    return <View key={r.id} style={styles.record}><Text>{r.work_date} · {labels[r.portion]} · {labels[r.status]}</Text>
     {pendingChange?<Text>{pendingChange.action==='cancel'?'취소':'수정'} 요청 · 관리자 확인 대기 (기존 연차 유지)</Text>:null}
     {active&&beforeUse&&!pendingChange?<>{press(r.status==='pending'?'신청 수정':'일정 수정 요청',()=>beginChange(r,'amend'),busy||uncertain||Boolean(editing))}
      {r.status==='approved'&&(r.modification_count||0)>=1?<Text>승인 후 수정 요청은 1회 사용했습니다. 추가 변경은 관리자에게 문의해주세요.</Text>:null}
      {r.status==='pending'?press('신청 취소',()=>Alert.alert('신청 취소',`${r.work_date} 신청을 취소할까요?`,[{text:'돌아가기',style:'cancel'},{text:'취소 확인',onPress:()=>void cancel(r.id)}]),busy||uncertain||Boolean(editing)):press('연차 취소 요청',()=>beginChange(r,'cancel'),busy||uncertain||Boolean(editing))}</>:null}
    </View>;
   })}
   {(context.change_requests||[]).length?<Text style={styles.title}>취소·수정 처리 결과</Text>:null}
   {(context.change_requests||[]).map(c=><View key={c.id} style={styles.record}><Text>{c.action==='cancel'?'취소':'수정'} 요청 · {labels[c.status]}</Text>{c.new_work_date?<Text>{c.new_work_date} {c.new_portion?labels[c.new_portion]:''}</Text>:null}{c.decision_note?<Text>처리 사유: {c.decision_note}</Text>:null}</View>)}
  </>:null}
 </ScrollView>;
}
const styles=StyleSheet.create({input:{minHeight:48,borderWidth:1,borderColor:'#a3b4a9',borderRadius:8,padding:12,fontSize:17},page:{flex:1,backgroundColor:'#f6f4ed'},title:{fontSize:23,fontWeight:'800',color:'#173f31'},balance:{fontSize:27,fontWeight:'800',color:'#173f31'},button:{minHeight:48,padding:14,borderRadius:12,backgroundColor:'#173f31',justifyContent:'center'},buttonText:{color:'white',fontSize:17},disabled:{opacity:.45},choices:{gap:8},record:{gap:8,padding:16,backgroundColor:'#fff',borderRadius:12}});

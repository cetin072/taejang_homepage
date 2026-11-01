import DateTimePicker from '@react-native-community/datetimepicker';
import * as Crypto from 'expo-crypto';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlatform } from '@/src/providers/platform-provider';
import { useMyLeave } from '@/src/features/leave/use-my-leave';
import { cancelMyLeave, leaveError, submitMyLeave, type LeavePortion } from '@/src/features/leave/leave-api';
const labels={full:'종일',first_half:'앞 반차',second_half:'뒤 반차',pending:'승인 대기',approved:'승인',rejected:'반려',cancelled:'취소'};
export default function LeaveScreen(){
 const {client,session}=usePlatform();const {context,error,loading,reload}=useMyLeave();const router=useRouter();const insets=useSafeAreaInsets();
 const [date,setDate]=useState('');const [portion,setPortion]=useState<LeavePortion>('full');const [picker,setPicker]=useState(false);
 const [days,setDays]=useState<{date:string;portion:LeavePortion}[]>([]);const [busy,setBusy]=useState(false);const locked=useRef(false);
 const request=useRef<{id:string;payload:string}|null>(null);
 useEffect(()=>{if(request.current&&context?.requests.some(r=>r.id===request.current?.id)){request.current=null;setDays([]);setDate('');}},[context]);
 const press=(text:string,run:()=>void,disabled=false)=><Pressable key={text} accessibilityRole="button" disabled={disabled} onPress={run} style={[styles.button,disabled?styles.disabled:null]}><Text style={styles.buttonText}>{text}</Text></Pressable>;
 async function submit(){if(!client||locked.current||!context)return;const payload=days.length?days:[{date,portion}];
  if(payload.some(d=>!d.date||d.date<context.earliest_date)){Alert.alert('신청 기한','연차는 사용일 최소 3일 전에 신청할 수 있습니다.');return;}
  const json=JSON.stringify(payload);if(request.current&&request.current.payload!==json){Alert.alert('신청 확인','이전 전송 결과를 새로고침해 확인한 후 다시 신청해주세요.');return;}
  request.current??={id:Crypto.randomUUID(),payload:json};locked.current=true;setBusy(true);
  try{await submitMyLeave(client,request.current.id,payload);request.current=null;setDays([]);setDate('');Alert.alert('접수 완료','관리자 승인 후 연차가 반영됩니다.');await reload();}catch(e){if(/^(P0|22|23)/.test(String((e as {code?:string})?.code||'')))request.current=null;Alert.alert('연차 신청',leaveError(e));}finally{locked.current=false;setBusy(false);}
 }
 async function cancel(id:string){if(!client||locked.current)return;locked.current=true;setBusy(true);try{await cancelMyLeave(client,id);await reload();}catch(e){Alert.alert('신청 취소',leaveError(e));}finally{locked.current=false;setBusy(false);}}
 const earliest=context?.earliest_date;const min=earliest?new Date(`${earliest}T12:00:00`):new Date();
 return <ScrollView style={[styles.page,{paddingTop:insets.top}]} contentContainerStyle={{padding:20,paddingBottom:insets.bottom+50,gap:16}} keyboardShouldPersistTaps="handled">
  {press('← 홈',()=>router.replace('/'))}<Text style={styles.title}>내 연차</Text>
  {!session?<Text>로그인 후 확인해주세요.</Text>:null}
  {loading?<ActivityIndicator/>:null}{error?<Text accessibilityRole="alert">{error}</Text>:null}{press('새로고침',()=>void reload(),busy)}
  {context?<><Text style={styles.balance}>{context.configured?`남은 연차 ${context.remaining}개`:'관리자 등록 대기'}</Text>
   <Text>승인 대기 중인 신청분은 남은 개수에서 제외됩니다.</Text><Text>연차는 사용일 최소 3일 전에 신청해주세요.</Text><Text>반차는 하루 근무시간의 절반이며 연차 0.5개를 사용합니다.</Text>
   {press(date||'사용 날짜 선택',()=>setPicker(true),busy||!context.configured)}
   {picker?<DateTimePicker value={date?new Date(`${date}T12:00:00`):min} mode="date" minimumDate={min} onChange={(_event,value)=>{setPicker(false);if(value)setDate(`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`);}}/>:null}
   <View style={styles.choices}>{(['full','first_half','second_half'] as LeavePortion[]).map(p=>press(`${portion===p?'✓ ':''}${labels[p]}`,()=>setPortion(p),busy))}</View>
   {press('날짜 추가',()=>{if(date&&!days.some(d=>d.date===date)){setDays([...days,{date,portion}]);setDate('');}},busy||!date||days.length>=31)}
   {days.map(d=>press(`${d.date} ${labels[d.portion]} · 제외`,()=>setDays(days.filter(x=>x.date!==d.date)),busy))}
   {press(busy?'처리 중…':'연차 신청',()=>void submit(),busy||loading||!context.configured||(!date&&!days.length))}
   <Text style={styles.title}>내 신청</Text>{context.requests.map(r=><View key={r.id} style={styles.record}><Text>{r.work_date} · {labels[r.portion]} · {labels[r.status]}</Text>{r.status==='pending'?press('신청 취소',()=>void cancel(r.id),busy):null}</View>)}
  </>:null}
 </ScrollView>;
}
const styles=StyleSheet.create({page:{flex:1,backgroundColor:'#f6f4ed'},title:{fontSize:23,fontWeight:'800',color:'#173f31'},balance:{fontSize:27,fontWeight:'800',color:'#173f31'},button:{minHeight:48,padding:14,borderRadius:12,backgroundColor:'#173f31',justifyContent:'center'},buttonText:{color:'white',fontSize:17},disabled:{opacity:.45},choices:{gap:8},record:{gap:8,padding:16,backgroundColor:'#fff',borderRadius:12}});

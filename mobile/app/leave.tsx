import DateTimePicker from '@react-native-community/datetimepicker';
import * as Crypto from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { isQaApp } from '@/src/platform/app-variant';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlatform } from '@/src/providers/platform-provider';
import { useMyLeave } from '@/src/features/leave/use-my-leave';
import { cancelMyLeave, editMyPendingLeave, requestMyLeaveChange, leaveError, submitMyLeave, type LeavePortion, type LeaveRequest } from '@/src/features/leave/leave-api';
const labels={full:'종일',first_half:'앞 반차',second_half:'뒤 반차',pending:'승인 대기',approved:'승인',rejected:'반려',cancelled:'취소'};
export default function LeaveScreen(){
 const params=useLocalSearchParams<{preview?:string}>();const preview=isQaApp&&params.preview==='1';
 const {client,session}=usePlatform();const live=useMyLeave(!preview);const context=preview?{configured:true,remaining:7,server_today:'2026-11-02',earliest_date:'2026-11-05',requests:[],change_requests:[]}:live.context;const {error,loading,reload}=live;const router=useRouter();const insets=useSafeAreaInsets();
 const [date,setDate]=useState('');const [portion,setPortion]=useState<LeavePortion>('full');const [picker,setPicker]=useState(false);
 const [days,setDays]=useState<{date:string;portion:LeavePortion}[]>([]);const [busy,setBusy]=useState(false);const locked=useRef(false);
 const request=useRef<{id:string;payload:string}|null>(null);
 const [editing,setEditing]=useState<{original:LeaveRequest;action:'amend'|'cancel'}|null>(null);const [reason,setReason]=useState('');
 const [helpOpen,setHelpOpen]=useState(false);const [period,setPeriod]=useState<'one'|'many'>('one');
 const changeRequest=useRef<{id:string;payload:string}|null>(null);
 useEffect(()=>{const id=changeRequest.current?.id;if(id&&(context?.change_requests?.some(c=>c.id===id)||context?.requests.some(r=>r.id===id))){changeRequest.current=null;setEditing(null);setReason('');setDate('');}},[context]);
 useEffect(()=>{if(request.current&&context?.requests.some(r=>r.id===request.current?.id)){request.current=null;setDays([]);setDate('');}},[context]);
 const press=(text:string,run:()=>void,disabled=false,kind:'primary'|'secondary'|'quiet'='secondary')=><Pressable key={text} accessibilityRole="button" disabled={disabled} onPress={run} style={[styles.button,kind==='primary'?styles.primary:kind==='quiet'?styles.quiet:null,disabled?styles.disabled:null]}><Text style={[styles.buttonText,kind==='primary'?styles.primaryText:null]}>{text}</Text></Pressable>;
 async function submit(){if(preview){Alert.alert('화면 체험','실제 신청은 GPS·서버 검수 모드에서 가능합니다.');return;}if(!client||locked.current||!context)return;const payload=request.current?JSON.parse(request.current.payload) as {date:string;portion:LeavePortion}[]:period==='many'?days:[{date,portion}];
  if(!request.current&&(period==='many'&&payload.length<2||!payload.length||payload.some(d=>!d.date||d.date<context.earliest_date))){Alert.alert('신청 기한','연차는 사용일 최소 3일 전에 신청할 수 있습니다.');return;}
  const json=JSON.stringify(payload);if(request.current&&request.current.payload!==json){Alert.alert('신청 확인','이전 전송 결과를 새로고침해 확인한 후 다시 신청해주세요.');return;}
  request.current??={id:Crypto.randomUUID(),payload:json};locked.current=true;setBusy(true);
  try{await submitMyLeave(client,request.current.id,payload);request.current=null;setDays([]);setDate('');Alert.alert('접수 완료','관리자 승인 후 연차가 반영됩니다.');await reload();}catch(e){if(/^(P0|22|23)/.test(String((e as {code?:string})?.code||'')))request.current=null;Alert.alert('연차 신청',leaveError(e));}finally{locked.current=false;setBusy(false);}
 }
 async function cancel(id:string){if(preview)return;if(!client||locked.current)return;locked.current=true;setBusy(true);try{await cancelMyLeave(client,id);await reload();}catch(e){Alert.alert('신청 취소',leaveError(e));}finally{locked.current=false;setBusy(false);}}
 function beginChange(original:LeaveRequest,action:'amend'|'cancel'){
  if(original.status==='approved'&&action==='amend'&&(original.modification_count||0)>=1){Alert.alert('수정 요청 제한','승인 후 수정 요청은 1회만 가능합니다. 관리자에게 문의해주세요.');return;}
  setEditing({original,action});setPeriod('one');setPicker(false);setReason('');setDays([]);setDate(action==='amend'?original.work_date:'');setPortion(original.portion);
 }
 async function sendChange(){
  if(preview)return;if(!client||locked.current||!editing||!context)return;
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
 function changePeriod(next:'one'|'many'){
  if(next===period)return;
  const apply=()=>{if(next==='many'){setDays(date?[{date,portion}]:[]);setDate('');}else{setDate(days[0]?.date||'');setPortion(days[0]?.portion||portion);setDays([]);}setPeriod(next);};
  if(next==='one'&&days.length>1)Alert.alert('하루 신청으로 바꿀까요?','첫 날짜만 남고 나머지는 선택 해제됩니다.',[{text:'그대로 두기',style:'cancel'},{text:'하루로 바꾸기',onPress:apply}]);else apply();
 }
 function confirmSubmission(){
  if(!context)return;const payload=period==='many'?days:[{date,portion}];
  if(!request.current&&(period==='many'&&payload.length<2||!payload.length||payload.some(d=>!d.date||d.date<context.earliest_date))){Alert.alert('날짜 선택','사용일 3일 전까지 신청할 수 있어요.');return;}
  if(request.current){void submit();return;}
  const total=payload.reduce((sum,d)=>sum+(d.portion==='full'?1:.5),0);
  Alert.alert(payload.length===1?'하루 신청을 확인해주세요':`총 ${payload.length}일 신청을 확인해주세요`,payload.map((d,i)=>`${i+1}. ${d.date} · ${labels[d.portion]}`).join('\n')+`\n\n사용 연차 ${total}개`,[{text:'돌아가기',style:'cancel'},{text:payload.length===1?'하루 신청할게요':`${payload.length}일 신청할게요`,onPress:()=>void submit()}]);
 }
 const chosenCount=period==='many'?days.length:(date?1:0);
 const chosenUnits=period==='many'?days.reduce((sum,d)=>sum+(d.portion==='full'?1:.5),0):(date?(portion==='full'?1:.5):0);
 const uncertain=Boolean(request.current||changeRequest.current);
 const earliest=context?.earliest_date;const min=earliest?new Date(`${earliest}T12:00:00`):new Date();
 const selectedPickerDate=date||(period==='many'?days.at(-1)?.date:'');const cursor=selectedPickerDate?new Date(`${selectedPickerDate}T12:00:00`):min;
 return <ScrollView style={[styles.page,{paddingTop:insets.top}]} contentContainerStyle={{padding:20,paddingBottom:insets.bottom+50,gap:16}} keyboardShouldPersistTaps="handled">
  <View style={styles.header}>{press('← 홈',()=>router.replace('/'),false,'quiet')}{press('새로고침',()=>void reload(),busy,'quiet')}</View>
  <Text style={styles.title}>연차 신청</Text>
  {preview?<Text style={styles.hint}>화면 체험 · 예시 데이터 · 실제 저장 안 됨</Text>:null}
  {!session?<Text>로그인 후 확인해주세요.</Text>:null}
  {!preview&&loading?<ActivityIndicator/>:null}{!preview&&error?<Text accessibilityRole="alert">{error}</Text>:null}
  {context?<><View style={styles.balanceCard}><Text style={styles.label}>남은 연차</Text><Text style={context.configured?styles.balance:styles.label}>{context.configured?`${context.remaining}개`:'관리자 등록 대기'}</Text></View>
   {!context.configured?<Text style={styles.hint}>관리자가 연차를 등록하면 신청할 수 있어요.</Text>:null}
   <View style={styles.formCard}>
   {editing?<View style={styles.record}><Text style={styles.title}>{editing.original.status==='pending'?'승인 전 신청 수정':editing.action==='cancel'?'승인 연차 취소 요청':'승인 연차 수정 요청'}</Text><Text>기존: {editing.original.work_date} {labels[editing.original.portion]}</Text>{editing.original.status==='approved'?<TextInput accessibilityLabel="취소·수정 사유" value={reason} onChangeText={setReason} editable={!busy&&!uncertain} placeholder="사유를 입력해주세요" maxLength={300} style={styles.input}/>:null}{press('변경 입력 닫기',()=>{setEditing(null);setDate('');setReason('');},busy||uncertain)}</View>:null}
   {!editing?<><Text style={styles.label}>하루 쉬나요, 여러 날 쉬나요?</Text><View style={styles.periodChoices}>
    {(['one','many'] as const).map(p=><Pressable key={p} accessibilityRole="button" accessibilityState={{selected:period===p}} disabled={busy||uncertain} onPress={()=>changePeriod(p)} style={[styles.periodOption,period===p?styles.periodSelected:null]}><Text style={[styles.periodTitle,period===p?styles.primaryText:null]}>{period===p?'✓ ':''}{p==='one'?'하루 신청':'여러 날 신청'}</Text><Text style={[styles.portionUnits,period===p?styles.primaryText:null]}>{p==='one'?'날짜 1개':'날짜 2개 이상'}</Text></Pressable>)}
   </View></>:null}
   {editing?.action!=='cancel'?<Text style={styles.label}>{period==='many'?'쉬는 날짜를 하나씩 선택해주세요':'언제 쉬실 건가요?'}</Text>:null}
   {editing?.action!=='cancel'?press(period==='many'&&!editing?'＋ 날짜 선택':date||'달력에서 날짜 선택',()=>setPicker(true),busy||uncertain||!context.configured||(period==='many'&&days.length>=31)):null}
   {picker?<DateTimePicker value={cursor>=min?cursor:min} mode="date" display="calendar" minimumDate={min} onChange={(_event,value)=>{setPicker(false);if(_event.type!=='dismissed'&&value){const picked=`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;if(period==='many'&&!editing){if(days.length>=31)Alert.alert('날짜 선택','한 번에 최대 31일을 선택할 수 있어요.');else if(!days.some(d=>d.date===picked))setDays([...days,{date:picked,portion}].sort((a,b)=>a.date.localeCompare(b.date)));else Alert.alert('이미 선택한 날짜','다른 날짜를 선택해주세요.');}else setDate(picked);}}}/>:null}
   {editing?.action!=='cancel'?<Text style={styles.hint}>사용일 3일 전까지 신청할 수 있어요.</Text>:null}
   {editing?.action!=='cancel'?<Text style={styles.label}>얼마나 쉬실 건가요?</Text>:null}
   {editing?.action!=='cancel'?<View style={styles.choices}>{(['full','first_half','second_half'] as LeavePortion[]).map(p=><Pressable key={p} accessibilityRole="button" accessibilityState={{selected:portion===p}} disabled={busy||uncertain} onPress={()=>{setPortion(p);if(period==='many')setDays(days.map(d=>({...d,portion:p})));}} style={[styles.portion,portion===p?styles.portionSelected:null]}><Text style={[styles.portionText,portion===p?styles.primaryText:null]}>{labels[p]}</Text><Text style={[styles.portionUnits,portion===p?styles.primaryText:null]}>{p==='full'?'1개':'0.5개'}</Text></Pressable>)}</View>:null}
   {!editing&&chosenCount>0?<View style={styles.selectedDays}>
    <Text style={styles.selectedCount}>{period==='one'?'하루 신청 · 1일':`여러 날 신청 · 총 ${chosenCount}일`}</Text>
    <Text style={styles.hint}>사용 연차 {chosenUnits}개</Text>
    {period==='many'?days.map((d,i)=><View key={d.date} style={styles.dayRow}><View style={styles.dayDescription}><Text style={styles.dayNumber}>{i+1}번째 날짜</Text><Text style={styles.label}>{d.date} · {labels[d.portion]}</Text></View>{press('제외',()=>setDays(days.filter(x=>x.date!==d.date)),busy||uncertain,'quiet')}</View>):<Text style={styles.label}>{date} · {labels[portion]}</Text>}
   </View>:null}
   {uncertain?<Text>전송 결과를 확인하지 못했습니다. 같은 신청을 다시 보내면 중복 없이 결과를 확인합니다.</Text>:null}
   {editing?press(busy?'처리 중…':uncertain?'같은 변경 다시 보내기':'변경 내용 확인',confirmChange,busy||loading,'primary'):press(busy?'처리 중…':uncertain?'같은 신청 다시 보내기':period==='one'?'하루 신청 확인':chosenCount<2?'날짜 2개 이상 선택':`${chosenCount}일 신청 확인`,confirmSubmission,busy||loading||!context.configured||(!chosenCount||period==='many'&&chosenCount<2),'primary')}
   </View>
   {press(helpOpen?'신청 안내 접기':'신청 안내',()=>setHelpOpen(!helpOpen),false,'quiet')}
   {helpOpen?<View style={styles.help}><Text style={styles.hint}>반차는 하루 근무시간의 절반입니다.</Text><Text style={styles.hint}>대기 신청분은 남은 개수에서 제외됩니다.</Text><Text style={styles.hint}>승인 전 수정은 여러 번, 승인 후 일정 수정 요청은 사용일 전까지 1회 가능합니다.</Text></View>:null}
   <Text style={styles.sectionTitle}>내 신청</Text>{context.requests.map(r=>{
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
const styles=StyleSheet.create({periodChoices:{flexDirection:'row',gap:10},periodOption:{flex:1,padding:12,minHeight:85,borderWidth:1.5,borderColor:'#a9beb0',borderRadius:14,justifyContent:'center',gap:7},periodSelected:{backgroundColor:'#173f31',borderColor:'#173f31'},periodTitle:{fontSize:18,fontWeight:'800',color:'#173f31'},selectedDays:{padding:16,borderRadius:14,borderWidth:2,borderColor:'#356c4b',backgroundColor:'#eef5ef',gap:9},selectedCount:{fontSize:22,fontWeight:'800',color:'#173f31'},dayRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8,borderTopWidth:1,borderTopColor:'#cfdfd2',paddingTop:9},dayDescription:{flex:1,gap:4},dayNumber:{fontSize:13,color:'#476350'},header:{flexDirection:'row',justifyContent:'space-between'},label:{fontSize:17,fontWeight:'700',color:'#173f31'},hint:{fontSize:14,lineHeight:21,color:'#607367'},balanceCard:{padding:20,borderRadius:20,backgroundColor:'#e9f1eb',gap:6},formCard:{padding:18,borderRadius:20,backgroundColor:'#fff',gap:14,borderWidth:1,borderColor:'#dbe5de'},primary:{backgroundColor:'#173f31',borderWidth:0,minHeight:58,alignItems:'center'},primaryText:{color:'#fff'},quiet:{backgroundColor:'transparent',borderWidth:0,minHeight:40,padding:4},sectionTitle:{fontSize:20,fontWeight:'800',color:'#173f31'},help:{gap:8,paddingHorizontal:8},portion:{flex:1,minHeight:72,borderWidth:1,borderColor:'#cbd9cf',borderRadius:12,alignItems:'center',justifyContent:'center',gap:4},portionSelected:{backgroundColor:'#173f31',borderColor:'#173f31'},portionText:{fontSize:16,fontWeight:'700',color:'#173f31'},portionUnits:{fontSize:14,color:'#607367'},input:{minHeight:48,borderWidth:1,borderColor:'#a3b4a9',borderRadius:8,padding:12,fontSize:17},page:{flex:1,backgroundColor:'#f6f4ed'},title:{fontSize:23,fontWeight:'800',color:'#173f31'},balance:{fontSize:27,fontWeight:'800',color:'#173f31'},button:{minHeight:52,padding:14,borderRadius:12,backgroundColor:'#fff',borderWidth:1,borderColor:'#cbd9cf',justifyContent:'center'},buttonText:{color:'#173f31',fontSize:17,fontWeight:'600'},disabled:{opacity:.45},choices:{gap:8,flexDirection:'row'},record:{gap:8,padding:16,backgroundColor:'#fff',borderRadius:12}});

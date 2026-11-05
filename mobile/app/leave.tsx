import DateTimePicker from '@react-native-community/datetimepicker';
import * as Crypto from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { isQaApp } from '@/src/platform/app-variant';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlatform } from '@/src/providers/platform-provider';
import { EmployeeBottomTabs } from '@/src/features/common/employee-bottom-tabs';
import { useMyLeave } from '@/src/features/leave/use-my-leave';
import { cancelMyLeave, editMyPendingLeave, requestMyLeaveChange, leaveError, submitMyLeave, type LeavePortion, type LeaveRequest, type LeaveContext } from '@/src/features/leave/leave-api';
const dateLabel=(date:string)=>{const d=new Date(date+'T00:00:00Z');return Number.isNaN(d.getTime())?date:`${Number(date.slice(5,7))}월 ${Number(date.slice(8))}일 ${'일월화수목금토'[d.getUTCDay()]}요일`;};
const labels={full:'연차',first_half:'앞 반차',second_half:'뒤 반차',pending:'승인 대기',approved:'승인 완료',rejected:'반려',cancelled:'취소'};
export default function LeaveScreen(){
 const params=useLocalSearchParams<{preview?:string}>();const preview=isQaApp&&params.preview==='1';
 const {client,session}=usePlatform();const live=useMyLeave(!preview);const context:LeaveContext|null=preview?{configured:true,remaining:7,server_today:'2026-11-03',earliest_date:'2026-11-06',requests:[{id:'demo-approved',work_date:'2026-11-10',portion:'full',units:1,status:'approved'},{id:'demo-pending',work_date:'2026-11-16',portion:'full',units:1,status:'pending'}],change_requests:[]}:live.context;const {error,loading,reload}=live;const router=useRouter();const insets=useSafeAreaInsets();
 const scroller=useRef<ScrollView>(null);
 const [date,setDate]=useState('');const portion:LeavePortion='full';const [picker,setPicker]=useState(false);
 const [days,setDays]=useState<{date:string;portion:LeavePortion}[]>([]);const [busy,setBusy]=useState(false);const locked=useRef(false);
 const request=useRef<{id:string;payload:string}|null>(null);
 const [editing,setEditing]=useState<{original:LeaveRequest;action:'amend'|'cancel'}|null>(null);
 const [helpOpen,setHelpOpen]=useState(false);const [period,setPeriod]=useState<'one'|'many'>('one');
 const [stage,setStage]=useState<'overview'|'form'|'confirm'>('overview');const [historyOpen,setHistoryOpen]=useState(false);
 useEffect(()=>{scroller.current?.scrollTo({y:0,animated:false});},[stage]);
 const changeRequest=useRef<{id:string;payload:string}|null>(null);
 useEffect(()=>{const id=changeRequest.current?.id;if(id&&(context?.change_requests?.some(c=>c.id===id)||context?.requests.some(r=>r.id===id))){changeRequest.current=null;setEditing(null);setStage('overview');setDate('');}},[context]);
 useEffect(()=>{if(request.current&&context?.requests.some(r=>r.id===request.current?.id)){request.current=null;setDays([]);setDate('');setStage('overview');}},[context]);
 const press=(text:string,run:()=>void,disabled=false,kind:'primary'|'secondary'|'quiet'='secondary')=><Pressable key={text} accessibilityRole="button" disabled={disabled} onPress={run} style={[styles.button,kind==='primary'?styles.primary:kind==='quiet'?styles.quiet:null,kind==='primary'&&period==='many'&&!editing?styles.manyPrimary:null,disabled?styles.disabled:null]}><Text style={[styles.buttonText,kind==='primary'?styles.primaryText:null]}>{text}</Text></Pressable>;
 async function submit(){if(preview){Alert.alert('화면 체험','실제 신청은 GPS·서버 검수 모드에서 가능합니다.');return;}if(!client||locked.current||!context)return;const payload=request.current?JSON.parse(request.current.payload) as {date:string;portion:LeavePortion}[]:period==='many'?days:[{date,portion}];
  if(!request.current&&(period==='many'&&payload.length<2||!payload.length||payload.some(d=>!d.date||d.date<context.earliest_date))){Alert.alert('신청 기한','연차는 사용일 최소 3일 전에 신청할 수 있습니다.');return;}
  const json=JSON.stringify(payload);if(request.current&&request.current.payload!==json){Alert.alert('신청 확인','이전 전송 결과를 새로고침해 확인한 후 다시 신청해주세요.');return;}
  request.current??={id:Crypto.randomUUID(),payload:json};locked.current=true;setBusy(true);
  try{await submitMyLeave(client,request.current.id,payload);request.current=null;setDays([]);setDate('');setStage('overview');Alert.alert('접수 완료','관리자 승인 후 연차가 반영됩니다.');await reload();}catch(e){if(/^(P0|22|23)/.test(String((e as {code?:string})?.code||'')))request.current=null;setStage('form');Alert.alert('연차 신청',leaveError(e));}finally{locked.current=false;setBusy(false);}
 }
 async function cancel(id:string){if(preview)return;if(!client||locked.current)return;locked.current=true;setBusy(true);try{await cancelMyLeave(client,id);await reload();}catch(e){Alert.alert('신청 취소',leaveError(e));}finally{locked.current=false;setBusy(false);}}
 function beginChange(original:LeaveRequest,action:'amend'|'cancel'){
  if(action==='amend'&&original.portion!=='full'){Alert.alert('기존 반차 내역','기존 반차 일정 변경은 관리자에게 문의해주세요.');return;}
  if(original.status==='approved'&&context?.self_service_limits?.[action==='amend'?'amend_remaining':'cancel_remaining']===0){Alert.alert('이번 달 요청 한도',`이번 달 ${action==='amend'?'수정':'취소'} 요청 2회를 모두 사용했습니다. 관리자에게 문의해주세요.`);return;}
  setStage('form');setEditing({original,action});setPeriod('one');setPicker(false);setDays([]);setDate(action==='amend'?original.work_date:'');
 }
 async function sendChange(){
  if(preview)return;if(!client||locked.current||!editing||!context)return;
  if(!changeRequest.current&&editing.action==='amend'&&(!date||date<context.earliest_date)){Alert.alert('신청 기한','연차는 사용일 최소 3일 전에 신청할 수 있습니다.');return;}
  const payload=changeRequest.current?JSON.parse(changeRequest.current.payload):{requestId:editing.original.id,status:editing.original.status,action:editing.action,date:editing.action==='amend'?date:null,portion:editing.action==='amend'?portion:null};
  changeRequest.current??={id:Crypto.randomUUID(),payload:JSON.stringify(payload)};locked.current=true;setBusy(true);
  try{
   if(payload.status==='pending')await editMyPendingLeave(client,payload.requestId,changeRequest.current.id,payload.date,payload.portion);
   else await requestMyLeaveChange(client,changeRequest.current.id,payload.requestId,payload.action,payload.date,payload.portion);
   changeRequest.current=null;setEditing(null);setDate('');setStage('overview');Alert.alert('접수 완료',payload.status==='pending'?'승인 대기 신청을 수정했습니다.':'관리자가 승인하기 전까지 기존 연차가 유지됩니다.');await reload();
  }catch(e){if(/^(P0|22|23)/.test(String((e as {code?:string})?.code||'')))changeRequest.current=null;Alert.alert('취소·수정 요청',leaveError(e));}finally{locked.current=false;setBusy(false);}
 }
 function confirmChange(){
  if(!editing)return;
  const summary=editing.action==='cancel'?`${editing.original.work_date} 연차 취소 요청`:`${editing.original.work_date} → ${date} ${labels[portion]}`;
  Alert.alert('변경 내용 확인',summary+(editing.original.status==='approved'?'\n관리자 승인 전까지 기존 연차가 유지됩니다. 승인 후에는 매월 수정 2회·취소 2회까지 요청할 수 있습니다.':''),[{text:'돌아가기',style:'cancel'},{text:'확인 후 보내기',onPress:()=>void sendChange()}]);
 }
 function changePeriod(next:'one'|'many'){
  if(next===period)return;
  const apply=()=>{if(next==='many'){setDays(date?[{date,portion}]:[]);setDate('');}else{setDate(days[0]?.date||'');setDays([]);}setPeriod(next);};
  if(next==='one'&&days.length>1)Alert.alert('하루 신청으로 바꿀까요?','첫 날짜만 남고 나머지는 선택 해제됩니다.',[{text:'그대로 두기',style:'cancel'},{text:'하루로 바꾸기',onPress:apply}]);else apply();
 }
 function confirmSubmission(){
  if(!context)return;const payload=period==='many'?days:[{date,portion}];
  if(!request.current&&(period==='many'&&payload.length<2||!payload.length||payload.some(d=>!d.date||d.date<context.earliest_date))){Alert.alert('날짜 선택','사용일 3일 전까지 신청할 수 있어요.');return;}
  if(request.current){void submit();return;}
  setStage('confirm');
 }
 const chosenCount=period==='many'?days.length:(date?1:0);
 const chosenUnits=chosenCount;
 const uncertain=Boolean(request.current||changeRequest.current);
 useEffect(()=>{const sub=BackHandler.addEventListener('hardwareBackPress',()=>{if(busy||uncertain)return true;if(stage!=='overview'){setPicker(false);setStage(stage==='confirm'?'form':'overview');if(stage!=='confirm'){if(editing){setDate('');}setEditing(null);}return true;}if(date||days.length){goHome();return true;}return false;});return()=>sub.remove();},[stage,busy,uncertain,editing,date,days.length]);
 const earliest=context?.earliest_date;const min=earliest?new Date(`${earliest}T12:00:00`):new Date();
 const selectedPickerDate=date||(period==='many'?days.at(-1)?.date:'');const cursor=selectedPickerDate?new Date(`${selectedPickerDate}T12:00:00`):min;
 const upcoming=context?.requests.filter(r=>(r.status==='pending'||r.status==='approved')&&r.work_date>=context.server_today).sort((a,b)=>a.work_date.localeCompare(b.work_date))||[];
 const past=context?.requests.filter(r=>!upcoming.some(u=>u.id===r.id))||[];
 const record=(r:LeaveRequest)=>{
    const pendingChange=context?.change_requests?.find(c=>c.request_id===r.id&&c.status==='pending');const active=r.status==='pending'||r.status==='approved';const beforeUse=Boolean(context&&r.work_date>context.server_today);
    return <View key={r.id} style={styles.record}><Text style={styles.recordDate}>{dateLabel(r.work_date)}</Text><Text style={[styles.status,r.status==='approved'?styles.approved:null]}>{r.status==='approved'?'✓ ':r.status==='pending'?'◷ ':''}{labels[r.status]}{r.portion!=='full'?` · ${labels[r.portion]}`:''}</Text>
     {pendingChange?<Text>{pendingChange.action==='cancel'?'취소':'수정'} 요청 · 관리자 확인 대기 (기존 연차 유지)</Text>:null}
     {active&&beforeUse&&!pendingChange?<>{press(r.status==='pending'?'신청 수정':'일정 수정 요청',()=>beginChange(r,'amend'),busy||uncertain||Boolean(editing))}
      {r.status==='pending'?press('신청 취소',()=>Alert.alert('신청 취소',`${r.work_date} 신청을 취소할까요?`,[{text:'돌아가기',style:'cancel'},{text:'취소 확인',onPress:()=>void cancel(r.id)}]),busy||uncertain||Boolean(editing)):press('연차 취소 요청',()=>beginChange(r,'cancel'),busy||uncertain||Boolean(editing))}</>:null}
    </View>;

 };
 function goHome(){if(busy||uncertain)return;if(date||days.length||editing)Alert.alert('출퇴근 화면으로 갈까요?','작성 중인 내용은 저장되지 않아요.',[{text:'계속 작성',style:'cancel'},{text:'출퇴근으로 이동',onPress:()=>router.navigate('/')}]);else router.navigate('/');}
 return <View style={[styles.page,{paddingTop:insets.top,paddingBottom:insets.bottom}]}><ScrollView ref={scroller} contentContainerStyle={{padding:20,paddingBottom:24,gap:16}} keyboardShouldPersistTaps="handled">
  <View style={styles.header}>{stage==='overview'?<Text style={styles.title}>태장</Text>:press('← 내 연차',()=>{if(!busy&&!uncertain){setPicker(false);setStage('overview');if(editing){setDate('');}setEditing(null);}},busy||uncertain,'quiet')}{press('새로고침',()=>void reload(),busy,'quiet')}</View>
  <Text style={styles.title}>{stage==='overview'?'내 연차':stage==='confirm'?'신청 확인':editing?'연차 변경':'연차 신청'}</Text>
  {preview?<Text style={styles.hint}>화면 체험 · 예시 데이터 · 실제 저장 안 됨</Text>:null}
  {!session?<Text>로그인 후 확인해주세요.</Text>:null}
  {!preview&&loading?<ActivityIndicator/>:null}{!preview&&error?<Text accessibilityRole="alert">{error}</Text>:null}
  {context?<>{stage!=='confirm'?<View style={styles.balanceCard}><Text style={styles.label}>남은 연차</Text><Text style={context.configured?styles.balance:styles.label}>{context.configured?`${context.remaining}개`:'관리자 등록 대기'}</Text></View>:null}
   {!context.configured?<Text style={styles.hint}>관리자가 연차를 등록하면 신청할 수 있어요.</Text>:null}
   {stage==='overview'?<>
    {context.self_service_limits?<Text style={styles.hint}>승인 후 이번 달 요청 · 수정 {context.self_service_limits.amend_used}/2회 · 취소 {context.self_service_limits.cancel_used}/2회</Text>:null}
    <Text style={styles.sectionTitle}>앞으로 쉴 날짜</Text>
    {upcoming.length?upcoming.map(record):<Text style={styles.hint}>신청한 연차가 없어요.</Text>}
    {press('연차 신청하기',()=>{setEditing(null);setStage('form');},busy||!context.configured,'primary')}
    {press(historyOpen?'지난 신청 내역 접기':'지난 신청 내역 보기',()=>setHistoryOpen(!historyOpen),busy)}
    {historyOpen?<><Text style={styles.sectionTitle}>지난 신청 내역</Text>{past.length?past.map(record):<Text style={styles.hint}>지난 신청 내역이 없어요.</Text>}
      {(context.change_requests||[]).map(c=><View key={c.id} style={styles.record}><Text>{c.action==='cancel'?'취소':'수정'} 요청 · {labels[c.status]}</Text>{c.new_work_date?<Text>{dateLabel(c.new_work_date)}</Text>:null}{c.decision_note?<Text>처리 사유: {c.decision_note}</Text>:null}</View>)}
    </>:null}
   </>:stage==='confirm'?<>
     <Text style={styles.confirmTitle}>{chosenCount===1?'이날 하루 쉬실 건가요?':`총 ${chosenCount}일 쉬실 건가요?`}</Text>
     <View style={styles.formCard}><Text style={styles.label}>쉬는 날짜</Text>{(period==='many'?days:[{date,portion}]).map(d=><Text key={d.date} style={styles.recordDate}>{dateLabel(d.date)}</Text>)}<Text style={styles.label}>{chosenCount===1?'하루':`${chosenCount}일`} · 연차 {chosenUnits}개 사용</Text></View>
     <Text style={styles.label}>관리자가 확인하면 확정돼요.</Text>
     {press(busy?'신청 중…':'네, 신청할게요',()=>void submit(),busy||loading,'primary')}
     {press('날짜 다시 고르기',()=>setStage('form'),busy)}
   </>:<View style={styles.formCard}>
   {editing?<View style={styles.record}><Text style={styles.title}>{editing.original.status==='pending'?'승인 전 신청 수정':editing.action==='cancel'?'승인 연차 취소 요청':'승인 연차 수정 요청'}</Text><Text>기존: {editing.original.work_date} {labels[editing.original.portion]}</Text>{press('변경 그만하기',()=>{setEditing(null);setDate('');setStage('overview');},busy||uncertain)}</View>:null}
   {!editing?<><Text style={styles.label}>하루 쉬나요, 여러 날 쉬나요?</Text><View style={styles.periodChoices}>
    {(['one','many'] as const).map(p=><Pressable key={p} accessibilityRole="button" accessibilityState={{selected:period===p}} disabled={busy||uncertain} onPress={()=>changePeriod(p)} style={[styles.periodOption,period===p?(p==='many'?styles.periodManySelected:styles.periodSelected):null]}><Text style={[styles.periodTitle,p==='many'?styles.manyText:null,period===p?styles.primaryText:null]}>{period===p?'✓ ':''}{p==='one'?'하루 신청':'여러 날 신청'}</Text><Text style={[styles.portionUnits,period===p?styles.primaryText:null]}>{p==='one'?'날짜 1개':'날짜 2개 이상'}</Text></Pressable>)}
   </View></>:null}
   {editing?.action!=='cancel'?<Text style={styles.label}>{period==='many'?'쉬는 날짜를 하나씩 선택해주세요':'언제 쉬실 건가요?'}</Text>:null}
   {editing?.action!=='cancel'?press(period==='many'&&!editing?'＋ 날짜 선택':date||'달력에서 날짜 선택',()=>setPicker(true),busy||uncertain||!context.configured||(period==='many'&&days.length>=31)):null}
   {picker?<DateTimePicker value={cursor>=min?cursor:min} mode="date" display="calendar" minimumDate={min} onChange={(_event,value)=>{setPicker(false);if(_event.type!=='dismissed'&&value){const picked=`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;if(period==='many'&&!editing){if(days.length>=31)Alert.alert('날짜 선택','한 번에 최대 31일을 선택할 수 있어요.');else if(!days.some(d=>d.date===picked))setDays([...days,{date:picked,portion}].sort((a,b)=>a.date.localeCompare(b.date)));else Alert.alert('이미 선택한 날짜','다른 날짜를 선택해주세요.');}else setDate(picked);}}}/>:null}
   {editing?.action!=='cancel'?<Text style={styles.hint}>사용일 3일 전까지 신청할 수 있어요.</Text>:null}
   {!editing&&chosenCount>0?<View style={[styles.selectedDays,period==='many'?styles.manyDays:null]}>
    <Text style={[styles.selectedCount,period==='many'?styles.manyText:null]}>{period==='one'?'하루 신청 · 1일':`여러 날 신청 · 총 ${chosenCount}일`}</Text>
    <Text style={styles.hint}>사용 연차 {chosenUnits}개</Text>
    {period==='many'?days.map((d,i)=><View key={d.date} style={styles.dayRow}><View style={styles.dayDescription}><Text style={styles.dayNumber}>{i+1}번째 날짜</Text><Text style={styles.label}>{d.date} · {labels[d.portion]}</Text></View>{press('제외',()=>setDays(days.filter(x=>x.date!==d.date)),busy||uncertain,'quiet')}</View>):<Text style={styles.label}>{date} · {labels[portion]}</Text>}
   </View>:null}
   {uncertain?<Text>전송 결과를 확인하지 못했습니다. 같은 신청을 다시 보내면 중복 없이 결과를 확인합니다.</Text>:null}
   {editing?press(busy?'처리 중…':uncertain?'같은 변경 다시 보내기':'변경 내용 확인',confirmChange,busy||loading,'primary'):press(busy?'처리 중…':uncertain?'같은 신청 다시 보내기':period==='one'?'하루 신청 확인':chosenCount<2?'날짜 2개 이상 선택':`${chosenCount}일 신청 확인`,confirmSubmission,busy||loading||!context.configured||(!chosenCount||period==='many'&&chosenCount<2),'primary')}
   </View>}
   {stage==='form'?press(helpOpen?'신청 안내 접기':'신청 안내',()=>setHelpOpen(!helpOpen),false,'quiet'):null}
   {stage==='form'&&helpOpen?<View style={styles.help}><Text style={styles.hint}>하루에 연차 1개를 사용합니다.</Text><Text style={styles.hint}>대기 신청분은 남은 개수에서 제외됩니다.</Text><Text style={styles.hint}>승인 전 수정·취소는 횟수 제한이 없습니다. 승인 후에는 매월 수정 2회·취소 2회까지 요청할 수 있습니다.</Text></View>:null}
  </>:null}
 </ScrollView>{session?<EmployeeBottomTabs selected="leave" preview={preview} disabled={busy||uncertain} onHomePress={goHome}/>:null}</View>;
}
const styles=StyleSheet.create({recordDate:{fontSize:22,fontWeight:'800',color:'#173f31'},status:{fontSize:20,fontWeight:'800',color:'#755000',paddingVertical:6},approved:{color:'#176133'},confirmTitle:{fontSize:28,fontWeight:'800',color:'#173f31'},periodManySelected:{backgroundColor:'#24547c',borderColor:'#24547c'},manyDays:{backgroundColor:'#eef4fa',borderColor:'#24547c'},manyText:{color:'#24547c'},manyPrimary:{backgroundColor:'#24547c'},periodChoices:{flexDirection:'row',gap:10},periodOption:{flex:1,padding:12,minHeight:85,borderWidth:1.5,borderColor:'#a9beb0',borderRadius:14,justifyContent:'center',gap:7},periodSelected:{backgroundColor:'#173f31',borderColor:'#173f31'},periodTitle:{fontSize:18,fontWeight:'800',color:'#173f31'},selectedDays:{padding:16,borderRadius:14,borderWidth:2,borderColor:'#356c4b',backgroundColor:'#eef5ef',gap:9},selectedCount:{fontSize:22,fontWeight:'800',color:'#173f31'},dayRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8,borderTopWidth:1,borderTopColor:'#cfdfd2',paddingTop:9},dayDescription:{flex:1,gap:4},dayNumber:{fontSize:13,color:'#476350'},header:{flexDirection:'row',justifyContent:'space-between'},label:{fontSize:17,fontWeight:'700',color:'#173f31'},hint:{fontSize:14,lineHeight:21,color:'#607367'},balanceCard:{padding:20,borderRadius:20,backgroundColor:'#e9f1eb',gap:6},formCard:{padding:18,borderRadius:20,backgroundColor:'#fff',gap:14,borderWidth:1,borderColor:'#dbe5de'},primary:{backgroundColor:'#173f31',borderWidth:0,minHeight:58,alignItems:'center'},primaryText:{color:'#fff'},quiet:{backgroundColor:'transparent',borderWidth:0,minHeight:40,padding:4},sectionTitle:{fontSize:20,fontWeight:'800',color:'#173f31'},help:{gap:8,paddingHorizontal:8},portionUnits:{fontSize:14,color:'#607367'},input:{minHeight:48,borderWidth:1,borderColor:'#a3b4a9',borderRadius:8,padding:12,fontSize:17},page:{flex:1,backgroundColor:'#f6f4ed'},title:{fontSize:23,fontWeight:'800',color:'#173f31'},balance:{fontSize:48,fontWeight:'800',color:'#173f31'},button:{minHeight:52,padding:14,borderRadius:12,backgroundColor:'#fff',borderWidth:1,borderColor:'#cbd9cf',justifyContent:'center'},buttonText:{color:'#173f31',fontSize:22,fontWeight:'600'},disabled:{opacity:.45},record:{gap:8,padding:16,backgroundColor:'#fff',borderRadius:12}});

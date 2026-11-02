import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useMyLeave } from './use-my-leave';
function LeaveCard({balance,preview=false}:{balance:string;preview?:boolean}){
 const router=useRouter();const open=()=>router.push(preview?'/leave?preview=1':'/leave');
 return <View style={styles.card}>
  <View style={styles.heading}><Text style={styles.title}>내 연차</Text><Text style={styles.balance}>{balance}</Text></View>
  <Pressable accessibilityRole="button" accessibilityLabel="연차 신청" style={styles.primary} onPress={open}><Text style={styles.primaryText}>연차 신청</Text></Pressable>
  <Pressable accessibilityRole="button" onPress={open} style={styles.history}><Text style={styles.historyText}>신청 내역 보기 →</Text></Pressable>
  {preview?<Text style={styles.hint}>화면 체험 · 예시 데이터</Text>:null}
 </View>;
}
function ServerLeaveCard(){const {context,error,loading}=useMyLeave();return <LeaveCard balance={loading?'확인 중…':error||!context?'조회 필요':context.configured?`남은 연차 ${context.remaining}개`:'관리자 등록 대기'}/>;}
export function LeaveHomeAction({preview=false}:{preview?:boolean}){return preview?<LeaveCard preview balance="남은 연차 7개"/>:<ServerLeaveCard/>;}
const styles=StyleSheet.create({card:{padding:20,borderRadius:28,backgroundColor:'#fff',borderWidth:1.5,borderColor:'#34624b',gap:12},heading:{gap:5},title:{fontSize:21,fontWeight:'800',color:'#173f31'},balance:{fontSize:18,fontWeight:'600',color:'#173f31'},primary:{minHeight:58,borderRadius:14,backgroundColor:'#173f31',alignItems:'center',justifyContent:'center'},primaryText:{fontSize:22,fontWeight:'800',color:'#fff'},history:{minHeight:40,alignItems:'center',justifyContent:'center'},historyText:{fontSize:16,fontWeight:'600',color:'#34624b'},hint:{fontSize:12,color:'#607367',textAlign:'center'}});

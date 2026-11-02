import { Pressable, StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useMyLeave } from './use-my-leave';
export function LeaveHomeAction(){
 const {context,error,loading,reload}=useMyLeave();const router=useRouter();
 return <Pressable accessibilityRole="button" accessibilityLabel="내 연차 확인 및 신청" style={styles.card} onPress={()=>error?void reload():router.push('/leave')}>
  <Text style={styles.title}>내 연차</Text><Text style={styles.text}>{loading?'확인 중…':error||!context?'다시 확인하기':context.configured?`남은 연차 ${context.remaining}개`:'관리자 등록 대기'}</Text>
  <Text style={styles.text}>확인·신청 →</Text>
 </Pressable>;
}
const styles=StyleSheet.create({card:{padding:22,borderRadius:28,backgroundColor:'#fff',gap:8,minHeight:110},title:{fontSize:21,fontWeight:'800',color:'#173f31'},text:{fontSize:17,color:'#173f31'}});

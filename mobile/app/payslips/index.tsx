import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { loadMyFinalPayslips, payslipPath, type PayslipSummary } from '@/src/features/payslips/payslip-api';
import { usePlatform } from '@/src/providers/platform-provider';

const won = (value: number | null) => value == null ? '-' : `${new Intl.NumberFormat('ko-KR').format(value)}원`;
export default function PayslipList() {
  const router = useRouter(); const insets = useSafeAreaInsets(); const { client, session } = usePlatform();
  const [items, setItems] = useState<PayslipSummary[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const load = useCallback(async () => { if (!client || !session) return; setLoading(true); setError(''); try { setItems(await loadMyFinalPayslips(client)); } catch { setError('급여명세서를 불러오지 못했습니다. 인터넷을 확인한 뒤 다시 눌러주세요.'); } finally { setLoading(false); } }, [client, session]);
  useEffect(() => { void load(); }, [load]);
  return <View style={[s.page, { paddingTop: insets.top, paddingBottom: insets.bottom }]}><ScrollView contentContainerStyle={s.scroll}>
    <Pressable accessibilityRole="button" accessibilityLabel="설정으로 돌아가기" onPress={() => router.replace('/settings')}><Text style={s.back}>← 설정</Text></Pressable>
    <Text style={s.title}>급여명세</Text><Text style={s.help}>서버에서 확정된 내 급여명세만 보여드립니다.</Text>
    {loading ? <View style={s.loading}><ActivityIndicator /><Text style={s.help}>명세서를 확인하고 있습니다.</Text></View> : null}
    {!loading && error ? <Pressable onPress={() => void load()} style={s.retry}><Text style={s.retryText}>{error}</Text><Text style={s.retryText}>다시 확인</Text></Pressable> : null}
    {!loading && !error && !items.length ? <Text style={s.empty}>현재 확인할 확정 급여명세서가 없습니다.</Text> : null}
    {!loading && !error ? items.map(item => <Pressable key={item.payroll_month} accessibilityRole="button" accessibilityLabel={`${item.payroll_month} 급여명세 열기`} onPress={() => router.push(payslipPath(item.payroll_month))} style={s.card}><Text style={s.month}>{item.payroll_month.slice(0, 7)} 급여명세</Text><Text style={s.net}>실수령액 · {won(item.net_pay)}</Text><Text style={s.detail}>지급액 {won(item.gross_pay)} · 공제액 {won(item.total_deduction)}</Text></Pressable>) : null}
  </ScrollView></View>;
}
const s = StyleSheet.create({ page:{flex:1,backgroundColor:'#f6f4ed'},scroll:{gap:14,padding:22,paddingBottom:40},back:{color:'#35624d',fontSize:16,fontWeight:'800',minHeight:42},title:{color:'#173f31',fontSize:32,fontWeight:'900'},help:{color:'#60746a',fontSize:15,lineHeight:22},loading:{flexDirection:'row',gap:10,alignItems:'center',paddingVertical:16},card:{gap:8,padding:18,borderRadius:18,borderWidth:1,borderColor:'#d7ded8',backgroundColor:'#fff'},month:{color:'#173f31',fontSize:21,fontWeight:'900'},net:{color:'#173f31',fontSize:18,fontWeight:'800'},detail:{color:'#52685d',fontSize:14,fontWeight:'700'},empty:{padding:18,borderRadius:16,backgroundColor:'#fff',color:'#43584d',fontSize:16,textAlign:'center'},retry:{gap:8,padding:16,borderRadius:16,backgroundColor:'#fff0ed'},retryText:{color:'#8b2f2f',fontSize:15,fontWeight:'800',textAlign:'center'} });

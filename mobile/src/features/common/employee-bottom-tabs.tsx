import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type Props = { selected: 'attendance' | 'leave'; preview?: boolean; disabled?: boolean; onHomePress?: () => void };
// Shared by the two employee screens, outside their scrolling content.
export function EmployeeBottomTabs({ selected, preview=false, disabled=false, onHomePress }: Props) {
  const router=useRouter();
  return <View accessibilityRole="tablist" style={styles.bar}>
    {([{key:'attendance',label:'출퇴근',icon:'✓'},{key:'leave',label:'내 연차',icon:'▦'}] as const).map(tab=>{
      const active=tab.key===selected;
      return <Pressable key={tab.key} accessibilityRole="tab" accessibilityLabel={tab.label} accessibilityState={{selected:active,disabled}} disabled={disabled} style={[styles.tab,active?styles.active:null]} onPress={()=>{
        if(active)return;
        if(tab.key==='attendance'){if(onHomePress)onHomePress();else router.navigate('/');}
        else router.navigate(preview?'/leave?preview=1':'/leave');
      }}><Text accessible={false} style={[styles.icon,active?styles.activeText:null]}>{tab.icon}</Text><Text style={[styles.label,active?styles.activeText:null]}>{tab.label}</Text></Pressable>;
    })}
  </View>;
}
const styles=StyleSheet.create({bar:{flexDirection:'row',gap:8,padding:8,borderTopWidth:1,borderTopColor:'#a9beb0',backgroundColor:'#f6f4ed'},tab:{flex:1,minWidth:0,minHeight:88,padding:10,borderRadius:16,alignItems:'center',justifyContent:'center',gap:5},active:{backgroundColor:'#173f31'},icon:{fontSize:27,color:'#173f31'},label:{fontSize:23,fontWeight:'800',color:'#173f31',textAlign:'center'},activeText:{color:'#fff'}});

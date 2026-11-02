import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { usePlatform } from '@/src/providers/platform-provider';
import { loadMyLeave, leaveError, type LeaveContext } from './leave-api';
export function useMyLeave(enabled=true) {
  const { client, session }=usePlatform(); const [context,setContext]=useState<LeaveContext|null>(null); const [owner,setOwner]=useState<string|null>(null);
  const [error,setError]=useState(''); const [loading,setLoading]=useState(false); const sequence=useRef(0);
  const reload=useCallback(async()=>{
    const token=++sequence.current; if(!enabled||!client||!session){setContext(null);setLoading(false);setError('');return;}
    setLoading(true);setError('');try{const value=await loadMyLeave(client);if(token===sequence.current){setContext(value);setOwner(session.user.id);}}
    catch(e){if(token===sequence.current){setContext(null);setError(leaveError(e));}}
    finally{if(token===sequence.current)setLoading(false);}
  },[client,session?.user.id,enabled]);
  useEffect(()=>{setContext(null);void reload();const sub=AppState.addEventListener('change',s=>{if(s==='active')void reload();});return()=>{++sequence.current;sub.remove();};},[reload]);
  return {context:owner===session?.user.id?context:null,error,loading,reload};
}

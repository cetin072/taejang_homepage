import {validateChange,changePassword} from './change-password-api.mjs';
const form=document.getElementById('change-password-form'),message=document.getElementById('change-message');
const button=document.getElementById('change-submit');
const errors={EMAIL_INVALID:'로그인 아이디를 확인해주세요.',CURRENT_REQUIRED:'현재 비밀번호를 입력해주세요.',
 TOO_SHORT:'새 비밀번호는 8자 이상 입력해주세요.',MUST_DIFFER:'지금과 다른 새 비밀번호를 입력해주세요.',
 NOT_EQUAL:'새 비밀번호 두 칸이 다릅니다.',BAD_LOGIN:'아이디 또는 현재 비밀번호를 확인해주세요.',
 RATE_LIMIT:'요청이 많습니다. 잠시 후 다시 시도해주세요.',NEW_PASSWORD_REJECTED:'이 비밀번호는 사용할 수 없습니다. 다르게 정해주세요.',
 UPDATE_FAILED:'비밀번호 변경에 실패했습니다. 운영총괄에게 문의해주세요.',
 NETWORK:'인터넷 연결을 확인해주세요.',NO_SESSION:'로그인을 확인할 수 없습니다. 다시 시도해주세요.',
 CONFIG_INVALID:'로그인 서비스가 준비되지 않았습니다. 운영총괄에게 문의해주세요.'};
const announce=(text,bad=false)=>{message.textContent=text;message.hidden=!text;message.classList.toggle('error',bad);};
form.addEventListener('submit',async event=>{
 event.preventDefault();if(button.disabled)return;announce('');
 const v={email:form.elements.email.value,current:form.elements.current_password.value,
 next:form.elements.new_password.value,confirm:form.elements.confirm_password.value};
 try{validateChange(v);}catch(e){announce(errors[e.message]||errors.UPDATE_FAILED,true);return;}
 button.disabled=true;button.textContent='변경 중…';
 try{
   const response=await fetch('/.netlify/functions/staff-config',{credentials:'omit',cache:'no-store',redirect:'error'});
   if(!response.ok)throw Error('CONFIG_INVALID');
   await changePassword(v,await response.json());
   form.reset();announce('비밀번호 변경 완료! 이제 직원앱에서 새 비밀번호로 로그인해주세요.');
 }catch(e){announce(errors[e.message]||errors.UPDATE_FAILED,true);}
 finally{button.disabled=false;button.textContent='내 비밀번호 변경하기';}
});

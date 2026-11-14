/* Adapted from the approved Cheongwoo quote v8. No browser storage or external service. */
(function (host) {
  'use strict';
  const ROLES = ['department_lead', 'promotion_lead', 'operations_manager', 'ceo'];
  const MAX = 1000000000000;
  const DEFAULTS = { issuer: '청우유통', shelf: 15000, repack: 500, individualLabel: 300, bundle: 500, photo: 300,
    boxes: { basic: 500, u1: 560, u2: 640, u21: 720, u3: 880, u4: 1360, u5: 1840, provided: 0 },
    shipping: [2600, 3500, 4500, 6000, 8000, 12000] };
  const BOXES = { basic:'기본 박스',u1:'우체국 1호형',u2:'우체국 2호형',u21:'우체국 2-1호형',u3:'우체국 3호형',u4:'우체국 4호형',u5:'우체국 5호형',provided:'고객 제공 박스' };
  const STAGES = ['1차 작업 · 입고 확인과 분류','2차 작업 · 재포장과 개별 송장','3차 작업 · 합포장 및 출고 준비','4차 작업 · 국내 발송','기타 비용'];
  const ROWS = [
    ['receive',1,'상품 입고 확인','free'], ['damage',1,'개봉 후 파손 상품 확인','free'], ['unbox',1,'기존 박스 포장 해체','free'],
    ['innerBox',2,'규격에 맞는 새 박스 선택','box'], ['repack',2,'개별 재포장 + 기본 뽁뽁이','normal'], ['individualLabel',2,'별도 운송장 출력 및 부착','normal'],
    ['bundle',3,'큰 박스 한 개로 합배송 작업','normal'], ['outerBox',3,'합배송용 대형 외박스','box'], ['photo',3,'무게·부피 측정 및 사진 전달','photo'], ['finalLabel',3,'최종 배대지 주소 운송장 부착','free'],
    ['ship',4,'국내 택배 발송','shipping'], ['trackingReply',4,'송장번호 정리 및 회신','free']
  ];
  const copy = value => JSON.parse(JSON.stringify(value));
  function integer(value, label, min=0, max=MAX) {
    if (value === '' || value == null || !Number.isSafeInteger(Number(value)) || Number(value)<min || Number(value)>max) throw Error(label+'을 확인하세요.');
    return Number(value);
  }
  function draft(rates=DEFAULTS) {
    return { customerId:'', issuer:rates.issuer, issueDate:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(new Date()),
      validity:'30일', pickup:'', dropoff:'', photoMonth:1,
      lines:ROWS.map(([key,stage,label,kind])=>({key,stage,label,kind,quantity:kind==='free'?0:1,
        unitPrice:kind==='free'?0:key==='innerBox'?rates.boxes.basic:key==='outerBox'?rates.boxes.u5:key==='ship'?rates.shipping[0]:rates[key],
        option:key==='innerBox'?'basic':key==='outerBox'?'u5':''})),
      storage:{shelves:1,startMonth:1,months:1,rate:rates.shelf},discount:0,vatMode:'exclusive',feeEnabled:false,feeRate:20 };
  }
  function calculate(input) {
    if(!input || !Array.isArray(input.lines) || input.lines.length<ROWS.length || input.lines.length>52) throw Error('작업 항목을 확인하세요.');
    const seen=new Set(); let workSubtotal=0;
    const photoMonth=integer(input.photoMonth,'사진 서비스 적용 월',1,1200);
    const lines=input.lines.map(line=>{
      if(!line || typeof line.key!=='string' || seen.has(line.key) || typeof line.label!=='string' || !line.label.trim() || line.label.length>120) throw Error('작업 항목을 확인하세요.');
      seen.add(line.key);
      const standard=ROWS.find(row=>row[0]===line.key);
      if(!standard && !line.key.startsWith('extra-')) throw Error('작업 항목을 확인하세요.');
      const kind=standard?standard[3]:'extra';
      const quantity=integer(line.quantity,line.label+' 수량',0,1000000);
      const unitPrice=integer(line.unitPrice,line.label+' 단가',0,100000000);
      if(kind==='free' && (quantity!==0 || unitPrice!==0)) throw Error('기본 무료 항목은 0원입니다.');
      const waived=kind==='free' || (kind==='photo' && photoMonth===1);
      const amount=waived?0:quantity*unitPrice;
      integer(amount,'작업 금액'); workSubtotal+=amount;
      return {...line,kind,stage:standard?standard[1]:5,amount,waived};
    });
    if(ROWS.some(row=>!seen.has(row[0]))) throw Error('기본 작업 항목이 누락되었습니다.');
    const storage=input.storage||{};
    const shelves=integer(storage.shelves,'선반 칸 수',0,100000), startMonth=integer(storage.startMonth,'선반 시작 월차',1,1200);
    const months=integer(storage.months,'보관 개월',1,1200),rate=integer(storage.rate,'보관 단가',0,100000000);
    if(startMonth+months-1>1200) throw Error('보관 기간을 확인하세요.');
    const basicShelfMonths=shelves>0?Math.max(0,startMonth+months-4)-Math.max(0,startMonth-4):0;
    const extraShelfMonths=Math.max(0,shelves-1)*months;
    const storageAmount=(basicShelfMonths+extraShelfMonths)*rate;
    const subtotal=integer(workSubtotal+storageAmount,'합계');
    const discount=integer(input.discount,'할인액',0,subtotal),after=subtotal-discount;
    if(!['inclusive','exclusive'].includes(input.vatMode)) throw Error('부가세 방식을 선택하세요.');
    // Positive integer rounding, avoiding binary floating point for VAT and fees.
    const roundDiv=(a,b)=>Number((a+b/2n)/b);
    const supply=input.vatMode==='inclusive'?roundDiv(BigInt(after)*10n,11n):after;
    const vat=input.vatMode==='inclusive'?after-supply:roundDiv(BigInt(supply),10n);
    const percent=Number(input.feeRate);
    if(!Number.isFinite(percent)||percent<0||percent>100||Math.abs(percent*100-Math.round(percent*100))>0.00001) throw Error('수수료율은 0~100%, 소수 둘째 자리까지 입력하세요.');
    const platform=input.feeEnabled?roundDiv(BigInt(supply)*BigInt(Math.round(percent*100)),10000n):0;
    const total=integer(supply+vat+platform,'최종 금액');
    return {lines,workSubtotal,storageAmount,subtotal,discount,supply,vat,platform,total,basicShelfMonths,extraShelfMonths};
  }
  function allowed(app) {
    return !!app && app.getAccessContext?.()?.account_status==='active' && !app.getAccessContext?.()?.role_simulation?.active
      && ROLES.some(role=>app.getActualRoles?.().includes(role)) && ROLES.some(role=>app.getEffectiveRoles?.().includes(role));
  }
  const api={ROLES,DEFAULTS,BOXES,STAGES,ROWS,MAX,copy,draft,calculate,allowed,integer};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
  if(host)host.TaejangLogisticsCore=api;
})(typeof window!=='undefined'?window:null);

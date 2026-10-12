/* #414 검증 — MD 버튼판 투입: 코드↔문안·버튼 자동 일치·문안 동일성·env 롤백 시 자동 복귀 (실모듈·발송 0) */
delete process.env.ALIGO_TPL_CODE; delete process.env.ALIGO_TPL_CODE_RESERVE; delete process.env.ALIGO_TPL_CODE_GUIDE;
process.env.KAKAO_NOTIFY = 'off';   // dry 경로 강제 — 어떤 실호출도 없음
const PROJ = 'C:\\Users\\전승범\\OneDrive\\문서\\★제주아꼼이네 회사프로그램';
const K = require(PROJ + '\\kakao-notify.js');
let pass = 0, fail = 0;
const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + d : '')); };

(async () => {
  // ① 기본 코드 = MD판
  ok(K.orderTplCode(false) === 'UK_5754' && K.orderTplCode(true) === 'UK_5755', '① 주문 코드 기본값 = UK_5754/UK_5755', K.orderTplCode(false) + '/' + K.orderTplCode(true));
  ok(K.APPROVED_TPL.guide === 'UM_2824' && K.APPROVED_TPL.welcome === 'UK_5877', '① 발송안내 UM_2824(발송안내4 · #679) · 가입환영 UK_5877(가입환영2) 유지', K.APPROVED_TPL.guide);   // #585: 가입환영은 UK_5877 로 바뀐 지 오래(기대값만 갱신)

  // ② 코드↔문안·버튼 자동 일치 — 주문 템플릿이 MD판 엔트리를 집는다
  const tN = K.orderTemplate(false), tR = K.orderTemplate(true);
  ok(tN && tN.key === 'order_normal_md' && tR && tR.key === 'order_reserve_md', '② orderTemplate = MD판 엔트리', tN.key + '/' + tR.key);
  const btnN = tN.button && tN.button.button;
  ok(Array.isArray(btnN) && btnN.length === 3 && btnN[2].linkType === 'MD' && btnN[2].name === '문의하기', '② 일반 버튼 3개·마지막 [문의하기](MD)', JSON.stringify(btnN.map(b => b.linkType)));
  const gMd = K.templateByKey('ship_guide_md');
  const gBtn = gMd.button && gMd.button.button;
  ok(Array.isArray(gBtn) && gBtn.length === 4 && gBtn[3].linkType === 'MD', '② 발송안내 버튼 4개·마지막 MD', JSON.stringify(gBtn.map(b => b.linkType)));

  // ③ 문안 동일성 — MD판 content = 승인 구판 content (버튼만 다름·문면 무회귀)
  const same = (a, b) => K.templateByKey(a).content === K.templateByKey(b).content;
  ok(same('order_normal', 'order_normal_md'), '③ 일반 문안 = 구판과 바이트 동일');
  ok(same('order_reserve', 'order_reserve_md'), '③ 예약 문안 = 구판과 바이트 동일');
  ok(same('ship_guide', 'ship_guide_md'), '③ 발송안내 문안 = 구판과 바이트 동일');

  // ④ 발송안내 dry 경로 — MD판 문안으로 조립(스위치 off → 실호출 0)
  const vars = { '고객명': '검증', '상품명': '테스트 상품', '도착안내': '내일 도착 예정', '발송일': '10/12(월)', '상품코드': '1', '송장번호': '123' };
  const dry = await K.sendShippingGuideAlimtalk({ receiver: '01000000000', vars, fallback: { message: 'FB' } });
  ok(dry.mode === 'dry-run' && dry.via === 'alimtalk-e' && dry.messageText.includes('검증님'), '④ 발송안내 dry 조립 정상(실호출 0)', dry.status);

  // ⑥ #679 발송안내4(UM_2824) — 문안은 발송안내3과 「오늘」→「#{발송일}」 한 곳만 다르고 버튼 4개는 같다 · 발송일이 빠지면 그 줄이 지워진다(= 카카오 거절 → 대체 문자) · env 로 UK_5756 롤백
  const g4 = K.templateByKey('ship_guide4');
  ok(g4 && gMd.content.replace('오늘 출발했습니다!', '#{발송일} 출발했습니다!') === g4.content && JSON.stringify(g4.button) === JSON.stringify(gMd.button), '⑥ 발송안내4 문안 = 발송안내3 에서 한 곳만 · 버튼 4개 동일');
  const v4 = vars; const noDay = Object.assign({}, vars); delete noDay['발송일'];
  const dryNo = await K.sendShippingGuideAlimtalk({ receiver: '01000000000', vars: noDay, fallback: { message: 'FB' } });
  const d4 = await K.sendShippingGuideAlimtalk({ receiver: '01000000000', vars: v4, fallback: { message: 'FB' } });
  ok(d4.messageText === g4.content.replace('#{고객명}', '검증').replace('#{상품명}', '테스트 상품').replace('#{발송일}', '10/12(월)').replace('#{도착안내}', '내일 도착 예정') && !d4.messageText.includes('#{'), '⑥ 기본 코드 = 발송안내4 문안으로 조립(변수 4개 치환 · 남은 자리표 0)', d4.messageText.split(String.fromCharCode(10))[1]);
  ok(!dryNo.messageText.includes('출발했습니다'), '⑥ 발송일 없이 부르면 그 줄이 빠진다(호출부 두 곳이 늘 채워야 함)');
  const srv = require('fs').readFileSync(require('path').join(PROJ, 'server.js'), 'utf8');
  ok(srv.split("'발송일': kstMdDow(Date.now())").length - 1 === 2 && srv.split('kakaoNotify.sendShippingGuideAlimtalk(').length - 1 === 2, '⑥ server.js 발송안내 호출 2곳 모두 발송일을 채움');
  process.env.ALIGO_TPL_CODE_GUIDE = 'UK_5756';
  const dOld = await K.sendShippingGuideAlimtalk({ receiver: '01000000000', vars: v4, fallback: { message: 'FB' } });
  ok(dOld.messageText.includes('오늘 출발했습니다!') && !dOld.messageText.includes('10/12(월)'), '⑥ env=UK_5756 → 발송안내3 문안으로 자동 복귀(롤백)');
  delete process.env.ALIGO_TPL_CODE_GUIDE;

  // ⑤ env 롤백 = 코드·문안·버튼 세트가 통째로 구판 복귀(불일치 원천 차단 증명)
  process.env.ALIGO_TPL_CODE = 'UJ_9084'; process.env.ALIGO_TPL_CODE_RESERVE = 'UJ_9085';
  const oldN = K.orderTemplate(false), oldR = K.orderTemplate(true);
  ok(K.orderTplCode(false) === 'UJ_9084' && oldN.key === 'order_normal' && (oldN.button.button || []).length === 2, '⑤ env=UJ_9084 → 구판 문안·구버튼(2개) 자동 복귀', oldN.key);
  ok(K.orderTplCode(true) === 'UJ_9085' && oldR.key === 'order_reserve', '⑤ 예약도 동일 복귀', oldR.key);
  delete process.env.ALIGO_TPL_CODE; delete process.env.ALIGO_TPL_CODE_RESERVE;
  ok(K.orderTemplate(false).key === 'order_normal_md', '⑤ env 제거 → MD판 재복귀', '');

  console.log('\n═══ 결과: ' + pass + '/' + (pass + fail) + (fail ? ' ❌ 실패 ' + fail : ' ✅ 전항목 통과'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

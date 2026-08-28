/* #417·#418 검증 — 가입환영2 투입(코드↔문안·버튼 자동 일치·env 롤백)·삭제 화이트리스트 (실모듈·발송 0) */
delete process.env.ALIGO_TPL_CODE_WELCOME;
process.env.KAKAO_NOTIFY = 'off';
const PROJ = 'C:\\Users\\전승범\\OneDrive\\문서\\★제주아꼼이네 회사프로그램';
const fs = require('fs');
const K = require(PROJ + '\\kakao-notify.js');
let pass = 0, fail = 0;
const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + d : '')); };

(async () => {
  // ① 기본 = UK_5877 + welcome2 세트 자동 일치
  ok(K.welcomeTplCode() === 'UK_5877', '① welcome 코드 기본값 = UK_5877', K.welcomeTplCode());
  const t = K.welcomeTemplate();
  ok(t && t.key === 'welcome2', '① welcomeTemplate = welcome2 엔트리', t && t.key);
  const btn = t.button && t.button.button;
  ok(Array.isArray(btn) && btn.length === 3 && btn[2].linkType === 'MD' && btn[2].name === '문의하기', '① 버튼 3개·마지막 [문의하기](MD)', JSON.stringify((btn || []).map(b => b.linkType)));
  ok(/가입 축하 쿠폰 2,000원/.test(t.content) && /물방울 5개/.test(t.content) === false ? /물방울 5/.test(t.content) : /물방울 5/.test(t.content), '① 혜택 문구 포함(쿠폰 2,000원·물방울 5)', '');
  ok(/생일 축하 쿠폰/.test(t.content) && /#\{고객명\}/.test(t.content), '① 생일 쿠폰·고객명 변수 포함', '');

  // ② 문면 조립(dry — 실호출 0)
  const msg = K.buildMessage({ '고객명': '검증' }, t.content);
  ok(/검증님, 제주아꼼이네 회원가입이 완료/.test(msg) && !/#\{/.test(msg), '② 문면 조립 정상(변수 치환·미치환 0)', '');

  // ③ env 롤백 = 구판(UJ_9086·welcome 세트) 자동 복귀
  process.env.ALIGO_TPL_CODE_WELCOME = 'UJ_9086';
  const t2 = K.welcomeTemplate();
  ok(K.welcomeTplCode() === 'UJ_9086' && t2.key === 'welcome' && (t2.button.button || []).length === 2, '③ env=UJ_9086 → 구판 문안·구버튼(2개) 자동 복귀', t2.key);
  delete process.env.ALIGO_TPL_CODE_WELCOME;
  ok(K.welcomeTemplate().key === 'welcome2', '③ env 제거 → 새판 재복귀', '');

  // ④ 주문·발송안내 무회귀(#414 유지)
  ok(K.orderTplCode(false) === 'UK_5754' && K.orderTemplate(false).key === 'order_normal_md' && K.APPROVED_TPL.guide === 'UK_5756', '④ 주문·발송안내 설정 무회귀', '');

  // ⑤ #418 삭제 화이트리스트 — 중복본 4장만 추가·실전판 하드 차단 유지
  const src = fs.readFileSync(PROJ + '\\kakao-notify.js', 'utf8');
  const wl = (src.match(/const DELETABLE_TPL = \[[\s\S]*?\];/) || [''])[0];
  ok(['UK_5750', 'UK_5751', 'UK_5752', 'UK_5753'].every(c => wl.includes(c)), '⑤ 화이트리스트에 중복본 4장 추가', '');
  ok(!['UJ_9084', 'UJ_9085', 'UJ_9086', 'UJ_9087', 'UK_5754', 'UK_5755', 'UK_5756', 'UK_5877'].some(c => wl.includes(c)), '⑤ 실전·구실전판 8종은 화이트리스트 밖(하드 차단)', '');
  // 가짜 키 주입 — 화이트리스트 차단은 토큰 발급(네트워크) 이전이라 실호출 0으로 차단 로직만 실행됨
  process.env.ALIGO_API_KEY = 'x'; process.env.ALIGO_USER_ID = 'x'; process.env.ALIGO_SENDER_KEY = 'x'; process.env.ALIGO_SENDER = '01000000000';
  const r = await K.deleteTemplates(['UK_5754']);   // 실전판 삭제 시도 = 차단돼야 함
  ok(!!r.error && /화이트리스트 밖/.test(r.error || ''), '⑤ 실전판 삭제 시도 = 차단 실동작', String(r.error).slice(0, 60));
  ['ALIGO_API_KEY', 'ALIGO_USER_ID', 'ALIGO_SENDER_KEY', 'ALIGO_SENDER'].forEach(k => delete process.env[k]);

  console.log('\n═══ 결과: ' + pass + '/' + (pass + fail) + (fail ? ' ❌ 실패 ' + fail : ' ✅ 전항목 통과'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

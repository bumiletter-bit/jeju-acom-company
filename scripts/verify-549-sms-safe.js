// #549 검증: 문자로 나가는 글에서 이모지가 빠지는가(알림톡 본문은 그대로) — kakao-notify.js 실코드
const k = require('../kakao-notify.js');
let pass = 0, fail = 0; const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '✅ ' : '❌ ') + t + (d ? ' — ' + d : '')); };
const tpl = k.orderTemplate(false);
const msg = k.buildMessage({ '고객명': '시험', '상품명': '(제철)고당도 하우스감귤 행사★하우스귤 2.5kg로얄과→중량up 4kg', '발송안내': '내일 화요일 오전 발송, 수~목 도착 예정' }, tpl && tpl.content);
const out = k.smsSafe(msg);
console.log('--- 문자로 나갈 글 ---\n' + out + '\n---');
const euckrBad = s => [...s].filter(ch => ch.codePointAt(0) > 0xFFFF || /\p{Extended_Pictographic}/u.test(ch) && !'☎★☆♥♡♠♣♤♧☜☞♨♪♬▶◀※↔↕™©®'.includes(ch));
ok(/\p{Extended_Pictographic}/u.test(msg), '알림톡 본문에는 이모지가 있다(원문 그대로)');
ok(euckrBad(out).length === 0, '문자 글에 이모지 0', euckrBad(out).join(''));
ok(out.includes('행사★하우스귤 2.5kg로얄과→중량up 4kg') && out.includes('▶'), '★ → ▶ 는 그대로');
ok(/☎ 010-6687-4031/.test(out), '전화기 그림 → ☎');
ok(!/^[ \t]|[ \t]$/m.test(out) && !/ {2,}/.test(out), '줄 앞뒤 빈칸·겹친 빈칸 없음');
ok(out.replace(/[☎]/g, '').length <= msg.length && out.split('\n').length === msg.split('\n').length, '줄 수 그대로');
ok(k.smsSafe('가나다 abc 123 !?~^^') === '가나다 abc 123 !?~^^' && k.smsSafe('') === '' && k.smsSafe(null) === '', '보통 글·빈 값 무변');
ok(k.smsSafe('1️⃣ 깃발🇰🇷 손👍🏽 끝') === '1 깃발 손 끝', '숫자 그림·깃발·피부색 조각까지 제거', JSON.stringify(k.smsSafe('1️⃣ 깃발🇰🇷 손👍🏽 끝')));
console.log(`\n결과 ${pass}/${pass + fail}`); process.exit(fail ? 1 : 0);

/* #408 검증 — 카페24 토큰 갱신 실패 분류(일시 vs 재승인) + 회복 알림.
   실모듈(cafe24.js)을 그대로 require — 가짜 pool(메모리)·가짜 notify(수집)·fetch 스텁으로 실행 경로 검증. */
process.env.CAFE24_CLIENT_SECRET = 'verify408secret';
const PROJ = 'C:\\Users\\전승범\\OneDrive\\문서\\★제주아꼼이네 회사프로그램';
const crypto = require('crypto');
let pass = 0, fail = 0;
const ok = (c, t, d) => { c ? pass++ : fail++; console.log((c ? '  ✅ ' : '  ❌ ') + t + (d != null ? ' — ' + d : '')); };

// cafe24.js와 동일 방식으로 토큰 암호문 생성(저장 포맷 재현)
function encrypt(obj) {
  const key = crypto.createHash('sha256').update(process.env.CAFE24_CLIENT_SECRET).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(obj), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}
const past = new Date(Date.now() - 3600000);
const kstStr = (d) => new Date(d.getTime() + 9 * 3600000).toISOString().replace('Z', '');
const storedTokens = { access_token: 'AT_OLD', refresh_token: 'RT1', expires_at: kstStr(past), refresh_token_expires_at: kstStr(new Date(Date.now() + 10 * 86400000)) };

let store = { enc: encrypt(storedTokens) };
const fakePool = { query: async (sql) => /SELECT value/.test(sql) ? { rows: [{ value: store }] } : (/INSERT INTO/.test(sql) ? { rows: [] } : { rows: [] }) };
const alerts = [];
const cafe24 = require(PROJ + '\\cafe24.js');
cafe24.init({ pool: fakePool, notify: async (t) => alerts.push(t) });

let fetchMode = '500';
global.fetch = async () => {
  if (fetchMode === '500') return { ok: false, status: 500, text: async () => JSON.stringify({ error: 'internal' }) };
  if (fetchMode === 'neterr') { const e = new TypeError('fetch failed'); throw e; }
  if (fetchMode === '400') return { ok: false, status: 400, text: async () => JSON.stringify({ error: 'invalid_grant' }) };
  return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'AT_NEW', refresh_token: 'RT2', expires_at: kstStr(new Date(Date.now() + 7200000)), refresh_token_expires_at: kstStr(new Date(Date.now() + 14 * 86400000)) }) };
};

(async () => {
  // ① 5xx = 일시 오류(temp) — 재승인 아님
  let e1 = null; try { await cafe24.getToken(); } catch (e) { e1 = e; }
  ok(e1 && e1.code === 'temp' && /일시 오류/.test(e1.message), '① 5xx → code temp·문구 「일시 오류」', e1 && e1.message);
  ok(alerts.length === 1 && /일시 오류/.test(alerts[0]) && /재승인 불필요/.test(alerts[0]), '① 일시 오류 알림 1회(재승인 불필요 문구)', alerts[0]);

  // ② 연속 같은 실패 = 추가 알림 없음(상태 전환 시에만)
  let e2 = null; try { await cafe24.getToken(); } catch (e) { e2 = e; }
  ok(e2 && e2.code === 'temp' && alerts.length === 1, '② 연속 temp 실패 = 알림 중복 0', '알림 ' + alerts.length + '건');

  // ③ 네트워크 예외도 temp
  fetchMode = 'neterr';
  let e3 = null; try { await cafe24.getToken(); } catch (e) { e3 = e; }
  ok(e3 && e3.code === 'temp', '③ 네트워크 예외 → temp', e3 && String(e3.reason).slice(0, 40));

  // ④ 회복 → 회복 알림 1회 + 새 토큰
  fetchMode = 'ok200';
  const tok = await cafe24.getToken();
  ok(tok === 'AT_NEW', '④ 갱신 성공 — 새 access 토큰 반환', tok);
  ok(alerts.length === 2 && /회복/.test(alerts[1]), '④ 회복 알림 1회', alerts[1]);
  // 정상 상태 반복 호출 = 무알림 (유효 토큰 저장돼 있으므로 즉시 반환 경로)
  store = { enc: encrypt({ ...storedTokens, access_token: 'AT_NEW', expires_at: kstStr(new Date(Date.now() + 7200000)) }) };
  await cafe24.getToken();
  ok(alerts.length === 2, '④ 정상 반복 = 무알림', '알림 ' + alerts.length + '건');

  // ⑤ 400 invalid_grant = 진짜 재승인 — reauth 코드·문구
  store = { enc: encrypt(storedTokens) };   // 만료 access로 되돌려 갱신 강제
  fetchMode = '400';
  let e5 = null; try { await cafe24.getToken(); } catch (e) { e5 = e; }
  ok(e5 && e5.code === 'reauth' && e5.message === 'cafe24_reauth_required', '⑤ 400 invalid_grant → 재승인 필요 유지', e5 && e5.message);
  ok(alerts.length === 3 && /재승인 필요/.test(alerts[2]), '⑤ 재승인 알림(전환 시 1회)', alerts[2]);

  // ⑥ 토큰 자체 없음 = 재승인 (기존 동작 무회귀)
  store = null;
  const fakePool2 = { query: async (sql) => /SELECT value/.test(sql) ? { rows: [] } : { rows: [] } };
  cafe24.init({ pool: fakePool2, notify: async (t) => alerts.push(t) });
  let e6 = null; try { await cafe24.getToken(); } catch (e) { e6 = e; }
  ok(e6 && e6.code === 'reauth', '⑥ 토큰 없음 → reauth (무회귀)', e6 && e6.message);

  console.log('\n═══ 결과: ' + pass + '/' + (pass + fail) + (fail ? ' ❌ 실패 ' + fail : ' ✅ 전항목 통과'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });

// #711 실왕복용 로컬 서버 preload — 실DB 「읽기 전용」 + lucky 가짜 표만 쓰기 허용
//   node -r ./scripts/ro-preload-711.js server.js  (LUCKY_TABLE=lucky_events_vui JWT_SECRET=local711 PORT=3466)
//   · pg Client.prototype.query 를 감싸 SELECT/WITH/SHOW/EXPLAIN/BEGIN/COMMIT/ROLLBACK 만 통과
//   · 그 밖(INSERT·UPDATE·DELETE·CREATE·ALTER…)은 LUCKY_TABLE(+_assets) 글자가 들어 있을 때만 통과, 아니면 빈 결과 {rows:[],rowCount:0} 로 삼킴(기동 복구 UPDATE·initDB ALTER·타이머 쓰기 전부 차단 · 로그 1회씩)
//   · setInterval 차단(타이머·러너 0) · 러너·문자·알림톡은 쓰기가 막혀 아무것도 못 보냄
'use strict';
const T = process.env.LUCKY_TABLE || '';
if (!T || !/^[a-z][a-z0-9_]*$/.test(T) || T === 'lucky_events' || T === 'lucky_assets') { console.error('[ro-preload] LUCKY_TABLE 이 가짜 표 이름이어야 합니다 — ' + T); process.exit(2); }
if (process.env.RENDER) { console.error('[ro-preload] Render 에선 쓰지 않습니다'); process.exit(2); }
global.setInterval = () => ({ unref() { }, ref() { }, hasRef() { return false; }, refresh() { return this; }, [Symbol.toPrimitive]() { return 0; } });
const pg = require('pg');
const orig = pg.Client.prototype.query;
const READ_RE = /^\s*(SELECT|WITH|SHOW|EXPLAIN|BEGIN|COMMIT|ROLLBACK|SET\s+(?!ROLE)|SAVEPOINT|RELEASE)/i;
const seen = new Set();
let blocked = 0;
pg.Client.prototype.query = function (a, b, c) {
  const text = typeof a === 'string' ? a : (a && a.text) || '';
  const okRead = READ_RE.test(text) && !/\b(INTO|FOR\s+UPDATE)\b/i.test(text.replace(/\s+/g, ' ').slice(0, 400)) ? true : false;
  const okFake = text.includes(T);
  if (okRead || okFake) return orig.apply(this, arguments);
  blocked++;
  const head = text.replace(/\s+/g, ' ').slice(0, 90);
  if (!seen.has(head)) { seen.add(head); console.log('[ro-preload] 쓰기 차단 #' + blocked + ': ' + head); }
  const fake = { rows: [], rowCount: 0, command: (text.trim().split(/\s+/)[0] || '').toUpperCase(), fields: [] };
  const cb = typeof c === 'function' ? c : typeof b === 'function' ? b : (a && typeof a.callback === 'function' ? a.callback : null);
  if (cb) { process.nextTick(() => cb(null, fake)); return; }
  return Promise.resolve(fake);
};
process.on('exit', () => console.log('[ro-preload] 끝 · 차단한 쓰기 ' + blocked + '건 · 가짜 표 ' + T));
console.log('[ro-preload] 실DB 읽기 전용 · 쓰기는 ' + T + '/' + T + '_assets 만 · setInterval 0');

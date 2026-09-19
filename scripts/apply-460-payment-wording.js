// #460(대표 GO 9/20): 네이버 톡톡 「현금 결제·계좌 입금 유도」 자동 경고 대응 ① — 시나리오 #55의 계좌이체 제안 문장 교체
//   실사고: 9/19 22:44 봇이 「계좌이체는 어려운 점 양해」(거절)라고 답했는데도 네이버가 단어를 감지해 경고 노출. 조사 중 #55 본문에
//   「결제는 스토어 결제 또는 계좌이체 모두 가능해요」(판매자가 먼저 제안 = 실제 위반에 가까움 · 9/15 실발송 1회) 발견 → 그 문장만 정확 치환.
//   단체 현금 거래 자체는 종전대로 전화 상담에서 — 네이버 채널(톡톡·상품문의 = 공개 게시판)에 글로 남기지 않는 것이 핵심. 다른 줄·키워드·채널 무변경.
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const ACTOR = '클코(대표 지시 #460 결제 표현 — 계좌이체 제안 문장 제거)';
const OLD = '▶ 결제는 스토어 결제 또는 계좌이체 모두 가능해요. 어떤 방법이 편하실지 애매하시면 📞 010-6687-4031로 편하게 문의주세요!';
const NEW = '▶ 결제·주문 방법이 애매하시면 📞 010-6687-4031로 편하게 문의주세요! 상담하면서 가장 편하신 방법으로 안내해드릴게요 😊';
const RISK = /계좌|입금|이체|무통장|송금|현금으로|직접\s*결제/;
(async () => {
    const row = (await pool.query(`SELECT id, response FROM inquiry_scenarios WHERE scenario_no=55 AND deleted_at IS NULL`)).rows[0];
    if (!row) throw new Error('#55 없음');
    if (!row.response.includes(OLD)) { console.log(row.response.includes(NEW) ? '이미 교체됨' : '❌ 대상 문장을 못 찾음 — 중단'); return pool.end(); }
    if (row.response.split(OLD).length !== 2) throw new Error('대상 문장이 2번 이상');
    const next = row.response.replace(OLD, NEW);
    // 검산: 그 문장 말고는 한 글자도 안 바뀜
    if (next.length !== row.response.length - OLD.length + NEW.length || next.replace(NEW, OLD) !== row.response) throw new Error('치환 검산 실패');
    await pool.query(`UPDATE inquiry_scenarios SET response=$1, updated_at=now(), updated_by=$2 WHERE id=$3`, [next, ACTOR, row.id]);
    await pool.query(`INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_id, actor_name) VALUES ('update','inquiry_scenarios',$1,$2,'claude-code',NULL,$3)`,
        [row.id, JSON.stringify({ note: '#460 계좌이체 제안 문장 제거(네이버 톡톡 현금 유도 경고 대응)', before_line: OLD, after_line: NEW }), ACTOR]);
    console.log('✅ #55(id ' + row.id + ') 문장 교체');
    // 전체 활성 시나리오 본문에 결제 위험 단어 잔존 검사(키워드 칸은 손님 말을 잡는 용도라 제외 · 「현금영수증」은 정상 용어)
    const all = (await pool.query(`SELECT scenario_no, name, response FROM inquiry_scenarios WHERE enabled=true AND deleted_at IS NULL`)).rows;
    const left = all.filter(r => RISK.test(String(r.response).replace(/현금영수증/g, ''))).map(r => '#' + r.scenario_no + ' ' + r.name);
    console.log('활성 시나리오 본문의 결제 위험 단어 잔존:', left.length ? left.join(', ') : '0건');
    await pool.end();
})().catch(async e => { console.error('ERR', e.message); try { await pool.end(); } catch (_) { } process.exit(1); });

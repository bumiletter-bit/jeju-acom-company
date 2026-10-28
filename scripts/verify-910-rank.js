// #910 검증 — 키워드 순위 자동 수집의 서버 몫(ALTER · 붙여 넣기 source · PUT 키워드 거름 · 1분 틱 ⓐ 알림 ⓑ 미수집) + launcher rankMaybe 문법
//   🔴 실DB 쓰기 0 — 연결 하나에서 BEGIN 뒤 같은 이름의 TEMP 표(agent_office_config·keyword_rankings·users)를 만들어 운영 표를 가림(pg_temp 가 먼저 찾힘)
//      시작 때 「가린 표가 TEMP 인지 · 비었는지」 단언(틀리면 throw) · 끝은 ROLLBACK · server.js 안 띄움 · 텔레그램·알림은 가짜 함수(실발송 0)
//   server.js 의 실코드를 떼어 실행: 「#910 키워드 순위 알림 시작~끝」 묶음 · PUT 라우트 · 붙여 넣기 UPSERT SQL · ALTER 한 줄
//   실행: node scripts/verify-910-rank.js
'use strict';
const path = require('path'), fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
require(path.join(ROOT, 'node_modules', 'dotenv')).config({ path: path.join(ROOT, '.env') });
const { Pool } = require(path.join(ROOT, 'node_modules', 'pg'));
const SRV = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (c, name, info) => { if (c) { pass++; console.log('  ✓ ' + name); } else { fail++; console.log('  ✗ ' + name + (info !== undefined ? ' — ' + JSON.stringify(info) : '')); } };
const cut = (a, b) => { const i = SRV.indexOf(a); if (i < 0) throw new Error('못 찾음: ' + a); const j = SRV.indexOf(b, i); if (j < 0) throw new Error('끝 못 찾음: ' + b); return SRV.slice(i, j + b.length); };

const BLOCK = cut('// ── #910 키워드 순위 알림 시작', '// ── #910 키워드 순위 알림 끝');
const PUT_SRC = cut("app.put('/api/rankings/keywords'", '\n});');
const ALTER_SQL = (SRV.match(/ALTER TABLE keyword_rankings ADD COLUMN IF NOT EXISTS source TEXT/) || [])[0];
const BULK_SQL = cut('INSERT INTO keyword_rankings (date, keyword, shopping_rank, ad_rank, powerlink_rank, created_by, source)', 'RETURNING (xmax = 0) AS inserted').replace(/--[^\n]*/g, '');

(async () => {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 1 });
    const db = await pool.connect();
    try {
        await db.query('BEGIN');
        await db.query(`CREATE TEMP TABLE agent_office_config (key TEXT PRIMARY KEY, value JSONB, updated_at TIMESTAMP DEFAULT NOW()) ON COMMIT DROP`);
        await db.query(`CREATE TEMP TABLE keyword_rankings (id SERIAL PRIMARY KEY, date DATE NOT NULL, keyword VARCHAR(80) NOT NULL, shopping_rank INTEGER, ad_rank INTEGER, powerlink_rank INTEGER,
            created_by INTEGER, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW(), UNIQUE(date, keyword)) ON COMMIT DROP`);
        await db.query(`CREATE TEMP TABLE users (id INTEGER PRIMARY KEY, deleted_at TIMESTAMP) ON COMMIT DROP`);
        // 가드 — 이름이 TEMP 표로 풀리는지 · 비었는지(운영 표면 agent_office_config 는 수십 줄)
        for (const t of ['agent_office_config', 'keyword_rankings', 'users']) {
            const r = await db.query(`SELECT n.nspname LIKE 'pg_temp%' AS tmp, (SELECT COUNT(*) FROM ${t})::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.oid = to_regclass($1)`, [t]);
            if (!r.rows[0] || !r.rows[0].tmp || r.rows[0].n !== 0) throw new Error('가드 실패 — ' + t + ' 가 TEMP 빈 표가 아님 ' + JSON.stringify(r.rows[0]));
        }
        console.log('가드 ✓ 세 표 모두 TEMP·빈 표(운영 표 가림)');

        // ── ① ALTER 멱등 ──
        console.log('① ALTER source 칸');
        ok(!!ALTER_SQL, 'server.js 에 ALTER 한 줄 있음');
        await db.query(ALTER_SQL); await db.query(ALTER_SQL);
        const col = (await db.query(`SELECT data_type, is_nullable FROM information_schema.columns WHERE table_schema LIKE 'pg_temp%' AND table_name = 'keyword_rankings' AND column_name IN ('source','created_by') ORDER BY column_name`)).rows;
        ok(col.length === 2 && col[1].data_type === 'text', 'ALTER 두 번 = 오류 없음 · source TEXT', col);
        ok(col.every(c => c.is_nullable === 'YES'), 'created_by·source NULL 허용', col);

        // ── ② 붙여 넣기 UPSERT = manual · 자동 줄 덮음 ──
        console.log('② 붙여 넣기(bulk) source');
        await db.query(`INSERT INTO keyword_rankings (date, keyword, shopping_rank, source) VALUES ('2099-01-02', '귤', 30, 'auto')`);
        await db.query(BULK_SQL, ['2099-01-02', '귤', 28, 3, 5, null]);
        await db.query(BULK_SQL, ['2099-01-02', '감귤', 7, null, null, null]);
        const bk = (await db.query(`SELECT keyword, shopping_rank, source, created_by FROM keyword_rankings WHERE date = '2099-01-02' ORDER BY keyword`)).rows;
        ok(bk.length === 2 && bk.every(r => r.source === 'manual'), '손 입력 = manual(새 줄·자동 줄 덮음 둘 다)', bk);
        ok(bk.find(r => r.keyword === '귤').shopping_rank === 28, '덮은 값 = 손 입력 값', bk);
        await db.query(`DELETE FROM keyword_rankings`);

        // ── 실코드 묶음 싣기(setInterval 막음 · 텔레그램·알림 가짜) ──
        const sent = [], notis = [];
        const fake = {
            pool: db, notifyTelegram: async t => { sent.push(t); return 'sent'; }, createNotification: async (...a) => { notis.push(a); },
            kstTodayStr: () => '2099-01-02', setInterval: () => ({ unref() { } }), console,
        };
        const mod = new Function(...Object.keys(fake), BLOCK + '\nreturn { krCleanKeywords, krFormatLines, krChunks, keywordRankNotifyTick, keywordRankMissTick, KR_MAX_KEYWORDS };')(...Object.values(fake));

        // ── ③ PUT 거름 ──
        console.log('③ PUT /api/rankings/keywords 거름');
        const cl = mod.krCleanKeywords([' 귤 ', '귤', '', 'a', '제주\n귤', '가'.repeat(31), '가'.repeat(30), null, '레몬']);
        ok(JSON.stringify(cl) === JSON.stringify(['귤', 'a', '제주 귤', '가'.repeat(30), '레몬']), '빈칸·31자·중복 거름 · 1자(귤) 통과 · 앞뒤 빈칸·줄바꿈 정리', cl);
        let handler = null;
        const audits = [];
        new Function('app', 'authMiddleware', 'krCleanKeywords', 'KR_MAX_KEYWORDS', 'naverCfgGet', 'pool', 'writeAudit', PUT_SRC)(
            { put: (p, mw, fn) => { handler = fn; } }, null, mod.krCleanKeywords, mod.KR_MAX_KEYWORDS,
            async k => { const r = await db.query('SELECT value FROM agent_office_config WHERE key=$1', [k]); return r.rows.length ? r.rows[0].value : null; },
            db, async a => { audits.push(a); });
        const call = async body => { let code = 200, out; await handler({ body, user: { id: 7, name: '시험' } }, { status(c) { code = c; return this; }, json(o) { out = o; } }); return { code, out }; };
        ok((await call({})).code === 400, 'keywords 없음 = 400');
        ok((await call({ keywords: ['', '  ', null] })).code === 400, '거르고 0개 = 400');
        ok((await call({ keywords: Array.from({ length: 21 }, (_, i) => '키워드' + i) })).code === 400, '21개 = 400');
        let r = await call({ keywords: ['귤', '감귤', '귤'] });
        ok(r.code === 200 && JSON.stringify(r.out.keywords) === '["귤","감귤"]', '처음 저장(설정 없음) = 행 생김', r);
        await db.query(`UPDATE agent_office_config SET value = value || '{"enabled":true,"time":"09:30","store":{"names":["제주아꼼이네"]}}'::jsonb WHERE key='keyword_rank'`);
        r = await call({ keywords: ['귤', '제주귤', '감귤'] });
        const cv = (await db.query(`SELECT value FROM agent_office_config WHERE key='keyword_rank'`)).rows[0].value;
        ok(r.code === 200 && cv.enabled === true && cv.time === '09:30' && cv.store && JSON.stringify(cv.keywords) === '["귤","제주귤","감귤"]', '다시 저장 = keywords 만 바뀜(다른 칸 그대로)', cv);
        ok(audits.length === 2 && audits[1].action === 'keyword_rank_keywords' && JSON.stringify(audits[1].changes.before) === '["귤","감귤"]', 'audit 2건 · before/after', audits[1]);

        // ── ④ 틱 ⓐ 알림 ──
        console.log('④ 1분 틱 ⓐ 그날 알림');
        await db.query(`INSERT INTO users (id, deleted_at) VALUES (1, NULL), (2, NULL), (3, NOW())`);
        let n = await mod.keywordRankNotifyTick({ today: '2099-01-02', hm: '09:40' });
        ok(n === 0 && sent.length === 0, 'keyword_rank_last 없음 = 아무것도 안 함');
        await db.query(`INSERT INTO agent_office_config (key, value) VALUES ('keyword_rank_last', '{"date":"2099-01-01","at":"2099-01-01T00:31:00Z"}')`);
        n = await mod.keywordRankNotifyTick({ today: '2099-01-02' });
        ok(n === 0 && sent.length === 0, 'last.date 가 어제 = 안 보냄');
        // 어제 줄 + 오늘 auto 줄 + 읽기 실패 1
        await db.query(`INSERT INTO keyword_rankings (date, keyword, shopping_rank, ad_rank, powerlink_rank, source) VALUES
            ('2099-01-01','귤',31,3,6,'auto'), ('2099-01-01','감귤',5,NULL,2,'auto'),
            ('2099-01-02','귤',28,3,5,'auto'), ('2099-01-02','감귤',9,NULL,2,'auto'), ('2099-01-02','제주귤',NULL,NULL,NULL,'auto'), ('2099-01-02','레몬',12,NULL,NULL,'auto')`);
        // 수집기가 || 합치기로 저장 = 전날 notified:true·notified_date 칸이 남은 꼴 그대로 시험
        await db.query(`UPDATE agent_office_config SET value = '{"date":"2099-01-01","notified":true,"notified_date":"2099-01-01"}'::jsonb || '{"date":"2099-01-02","at":"2099-01-02T00:31:00Z","errors":[{"keyword":"제주귤","error":"429"}]}'::jsonb WHERE key='keyword_rank_last'`);
        n = await mod.keywordRankNotifyTick({ today: '2099-01-02' });
        const EXPECT = ['아꼼이네 주요 키워드 순위기준 (99.01.02. 09:31 기준)', '쇼핑검색-모바일',
            '귤(28위↑3) 광고3위 파워링크5위↑1', '제주귤 (읽기 실패)', '감귤(9위↓4) 광고- 파워링크2위', '레몬(12위) 광고- 파워링크-'].join('\n');
        ok(n === 1 && sent.length === 1 && sent[0] === EXPECT, '텔레그램 1통 · 글 꼴 스냅샷(↑↓ · NULL「-」 · 읽기 실패 · 목록 밖 키워드 뒤에)', sent);
        ok(notis.length === 2 && notis.every(a => a[1] === 'rank' && a[4] === 'rankings') && notis[0][2] === '키워드 순위 (1/2)', '알림 종 = 지운 계정 빼고 2명 · type rank · 링크 rankings', notis);
        n = await mod.keywordRankNotifyTick({ today: '2099-01-02' });
        ok(n === 0 && sent.length === 1 && notis.length === 2, '두 번째 틱 = 안 보냄(notified 멱등)');
        const lv = (await db.query(`SELECT value FROM agent_office_config WHERE key='keyword_rank_last'`)).rows[0].value;
        ok(lv.notified_date === '2099-01-02' && lv.errors && lv.errors.length === 1, 'last 에 notified_date = 그날 · 다른 칸 그대로(전날 notified:true 남아도 보냄)', lv);
        const ch = mod.krChunks(Array.from({ length: 30 }, (_, i) => '키워드' + i + '(12위↑3) 광고3위↓1 파워링크5위'), 380);
        ok(ch.length > 1 && ch.every(c => c.length <= 380) && ch.join('\n').split('\n').length === 30, '길면 380자씩 나눔(줄 안 끊김)', ch.map(c => c.length));

        // ── ⑤ 틱 ⓑ 미수집 ──
        console.log('⑤ 1분 틱 ⓑ 미수집');
        sent.length = 0;
        await db.query(`DELETE FROM keyword_rankings WHERE date = '2099-01-02'`);
        n = await mod.keywordRankMissTick({ today: '2099-01-02', hm: '09:59' });
        ok(n === 0 && !sent.length, '10:00 전 = 안 보냄');
        await db.query(`UPDATE agent_office_config SET value = value || '{"enabled":false}' WHERE key='keyword_rank'`);
        n = await mod.keywordRankMissTick({ today: '2099-01-02', hm: '10:01' });
        ok(n === 0 && !sent.length, 'enabled false = 안 보냄');
        await db.query(`UPDATE agent_office_config SET value = value || '{"enabled":true}' WHERE key='keyword_rank'`);
        await db.query(`INSERT INTO keyword_rankings (date, keyword, shopping_rank, source) VALUES ('2099-01-02','귤',20,'manual')`);
        n = await mod.keywordRankMissTick({ today: '2099-01-02', hm: '10:01' });
        ok(n === 1 && sent.length === 1 && sent[0] === '⚠️ 오늘(1/2) 키워드 순위 미수집 — 직원 손 입력(순위관리 탭 붙여 넣기)', '10:00 지남 · auto 0(손 입력 줄만) = 1통', sent);
        n = await mod.keywordRankMissTick({ today: '2099-01-02', hm: '10:30' });
        ok(n === 0 && sent.length === 1, '같은 날 두 번째 = 안 보냄(miss_notified)');
        const mv = (await db.query(`SELECT value FROM agent_office_config WHERE key='keyword_rank'`)).rows[0].value;
        ok(mv.miss_notified === '2099-01-02' && JSON.stringify(mv.keywords) === '["귤","제주귤","감귤"]', 'miss_notified 날짜 · keywords 그대로', mv);
        n = await mod.keywordRankMissTick({ today: '2099-01-03', hm: '11:00' });
        ok(n === 1 && sent.length === 2, '다음 날 = 다시 1통');
        await db.query(`INSERT INTO keyword_rankings (date, keyword, shopping_rank, source) VALUES ('2099-01-04','귤',20,'auto')`);
        n = await mod.keywordRankMissTick({ today: '2099-01-04', hm: '11:00' });
        ok(n === 0 && sent.length === 2, '오늘 auto 줄 있음 = 안 보냄');
        await db.query(`DELETE FROM agent_office_config WHERE key='keyword_rank'`);
        await db.query(`UPDATE agent_office_config SET value = '{"date":"2099-01-05"}' WHERE key='keyword_rank_last'`);
        n = (await mod.keywordRankMissTick({ today: '2099-01-05', hm: '11:00' })) + (await mod.keywordRankNotifyTick({ today: '2099-01-05' }));
        ok(n === 0 && sent.length === 2, '설정 keyword_rank 없음 = 두 틱 다 아무것도 안 함');

        // ── ⑥ launcher 문법·연결 ──
        console.log('⑥ launcher rankMaybe');
        const L = fs.readFileSync(path.join(ROOT, 'scripts', 'desk', 'launcher.js'), 'utf8');
        ok(/function rankMaybe\(\)/.test(L) && /\n\s+rankMaybe\(\);/.test(L), 'rankMaybe 정의 · slowTick 에서 부름');
        ok(/cfg\.enabled !== true\) return/.test(L.slice(L.indexOf('function rankMaybe'))), 'enabled true 일 때만');
        ok(/'--apply'/.test(L) && /keyword-rank-\$\{today\}\.log/.test(L), '--apply · 날짜별 로그');
    } finally {
        try { await db.query('ROLLBACK'); } catch (e) { console.error('ROLLBACK 실패', e.message); }
        db.release(); await pool.end();
    }
    console.log(`\n결과 ${pass}/${pass + fail}${fail ? ' — 실패 ' + fail : ''}`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error('중단:', e.message); process.exit(2); });

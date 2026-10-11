// #647-b 톡톡 사진 주소가 얼마나 오래 살아 있는지 보는 도구(읽기만 — DB SELECT + 그 주소 GET · 쓰기 0 · 발송 0)
//   message_logs.image_url 에 주소가 적힌 줄을 최근 것부터 본다.
//   ① 먼저 인자 없이:  node scripts/talk-image-probe.js            → 주소를 받지 않고 **어느 도메인인지만** 찍는다(받은 지 몇 시간인지 포함)
//   ② 도메인을 눈으로 확인한 뒤:  node scripts/talk-image-probe.js --hosts pstatic.net   → 그 도메인으로 끝나는 주소만 실제로 받아 상태·크기·형식을 찍는다
//      사진이 온 직후 · 1시간 뒤 · 하루 뒤에 한 번씩 돌리면 「받은 지 몇 시간까지 살아 있나」가 나온다.
//   🔴 image_url 칸은 톡톡봇이 받은 값을 그대로 적는 칸이라 바깥에서 심을 수 있다 → 이 도구는 대표 PC(사무실 망)에서 도므로
//      허용 도메인(--hosts)을 주지 않으면 아무 주소도 받지 않고, 줘도 https · 포트 지정 없음 · 숫자 주소·안쪽 이름 거절 · 이름이 사설 주소로 풀리면 거절(서버 러너 photoTestUrlOk 와 같은 규칙).
//   그 밖: [--limit 20] [--id 1234] [--days 30]. 출력에는 손님 식별값·주소의 물음표 뒤(서명값 등)를 적지 않는다(도메인과 경로 끝만).
require('dotenv').config();
const { Client } = require('pg'); const dns = require('dns').promises;
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const LIMIT = Math.min(100, Math.max(1, parseInt(arg('limit', '20'), 10) || 20)), ONLY = parseInt(arg('id', ''), 10) || null, DAYS = Math.max(1, parseInt(arg('days', '30'), 10) || 30);
const HOSTS = String(arg('hosts', '') || '').split(',').map(s => s.trim().toLowerCase().replace(/^\.+|\.+$/g, '')).filter(s => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(s));

// 서버 러너(server.js photoTestUrlOk · photoTestPrivateIp)와 같은 규칙
function urlOk(u, hosts) {
    let x; try { x = new URL(String(u)); } catch (_) { return false; }
    if (x.protocol !== 'https:' || x.username || x.password || x.port) return false;
    const h = x.hostname.toLowerCase().replace(/\.+$/, '');
    if (!h.includes('.') || /^[0-9.]+$/.test(h) || h.includes(':') || h.includes('[') || /(^|\.)(localhost|local|internal|lan|home|corp)$/.test(h)) return false;
    return hosts.length > 0 && hosts.some(d => h === d || h.endsWith('.' + d));
}
function privateIp(ip) {
    const s = String(ip || '').toLowerCase();
    const m = s.match(/^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (m) { const a = Number(m[1]), b = Number(m[2]); return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127) || a >= 224; }
    if (!s.includes(':')) return true;
    return s === '::1' || s === '::' || /^f[cd]/.test(s) || /^fe[89ab]/.test(s);
}
async function probe(url) {
    if (!urlOk(url, HOSTS)) return { status: 0, ok: false, skipped: '허용 도메인 밖(받지 않음)' };
    try { const found = await dns.lookup(new URL(url).hostname.replace(/\.+$/, ''), { all: true }); if (!found.length || found.some(a => privateIp(a.address))) return { status: 0, ok: false, skipped: '안쪽 주소로 풀림(받지 않음)' }; }
    catch (_) { return { status: 0, ok: false, error: '주소를 찾지 못함' }; }
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 15000); const t0 = Date.now();
    try {
        const r = await fetch(url, { redirect: 'manual', signal: ctl.signal, headers: { 'User-Agent': 'akkome-photo-test' } });   // 다른 주소로 넘기는 응답은 따라가지 않고 어디로 넘기는지만 적는다
        const type = String(r.headers.get('content-type') || '').split(';')[0];
        let bytes = Number(r.headers.get('content-length')) || 0;
        if (r.ok && !bytes && r.body) { const rd = r.body.getReader(); for (;;) { const { done, value } = await rd.read(); if (done) break; bytes += value.length; if (bytes > 10 * 1024 * 1024) { await rd.cancel().catch(() => { }); break; } } }
        else if (r.body && r.body.cancel) r.body.cancel().catch(() => { });
        const loc = r.headers.get('location'); let to = null; try { to = loc ? new URL(loc, url).hostname : null; } catch (_) { to = '(주소 꼴 아님)'; }
        return { status: r.status, ok: r.ok && /^image\//.test(type), type, bytes, ms: Date.now() - t0, redirect_to: to };
    } catch (e) { return { status: 0, ok: false, type: '', bytes: 0, ms: Date.now() - t0, error: e.name === 'AbortError' ? '시간 초과' : '받기 실패' }; }
    finally { clearTimeout(timer); }
}

(async () => {
    const db = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }); await db.connect();
    try {
        const tot = (await db.query(`SELECT count(*) FILTER (WHERE message = '[이미지 전송]')::int AS images, count(*) FILTER (WHERE image_url IS NOT NULL AND image_url <> '')::int AS with_url FROM message_logs`)).rows[0];
        const rows = (await db.query(
            `SELECT id, image_url, round(extract(epoch FROM (now() AT TIME ZONE 'UTC') - received_at) / 3600.0, 1)::float AS age_h, to_char(received_at + interval '9 hours', 'MM-DD HH24:MI') AS kst
             FROM message_logs WHERE image_url IS NOT NULL AND image_url <> '' AND received_at > (now() AT TIME ZONE 'UTC') - make_interval(days => $1::int) AND ($2::int IS NULL OR id = $2::int)
             ORDER BY id DESC LIMIT $3`, [DAYS, ONLY, LIMIT])).rows;   // received_at 은 시간대 없는 UTC — 나이는 SQL 안에서 계산
        const items = [];
        for (const r of rows) {
            let host = '', tail = '', port = ''; try { const u = new URL(r.image_url); host = u.hostname; port = u.port; tail = u.pathname.split('/').pop().slice(-24); } catch (_) { host = '(주소 꼴 아님)'; }
            const base = { id: r.id, received_kst: r.kst, age_hours: r.age_h, host, port: port || undefined, file: tail, https: /^https:/.test(r.image_url) };
            items.push(HOSTS.length ? Object.assign(base, await probe(r.image_url)) : base);
        }
        const tried = items.filter(x => 'status' in x && !x.skipped), alive = tried.filter(x => x.ok), dead = tried.filter(x => !x.ok);
        console.log(JSON.stringify({
            at: new Date().toISOString(), mode: HOSTS.length ? '받아 봄(--hosts ' + HOSTS.join(',') + ')' : '도메인만 보기(받지 않음)',
            total_image_rows: tot.images, rows_with_url: tot.with_url, checked: items.length,
            hosts_seen: [...new Set(items.map(x => x.host))],
            alive: HOSTS.length ? alive.length : undefined, dead: HOSTS.length ? dead.length : undefined, skipped: HOSTS.length ? items.filter(x => x.skipped).length : undefined,
            oldest_alive_hours: alive.length ? Math.max(...alive.map(x => x.age_hours)) : null,
            youngest_dead_hours: dead.length ? Math.min(...dead.map(x => x.age_hours)) : null,
            note: !tot.with_url ? '아직 주소가 적힌 사진 줄이 없어요 — 톡톡으로 사진이 한 장 들어온 뒤 다시 돌려 주세요.'
                : !HOSTS.length ? 'hosts_seen 의 도메인이 네이버 것인지 눈으로 확인한 뒤 --hosts <도메인> 을 붙여 다시 돌리면 실제로 받아 봅니다(서버 러너 설정 photo_test.hosts 에도 같은 값).'
                : (alive.length && dead.length ? '살아 있는 것 중 가장 오래된 나이 ~ 죽은 것 중 가장 어린 나이 사이가 유효 시간이에요.' : ''),
            items,
        }, null, 1));
    } finally { await db.end(); }
})().catch(e => { console.error('ERR', e.message); process.exit(1); });

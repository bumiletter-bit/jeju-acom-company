// #469 클코 창구 공용 — DB 연결·heartbeat·단계 기록 (AI 호출 없음)
// #701(대표 「근본 고쳐줘」 10/14): 쉬는 중 DB 연결이 끊기면 pg Pool 이 'error' 를 내는데 받는 곳이 없어 프로세스가 조용히 죽었다(창구 대기 프로그램 10/13 05:47 · 10/14 14:14 · 로그 0줄).
//   → ①pool.on('error') 로 받아 launcher.log 한 줄(죽지 않음) ②끊김 류 오류(ECONNRESET·57P01 등)는 쿼리를 지수 대기(1·2·4·8·16초 · 최대 5회)로 다시 한다
//     ③연결 keepAlive · 쉬는 연결은 20초 뒤 닫는다(서버·프록시가 먼저 끊어 둔 연결을 집어 쓰는 일을 줄임) · 연결 시도 15초 상한.
//   재시도는 「연결 얻기」까지만(보내기 전) — 보낸 뒤 끊김은 다시 보내지 않는다(집기 UPDATE 가 두 번 가면 「처리중」 고아 · INSERT 두 줄 · 아래 설명).
//   시험용 env: DESK_DB_RETRY_MAX · DESK_DB_RETRY_BASE_MS · DESK_LOG_FILE(로그 파일 경로).
const path = require('path');
const fs = require('fs');
const os = require('os');
const ROOT = path.resolve(__dirname, '..', '..');
require(path.join(ROOT, 'node_modules', 'dotenv')).config({ path: path.join(ROOT, '.env') });
const { Pool } = require(path.join(ROOT, 'node_modules', 'pg'));

const LOG = process.env.DESK_LOG_FILE || path.join(os.homedir(), '.akkome', 'launcher.log');
function dblog(msg) {
    const line = new Date().toISOString() + ' [DB] ' + msg;
    try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, line + '\n'); } catch (e) { /* 기록 실패는 무시 */ }
    if (process.stdout.isTTY) console.log(line);
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 2, keepAlive: true, idleTimeoutMillis: 20000, connectionTimeoutMillis: 15000 });
// 🔴 이 한 줄이 핵심 — 쉬는 연결이 끊기면 pg 가 'error' 를 내고, 듣는 곳이 없으면 Node 는 프로세스를 그대로 끝낸다.
pool.on('error', e => dblog('연결 끊김(쉬는 연결) → 다음 쿼리에서 재연결: ' + (e && e.code ? e.code + ' ' : '') + String(e && e.message || e).slice(0, 120)));

const TRANSIENT_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'ENOTFOUND', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNABORTED',
    '57P01', '57P02', '57P03', '08000', '08001', '08003', '08006', '08P01', '53300']);   // 57P0x = 서버가 연결을 끊음 · 08xxx = 연결 예외 · 53300 = 연결 수 초과
const TRANSIENT_MSG = /Connection terminated|terminated unexpectedly|timeout exceeded when trying to connect|socket hang up|server closed the connection|connection error|Client has encountered a connection error|read ECONNRESET/i;
function isTransient(e) {
    if (!e) return false;
    if (TRANSIENT_CODES.has(String(e.code || ''))) return true;
    return TRANSIENT_MSG.test(String(e.message || ''));
}
const RETRY_MAX = Math.max(0, parseInt(process.env.DESK_DB_RETRY_MAX, 10) || 5);
const RETRY_BASE_MS = Math.max(1, parseInt(process.env.DESK_DB_RETRY_BASE_MS, 10) || 1000);
async function withRetry(fn, what) {
    for (let i = 0; ; i++) {
        try { return await fn(); }
        catch (e) {
            if (!isTransient(e) || i >= RETRY_MAX) throw e;
            const wait = RETRY_BASE_MS * Math.pow(2, i);
            dblog(`연결 끊김 → 재연결 ${i + 1}/${RETRY_MAX} (${wait / 1000}초 뒤 · ${e.code || ''} ${String(e.message || '').slice(0, 80)}${what ? ' · ' + what : ''})`);
            await new Promise(r => setTimeout(r, wait));
        }
    }
}
// pool.query 를 감싼다(모듈마다 고치지 않게 · 콜백 꼴은 종전 그대로 넘김).
//   🔴 #701 보완(워커2 점검): 재시도는 **연결을 얻는 단계(보내기 전)** 에만 건다. 쿼리를 보낸 뒤 끊기면(응답을 못 받음) DB 가 이미 끝냈는지 모르므로 다시 보내지 않는다 —
//   get.js 의 집기 UPDATE(status='처리중' RETURNING)를 다시 보내면 0행이 돌아와 「처리중」 고아가 조용히 생기고, agent_runs·audit INSERT 가 두 줄이 될 수 있다.
//   보낸 뒤 끊김은 로그 한 줄 + 그 오류를 그대로 던진다(launcher 는 주기 오류로 적고 다음 주기에 다시 봄 · 고아 「처리중」은 기동 복구(launcher.js recoverOrphans)가 되돌림).
const rawQuery = pool.query.bind(pool);
pool.query = async function (text, params, cb) {
    if (typeof params === 'function' || typeof cb === 'function') return rawQuery(text, params, cb);
    const what = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().slice(0, 40) : (text && text.text ? String(text.text).replace(/\s+/g, ' ').trim().slice(0, 40) : '');
    const client = await withRetry(() => pool.connect(), '연결 · ' + what);   // 여기까지는 아무것도 안 보냈다 → 재시도 안전
    try { return await client.query(text, params); }
    catch (e) {
        if (isTransient(e)) dblog(`쿼리 보낸 뒤 끊김(재시도 안 함 · DB 가 끝냈는지 모름): ${e.code || ''} ${String(e.message || '').slice(0, 80)} · ${what}`);
        throw e;
    }
    finally { try { client.release(); } catch (_) { /* 이미 반납됨 */ } }
};

async function heartbeat(state, orderId) {
    const v = { at: new Date().toISOString(), state, order_id: orderId || null };
    await pool.query(
        `INSERT INTO agent_office_config (key, value) VALUES ('desk_heartbeat', $1::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`, [JSON.stringify(v)]);
}
function step(kind, text) { return { t: new Date().toISOString(), kind, actor: '클코', text: String(text).slice(0, 300) }; }
async function appendStep(runId, kind, text) {
    if (!runId) return;
    await pool.query(`UPDATE agent_runs SET steps = steps || $2::jsonb WHERE id = $1`, [runId, JSON.stringify([step(kind, text)])]);
}
async function audit(action, targetId, after) {
    try {
        await pool.query(
            `INSERT INTO audit_logs (action, target_type, target_id, changes, source, actor_name) VALUES ($1, 'pending_order', $2, $3, 'desk', '클코(창구)')`,
            [action, targetId, JSON.stringify({ after })]);
    } catch (e) { console.error('audit 기록 실패(무시):', e.message); }
}
module.exports = { pool, ROOT, heartbeat, step, appendStep, audit, isTransient, withRetry, dblog };

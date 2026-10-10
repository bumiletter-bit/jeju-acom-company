/* #610 회사폰 문자 응대 — 문자로 나가는 글 다듬기 (순수 함수 · DB·네트워크 없음)
 *
 *   smsSafeBase(s) : kakao-notify.js 의 smsSafe(#549)와 **글자 하나까지 같은 결과**(이모지 빼기 · 전화기 그림 → ☎).
 *                    지금은 복사본이다 — 총괄이 나중에 kakao-notify.js 것 하나로 합친다(verify-610-rules 가 두 함수 결과를 대조).
 *   smsSafe(s, opt): 위 + 손님 답 문자용 정리
 *                    ① 자동으로 붙는 꼬리 줄(「*추가 문의사항 … 톡톡 또는 010-6687-4031 …」) 제거 — 이미 문자로 말하고 있는 손님이다
 *                    ② 「톡톡으로」「톡톡 문의」 등 → 「문자」 · 「네이버 페이로 」 제거(문자 손님은 쿠팡·자사몰일 수도 있다) · ✅⭕ → 「가능」 · ❌ → 「불가」
 *                       회사 번호(010-6687-4031)로 연락하라는 **문장**만 제거(같은 줄의 다른 안내는 남김)
 *                    ③ 사진 요청 줄(📸 로 시작) 제거는 opt.dropPhotoAsk 일 때만
 *                    ④ 빈 줄 2개 이상 → 1개 · 앞뒤 공백 정리
 *                    ⑤ 900바이트(한글 2 · 그 밖 1 — 통신사 LMS 셈법) 넘으면 문장 단위로 자름(opt.maxBytes 로 바꿈 · 0 이면 안 자름)
 *   smsBytes(s)    : 위 셈법의 바이트 수
 */
'use strict';

// ── kakao-notify.js smsSafe 와 같은 표·같은 순서 (바꾸면 verify-610-rules 「기존 smsSafe 와 같음」이 깨진다) ──
const SMS_KEEP = new Set(['☎', '★', '☆', '♥', '♡', '♠', '♣', '♤', '♧', '☜', '☞', '♨', '♪', '♬', '▶', '◀', '※', '↔', '↕', '™', '©', '®']);
function smsSafeBase(s) {
    return String(s == null ? '' : s)
        .replace(/📞/gu, '☎')
        .replace(/\p{Extended_Pictographic}/gu, m => SMS_KEEP.has(m) ? m : '')
        .replace(/[️‍⃣]/g, '')
        .replace(/[\u{1F3FB}-\u{1F3FF}\u{1F1E6}-\u{1F1FF}]/gu, '')
        .split('\n').map(l => l.replace(/[ \t]{2,}/g, ' ').replace(/^[ \t]+|[ \t]+$/g, '')).join('\n');
}

// 통신사 문자 바이트: 한글·한자·전각 기호 = 2 · 영문·숫자·반각 기호 = 1 (EUC-KR 기준)
function smsBytes(s) {
    let n = 0;
    for (const ch of String(s == null ? '' : s)) n += ch.codePointAt(0) > 0x7f ? 2 : 1;
    return n;
}

// 자동 꼬리(server.js QNA_TAIL · 자사몰 변형 · 시나리오 본문 끝줄) — 줄 단위로 지운다
const TAIL_LINE_RE = /^\*?\s*추가\s*문의\s*사항.*(톡톡|카카오톡|고객센터|010-?6687-?4031)/;
// 「이 번호로 연락 달라」는 문장 — 손님이 이미 이 번호와 문자 중이다. 줄 전체가 아니라 그 번호가 든 **문장만** 뺀다(같은 줄의 다른 안내는 남긴다)
const CALL_US_RE = /010-?6687-?4031/;
const CALL_WORD_RE = /연락|문의|전화|상담/;
function dropCallUs(line) {
    if (!CALL_US_RE.test(line)) return line;
    const parts = line.match(/(?:[^.!?]|\.(?=\d))+[.!?]*\s*/g) || [line];
    return parts.filter(p => !(CALL_US_RE.test(p) && CALL_WORD_RE.test(p))).join('').replace(/[ \t]+$/, '');
}
// 표시 그림 → 글자(지우기만 하면 「배송 ✅ / 교환 ❌」가 「배송 / 교환」이 되어 뜻이 사라진다)
function marksToWords(s) {
    return String(s == null ? '' : s)
        .replace(/(가능(?:해요|합니다|하세요)?)\s*[✅⭕✔☑]\uFE0F?/gu, '$1').replace(/(불가(?:능(?:해요|합니다)?)?|안\s*돼요|안\s*됩니다|어려워요|어렵습니다)\s*[❌✖❎]\uFE0F?/gu, '$1')
        .replace(/[✅⭕✔☑]\uFE0F?/gu, ' 가능 ').replace(/[❌✖❎]\uFE0F?/gu, ' 불가 ');
}

function cutByBytes(text, maxBytes) {
    if (!maxBytes || smsBytes(text) <= maxBytes) return text;
    // 문장 끝(. ! ? 또는 줄바꿈) 단위로 쪼개 넘치기 전까지만 싣는다
    const parts = text.match(/(?:[^.!?\n]|\.(?=\d))+[.!?]*\n*|\n+/g) || [text];   // 「2.5kg」의 점에서는 끊지 않는다
    let out = '';
    for (const p of parts) {
        if (smsBytes((out + p).replace(/\s+$/, '')) > maxBytes) break;
        out += p;
    }
    out = out.replace(/\s+$/, '');
    if (out) return out;
    // 첫 문장부터 넘치면 글자 단위로
    let acc = '';
    for (const ch of text) { if (smsBytes(acc + ch) > maxBytes) break; acc += ch; }
    return acc.replace(/\s+$/, '');
}

function smsSafe(s, opt) {
    const o = opt || {};
    const maxBytes = o.maxBytes === 0 ? 0 : (Number(o.maxBytes) > 0 ? Number(o.maxBytes) : 900);
    let lines = smsSafeBase(marksToWords(s)).replace(/\r\n?/g, '\n').split('\n');
    lines = lines.filter(l => !TAIL_LINE_RE.test(l.trim())).map(l => { const had = l.trim() !== ''; const d = dropCallUs(l); return had && d.trim() === '' ? null : d; }).filter(l => l !== null);
    if (o.dropPhotoAsk) lines = lines.filter(l => !/^(📸|\[?사진\]?\s*(을|를)?\s*(찍어|보내))/.test(String(l).trim()) && !/사진\s*(찍어|촬영해)?\s*보내\s*주시면/.test(l));
    let t = lines.join('\n')
        .replace(/톡톡\s*또는\s*/g, '')
        .replace(/톡톡으로/g, '문자로')
        .replace(/톡톡\s*(주시면|남겨|보내)/g, '문자 $1')
        .replace(/(네이버\s*)?톡톡\s*(문의|상담|채팅|메시지|메세지)(로|으로)?/g, '문자')
        .replace(/네이버\s*톡톡/g, '문자').replace(/톡톡/g, '문자')
        .replace(/네이버\s*페이로\s*/g, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
    return cutByBytes(t, maxBytes);
}

module.exports = { smsSafe, smsSafeBase, smsBytes, SMS_KEEP };

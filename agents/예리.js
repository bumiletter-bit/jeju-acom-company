// 예리 (마케팅팀 · 그로스 분석가) — 지시 #44 역할 부여 + 지시 #49 최소 가동 (0원 순수 코드)
// 원칙: 입력 = 대표가 수집해 전달한 데이터만 (자동 수집 금지). 데이터 없으면 "데이터 없음 — 분석 불가" 정직.
// 판단에는 "(표본 N건)" 표본 크기 병기. 개선 제안·교훈은 학습 승인제 경유 (자동 반영 금지).
// 본격 분석(성과 데이터 입력 화면·비교 분석·개선 제안)은 v5.3 — 여기는 정직 동작의 최소 구현.
module.exports = {
    live: true,
    steps: ['입력 데이터 확인 중...', '표본 집계 중...'],
    stepDelayMs: 1200,
    async result({ params = {} }) {
        const data = Array.isArray(params.performance_data) ? params.performance_data.filter(d => d && typeof d === 'object') : [];
        if (!data.length) {
            return {
                summary: '데이터 없음 — 분석 불가 (정직 안내)',
                lines: [
                    '분석 입력 = 대표님이 코워크에서 수집해 전달한 데이터만 사용합니다 (자동 수집 금지)',
                    '전달된 성과 데이터가 없어 분석할 수 없습니다 — 감으로 채우지 않습니다',
                    '성과 데이터 입력 기능은 v5.3에서 연결 예정입니다',
                ],
                report: { type: 'yeri_analysis', no_data: true, note: '데이터 없음 — 분석 불가 (근거 없는 판단 금지 — 지시 #44·#49)' },
            };
        }
        // 소량 표본 기초 집계 (0원 코드 — 첫 숫자 필드 자동 탐지)
        const n = data.length;
        const numKey = Object.keys(data[0]).find(k => typeof data[0][k] === 'number');
        const sorted = numKey ? [...data].sort((a, b) => (b[numKey] || 0) - (a[numKey] || 0)) : data;
        const label = d => d.name || d.title || d.label || JSON.stringify(d).slice(0, 30);
        return {
            summary: `기초 집계 완료 — 상위: ${label(sorted[0])} 경향 (표본 ${n}건)`,
            lines: [
                `잘된 것 TOP: ${sorted.slice(0, 3).map(d => `${label(d)}${numKey ? `(${d[numKey]})` : ''}`).join(', ')} (표본 ${n}건)`,
                numKey ? `안 된 것: ${label(sorted[sorted.length - 1])}(${sorted[sorted.length - 1][numKey]}) (표본 ${n}건)` : '수치 필드 없음 — 정렬 불가 (정직 표기)',
                `※ 표본 ${n}건 기준 경향입니다 — 원인 가설·개선 제안(본격 분석)은 v5.3에서, 교훈 반영은 대표 승인제`,
            ],
            report: {
                type: 'yeri_analysis', sample_n: n, top: sorted.slice(0, 3).map(label), metric_key: numKey || null,
                note: `표본 ${n}건 — 소량 표본은 경향 참고만 (지시 #49 표본 병기 원칙)`,
            },
        };
    },
};

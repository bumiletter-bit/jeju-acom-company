require('dotenv').config();
const express = require('express');
const path = require('path');
const { Pool, types } = require('pg');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const { GoogleGenAI } = require('@google/genai');

// DATE 타입을 문자열로 반환 (타임존 이슈 방지)
types.setTypeParser(1082, val => val);

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'jeju-acom-secret-2026';

// DB 연결
const dbConfig = {
    connectionString: process.env.DATABASE_URL
};
if (process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')) {
    dbConfig.ssl = { rejectUnauthorized: false };
}
const pool = new Pool(dbConfig);

app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// === JWT 인증 미들웨어 ===
function authMiddleware(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: '인증이 필요합니다' });
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (err) {
        return res.status(401).json({ error: '토큰이 만료되었거나 유효하지 않습니다' });
    }
}

function adminOnly(req, res, next) {
    if (req.user.role !== 'admin') return res.status(403).json({ error: '관리자 권한이 필요합니다' });
    next();
}

// === DB 테이블 자동 생성 ===
async function initDB() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS settlements (
            id SERIAL PRIMARY KEY,
            date DATE NOT NULL,
            partner VARCHAR(50) NOT NULL,
            amount NUMERIC DEFAULT 0,
            items JSONB DEFAULT '[]'::jsonb,
            from_pricing BOOLEAN DEFAULT false,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS cj_carryover (
            id SERIAL PRIMARY KEY,
            month VARCHAR(7) NOT NULL,
            amount INTEGER DEFAULT 0,
            note VARCHAR(200),
            start_date DATE,
            end_date DATE,
            updated_by INTEGER REFERENCES users(id),
            updated_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(month)
        )
    `);
    // 기존 cj_carryover 테이블에 start_date, end_date 컬럼 추가 (이미 있으면 무시)
    await pool.query(`ALTER TABLE cj_carryover ADD COLUMN IF NOT EXISTS start_date DATE`);
    await pool.query(`ALTER TABLE cj_carryover ADD COLUMN IF NOT EXISTS end_date DATE`);
    // 결재 도장/사인 이미지
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS signature_image TEXT`);
    // 정산 결제완료 상태 컬럼 추가
    await pool.query(`ALTER TABLE settlements ADD COLUMN IF NOT EXISTS is_paid BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE settlements ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP`);
    // CJ택배 일별 결제완료 상태
    await pool.query(`
        CREATE TABLE IF NOT EXISTS cj_daily_payments (
            id SERIAL PRIMARY KEY,
            date DATE NOT NULL UNIQUE,
            amount INTEGER DEFAULT 0,
            is_paid BOOLEAN DEFAULT false,
            paid_at TIMESTAMP
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS expense_reports (
            id SERIAL PRIMARY KEY,
            title VARCHAR(200) NOT NULL,
            applicant_id INTEGER REFERENCES users(id),
            total_amount INTEGER DEFAULT 0,
            purpose TEXT,
            items JSONB DEFAULT '[]'::jsonb,
            status VARCHAR(20) DEFAULT 'pending',
            manager_id INTEGER REFERENCES users(id),
            manager_status VARCHAR(20) DEFAULT 'pending',
            manager_approved_at TIMESTAMP,
            ceo_id INTEGER REFERENCES users(id),
            ceo_status VARCHAR(20) DEFAULT 'pending',
            ceo_approved_at TIMESTAMP,
            rejected_by INTEGER REFERENCES users(id),
            reject_reason TEXT,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS pricing (
            id SERIAL PRIMARY KEY,
            start_date DATE NOT NULL,
            end_date DATE NOT NULL,
            partner VARCHAR(50) NOT NULL,
            items JSONB DEFAULT '[]'::jsonb,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id SERIAL PRIMARY KEY,
            username VARCHAR(50) UNIQUE NOT NULL,
            password_hash VARCHAR(255) NOT NULL,
            name VARCHAR(50) NOT NULL,
            position VARCHAR(50) DEFAULT '',
            color VARCHAR(20) DEFAULT '#3b82f6',
            role VARCHAR(20) DEFAULT 'user',
            annual_leave NUMERIC DEFAULT 15,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS schedules (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            date DATE NOT NULL,
            title VARCHAR(200) NOT NULL,
            type VARCHAR(20) DEFAULT 'normal',
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    await pool.query(`ALTER TABLE schedules ADD COLUMN IF NOT EXISTS is_completed BOOLEAN DEFAULT false`);

    // notifications 테이블
    await pool.query(`
        CREATE TABLE IF NOT EXISTS notifications (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            type VARCHAR(50) NOT NULL,
            title VARCHAR(200) NOT NULL,
            message TEXT,
            link VARCHAR(100),
            is_read BOOLEAN DEFAULT false,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);

    // documents 테이블
    await pool.query(`
        CREATE TABLE IF NOT EXISTS documents (
            id SERIAL PRIMARY KEY,
            type VARCHAR(20) NOT NULL,
            sub_type VARCHAR(50) NOT NULL,
            applicant_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            approver_id INTEGER REFERENCES users(id),
            start_date DATE NOT NULL,
            end_date DATE,
            reason TEXT DEFAULT '',
            status VARCHAR(20) DEFAULT 'pending',
            deducted_leave NUMERIC DEFAULT 0,
            created_at TIMESTAMP DEFAULT NOW(),
            processed_at TIMESTAMP
        )
    `);

    // schedules에 document_id 컬럼 추가 (기안서류 연동)
    await pool.query(`
        DO $$ BEGIN
            ALTER TABLE schedules ADD COLUMN document_id INTEGER REFERENCES documents(id) ON DELETE CASCADE;
        EXCEPTION WHEN duplicate_column THEN NULL;
        END $$
    `);

    // documents에 start_time, end_time 컬럼 추가 (시간차용)
    await pool.query(`
        DO $$ BEGIN
            ALTER TABLE documents ADD COLUMN start_time VARCHAR(10);
        EXCEPTION WHEN duplicate_column THEN NULL;
        END $$
    `);
    await pool.query(`
        DO $$ BEGIN
            ALTER TABLE documents ADD COLUMN end_time VARCHAR(10);
        EXCEPTION WHEN duplicate_column THEN NULL;
        END $$
    `);

    // documents에 수정요청 관련 컬럼 추가
    const modCols = [
        ['modification_type', 'VARCHAR(20)'],
        ['modification_reason', 'TEXT'],
        ['new_start_date', 'DATE'],
        ['new_end_date', 'DATE'],
        ['new_start_time', 'VARCHAR(10)'],
        ['new_end_time', 'VARCHAR(10)'],
    ];
    for (const [col, type] of modCols) {
        await pool.query(`DO $$ BEGIN ALTER TABLE documents ADD COLUMN ${col} ${type}; EXCEPTION WHEN duplicate_column THEN NULL; END $$`);
    }

    // 업무일지 테이블
    await pool.query(`
        CREATE TABLE IF NOT EXISTS work_logs (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            date DATE NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(user_id, date)
        )
    `);

    // 점심메뉴 테이블
    await pool.query(`
        CREATE TABLE IF NOT EXISTS lunch_menus (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            category VARCHAR(20) NOT NULL,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS lunch_sessions (
            id SERIAL PRIMARY KEY,
            date DATE UNIQUE NOT NULL,
            menus JSONB DEFAULT '[]'::jsonb,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS lunch_votes (
            id SERIAL PRIMARY KEY,
            session_id INTEGER REFERENCES lunch_sessions(id) ON DELETE CASCADE,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            menu_name VARCHAR(100) NOT NULL,
            created_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(session_id, user_id)
        )
    `);

    // 연차 조정 이력 테이블
    await pool.query(`
        CREATE TABLE IF NOT EXISTS leave_adjustments (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id),
            adjustment DECIMAL(5,2) NOT NULL,
            reason VARCHAR(200) NOT NULL,
            adjusted_by INTEGER REFERENCES users(id),
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);

    // 잘못 생성된 ceo 계정 정리
    await pool.query("DELETE FROM users WHERE username = 'ceo' AND (SELECT COUNT(*) FROM users WHERE username = 'admin') > 0");

    // 품목별 금액 저장 시 잘못 생성된 정산 데이터 삭제
    await pool.query("DELETE FROM settlements WHERE from_pricing = true");

    // 초기 관리자 계정 생성
    const adminCheck = await pool.query("SELECT id FROM users WHERE username = 'admin'");
    if (adminCheck.rows.length === 0) {
        const hash = await bcrypt.hash('admin123', 10);
        await pool.query(
            "INSERT INTO users (username, password_hash, name, position, color, role, annual_leave) VALUES ($1, $2, $3, $4, $5, $6, $7)",
            ['admin', hash, '전승범', '대표', '#ef4444', 'admin', 15]
        );
        console.log('초기 관리자 계정 생성: admin / admin123');
    }

    // 기본 점심메뉴 시드
    const menuCheck = await pool.query('SELECT COUNT(*) FROM lunch_menus');
    if (parseInt(menuCheck.rows[0].count) === 0) {
        const defaultMenus = [
            ['김치찌개','한식'],['된장찌개','한식'],['순두부찌개','한식'],['불고기','한식'],['제육볶음','한식'],
            ['비빔밥','한식'],['갈치조림','한식'],['고등어구이','한식'],['돼지국밥','한식'],['해물파전','한식'],
            ['감자탕','한식'],['삼겹살','한식'],['칼국수','한식'],
            ['고기국수','제주'],['몸국','제주'],['흑돼지구이','제주'],['전복죽','제주'],['보말칼국수','제주'],
            ['짜장면','중식'],['짬뽕','중식'],['탕수육','중식'],['볶음밥','중식'],['마파두부','중식'],
            ['초밥','일식'],['돈카츠','일식'],['라멘','일식'],['우동','일식'],
            ['파스타','양식'],['피자','양식'],['햄버거','양식'],['스테이크','양식'],['리조또','양식'],
            ['떡볶이','분식'],['김밥','분식'],['라볶이','분식'],
            ['치킨','패스트푸드']
        ];
        for (const [name, category] of defaultMenus) {
            await pool.query('INSERT INTO lunch_menus (name, category) VALUES ($1, $2)', [name, category]);
        }
        console.log('기본 점심메뉴 36개 등록 완료');
    }

    // 선결제 테이블
    await pool.query(`
        CREATE TABLE IF NOT EXISTS prepayments (
            id SERIAL PRIMARY KEY,
            partner VARCHAR(50) NOT NULL,
            amount NUMERIC NOT NULL,
            date DATE NOT NULL,
            note TEXT DEFAULT '',
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);

    // 품목명 수동 매칭 기억
    await pool.query(`
        CREATE TABLE IF NOT EXISTS product_mappings (
            id SERIAL PRIMARY KEY,
            sales_name TEXT NOT NULL,
            pricing_name TEXT NOT NULL,
            partner VARCHAR(50) NOT NULL,
            created_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(sales_name, partner)
        )
    `);

    // 주간 정산 완료 기록
    await pool.query(`
        CREATE TABLE IF NOT EXISTS settlement_completions (
            id SERIAL PRIMARY KEY,
            partner VARCHAR(50) NOT NULL,
            week_start DATE NOT NULL,
            week_end DATE NOT NULL,
            total_amount NUMERIC DEFAULT 0,
            completed_by INTEGER REFERENCES users(id),
            completed_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(partner, week_start)
        )
    `);

    // 박스재고 테이블
    await pool.query(`
        CREATE TABLE IF NOT EXISTS box_inventory (
            id SERIAL PRIMARY KEY,
            product_name VARCHAR(50) NOT NULL UNIQUE,
            company_stock INTEGER DEFAULT 0,
            daesong_stock INTEGER DEFAULT 0,
            updated_by INTEGER REFERENCES users(id),
            updated_at TIMESTAMP DEFAULT NOW()
        )
    `);
    // 초기 데이터 삽입 (이미 있으면 무시)
    const boxProducts = ['귤 박스 3kg', '귤 박스 5kg', '귤 박스 10kg', '만감 박스 3kg', '만감 박스 5kg', '만감 박스 10kg'];
    for (const name of boxProducts) {
        await pool.query('INSERT INTO box_inventory (product_name) VALUES ($1) ON CONFLICT (product_name) DO NOTHING', [name]);
    }

    // 마이 플래너 테이블
    await pool.query(`CREATE TABLE IF NOT EXISTS planner_todos (
        id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id),
        date DATE NOT NULL, content VARCHAR(200) NOT NULL,
        is_completed BOOLEAN DEFAULT false, sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS planner_memos (
        id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id),
        date DATE NOT NULL, content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(), UNIQUE(user_id, date)
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS planner_ddays (
        id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id),
        title VARCHAR(100) NOT NULL, target_date DATE NOT NULL,
        color VARCHAR(7) DEFAULT '#F5A623', created_at TIMESTAMP DEFAULT NOW()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS planner_habits (
        id SERIAL PRIMARY KEY, user_id INTEGER REFERENCES users(id),
        title VARCHAR(50) NOT NULL, created_at TIMESTAMP DEFAULT NOW()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS planner_habit_logs (
        id SERIAL PRIMARY KEY, habit_id INTEGER REFERENCES planner_habits(id) ON DELETE CASCADE,
        date DATE NOT NULL, is_done BOOLEAN DEFAULT true, UNIQUE(habit_id, date)
    )`);

    // AI 대화 테이블
    await pool.query(`
        CREATE TABLE IF NOT EXISTS ai_conversations (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            title VARCHAR(200) DEFAULT '새 대화',
            category VARCHAR(50) DEFAULT 'marketing',
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    // category 컬럼 추가 (기존 테이블 호환)
    await pool.query(`ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'marketing'`).catch(() => {});

    await pool.query(`
        CREATE TABLE IF NOT EXISTS ai_messages (
            id SERIAL PRIMARY KEY,
            conversation_id INTEGER REFERENCES ai_conversations(id) ON DELETE CASCADE,
            role VARCHAR(20) NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);

    // CS 카테고리
    await pool.query(`
        CREATE TABLE IF NOT EXISTS cs_categories (
            id SERIAL PRIMARY KEY,
            name VARCHAR(50) NOT NULL UNIQUE,
            color VARCHAR(20) DEFAULT '#9E9E9E',
            sort_order INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    // 초기 카테고리 데이터
    const csCatCount = await pool.query('SELECT COUNT(*) FROM cs_categories');
    if (parseInt(csCatCount.rows[0].count) === 0) {
        const catSeeds = [
            ['간편인사', '#4CAF50', 1],
            ['클레임', '#F44336', 2],
            ['주문안내/가격정보', '#2196F3', 3],
            ['도착정보', '#FF9800', 4],
        ];
        for (const [name, color, order] of catSeeds) {
            await pool.query('INSERT INTO cs_categories (name, color, sort_order) VALUES ($1, $2, $3)', [name, color, order]);
        }
    }

    // CS 템플릿
    await pool.query(`
        CREATE TABLE IF NOT EXISTS cs_templates (
            id SERIAL PRIMARY KEY,
            category VARCHAR(50) NOT NULL,
            title VARCHAR(100) NOT NULL,
            content TEXT NOT NULL,
            sort_order INTEGER DEFAULT 0,
            created_by INTEGER REFERENCES users(id),
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);
    // 초기 데이터 (테이블이 비어있을 때만)
    const csCount = await pool.query('SELECT COUNT(*) FROM cs_templates');
    if (parseInt(csCount.rows[0].count) === 0) {
        const seeds = [
            ['간편인사', '첫 주문 감사', '안녕하세요! 제주아꼼이네입니다 🍊\n첫 주문 감사드립니다! 정성껏 준비하여 보내드리겠습니다.\n감사합니다!', 1],
            ['간편인사', '재주문 감사', '안녕하세요! 제주아꼼이네입니다 🍊\n다시 찾아주셔서 정말 감사합니다!\n이번에도 맛있는 귤 준비해드리겠습니다!', 2],
            ['클레임', '파손 접수', '안녕하세요 고객님, 제주아꼼이네입니다.\n파손된 상품 사진을 보내주시면 빠르게 재발송 또는 환불 처리 도와드리겠습니다.\n불편을 드려 죄송합니다.', 1],
            ['클레임', '교환 안내', '안녕하세요 고객님, 제주아꼼이네입니다.\n교환을 원하시면 상품 상태 사진과 함께 말씀해주세요.\n빠르게 처리 도와드리겠습니다.', 2],
            ['클레임', '반품 안내', '안녕하세요 고객님, 제주아꼼이네입니다.\n반품 접수 도와드리겠습니다.\n수거 후 환불 처리까지 2~3일 소요됩니다.', 3],
            ['주문안내/가격정보', '주문 확인', '안녕하세요! 제주아꼼이네입니다.\n주문 확인되었습니다. 빠르게 준비하여 발송해드리겠습니다!\n감사합니다 🍊', 1],
            ['주문안내/가격정보', '품절 안내', '안녕하세요 고객님, 제주아꼼이네입니다.\n문의하신 상품은 현재 품절 상태입니다.\n입고되는 대로 안내드리겠습니다.', 2],
            ['도착정보', '배송완료 미수령', '안녕하세요 고객님, 제주아꼼이네입니다.\n배송 완료로 확인되나 수령이 안 되셨다면, 경비실이나 문 앞을 확인해주세요.\n확인이 안 되시면 택배사에 문의 도와드리겠습니다.', 1],
            ['도착정보', '부분배송 안내', '안녕하세요 고객님, 제주아꼼이네입니다.\n나머지 상품은 별도 발송되어 1~2일 내 도착 예정입니다.\n불편을 드려 죄송합니다.', 2],
        ];
        for (const [cat, title, content, order] of seeds) {
            await pool.query('INSERT INTO cs_templates (category, title, content, sort_order) VALUES ($1, $2, $3, $4)', [cat, title, content, order]);
        }
    }

    // ai_messages에 message_type 컬럼 추가 (이미지/텍스트 구분)
    await pool.query(`
        DO $$ BEGIN
            ALTER TABLE ai_messages ADD COLUMN message_type VARCHAR(10) DEFAULT 'text';
        EXCEPTION
            WHEN duplicate_column THEN NULL;
        END $$;
    `);

    // ai_messages에 sender_user_id 컬럼 추가 (누가 보냈는지 추적)
    await pool.query(`
        DO $$ BEGIN
            ALTER TABLE ai_messages ADD COLUMN sender_user_id INTEGER REFERENCES users(id);
        EXCEPTION
            WHEN duplicate_column THEN NULL;
        END $$;
    `);

    // 정산현황 (날짜별 정산 현황 데이터)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS settlement_status (
            id SERIAL PRIMARY KEY,
            date DATE NOT NULL UNIQUE,
            current_cash NUMERIC DEFAULT 0,
            settlement_scheduled NUMERIC DEFAULT 0,
            unsettled NUMERIC DEFAULT 0,
            coupang_unpaid NUMERIC DEFAULT 0,
            selfmall_unpaid NUMERIC DEFAULT 0,
            ad_naver NUMERIC DEFAULT 0,
            ad_gfa NUMERIC DEFAULT 0,
            card_fee NUMERIC DEFAULT 0,
            corp_card NUMERIC DEFAULT 0,
            hyodong NUMERIC DEFAULT 0,
            daesong NUMERIC DEFAULT 0,
            aewol NUMERIC DEFAULT 0,
            delivery NUMERIC DEFAULT 0,
            memo TEXT DEFAULT '',
            updated_by INTEGER REFERENCES users(id),
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        )
    `);

    // 애월취나물 컬럼 추가 (기존 DB 마이그레이션)
    await pool.query(`ALTER TABLE settlement_status ADD COLUMN IF NOT EXISTS aewol NUMERIC DEFAULT 0`);

    console.log('DB 테이블 초기화 완료');
}

// === Auth API ===

app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        if (result.rows.length === 0) return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다' });

        const user = result.rows[0];
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다' });

        const token = jwt.sign(
            { id: user.id, username: user.username, name: user.name, position: user.position, color: user.color, role: user.role },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            token,
            user: { id: user.id, username: user.username, name: user.name, position: user.position, color: user.color, role: user.role, annualLeave: Number(user.annual_leave) }
        });
    } catch (err) {
        console.error('POST /api/auth/login error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/auth/me', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username, name, position, color, role, annual_leave, signature_image FROM users WHERE id = $1', [req.user.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: '사용자를 찾을 수 없습니다' });
        const u = result.rows[0];
        res.json({ id: u.id, username: u.username, name: u.name, position: u.position, color: u.color, role: u.role, annualLeave: Number(u.annual_leave), hasSignature: !!u.signature_image });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === 비밀번호 변경 (본인) ===
app.put('/api/auth/change-password', authMiddleware, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        if (!currentPassword || !newPassword) return res.status(400).json({ error: '현재 비밀번호와 새 비밀번호를 입력해주세요' });
        if (newPassword.length < 4) return res.status(400).json({ error: '새 비밀번호는 4자 이상이어야 합니다' });

        const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: '사용자를 찾을 수 없습니다' });

        const valid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
        if (!valid) return res.status(401).json({ error: '현재 비밀번호가 올바르지 않습니다' });

        const hash = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, req.user.id]);

        res.json({ success: true, message: '비밀번호가 변경되었습니다' });
    } catch (err) {
        console.error('PUT /api/auth/change-password error:', err);
        res.status(500).json({ error: err.message });
    }
});

// === Signature API (결재 도장/사인) ===

app.put('/api/users/signature', authMiddleware, async (req, res) => {
    try {
        const { signatureImage } = req.body;
        if (!signatureImage) return res.status(400).json({ error: '이미지 데이터가 없습니다' });
        // base64 크기 체크 (약 2MB = ~2.7MB base64)
        if (signatureImage.length > 3 * 1024 * 1024) return res.status(400).json({ error: '이미지 크기가 2MB를 초과합니다' });
        await pool.query('UPDATE users SET signature_image = $1 WHERE id = $2', [signatureImage, req.user.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/users/signature', authMiddleware, async (req, res) => {
    try {
        await pool.query('UPDATE users SET signature_image = NULL WHERE id = $1', [req.user.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/users/:id/signature', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query('SELECT signature_image FROM users WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: '사용자를 찾을 수 없습니다' });
        res.json({ signatureImage: result.rows[0].signature_image || null });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// === Users API (관리자 전용) ===

app.get('/api/users', authMiddleware, adminOnly, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username, name, position, color, role, annual_leave, created_at FROM users ORDER BY id');
        res.json(result.rows.map(u => ({
            id: u.id, username: u.username, name: u.name, position: u.position,
            color: u.color, role: u.role, annualLeave: Number(u.annual_leave)
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/users', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { username, password, name, position, color, role, annualLeave } = req.body;
        if (!username || !password || !name) return res.status(400).json({ error: '아이디, 비밀번호, 이름은 필수입니다' });

        const exists = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
        if (exists.rows.length > 0) return res.status(400).json({ error: '이미 존재하는 아이디입니다' });

        const hash = await bcrypt.hash(password, 10);
        const result = await pool.query(
            'INSERT INTO users (username, password_hash, name, position, color, role, annual_leave) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
            [username, hash, name, position || '', color || '#3b82f6', role || 'user', annualLeave ?? 15]
        );
        const u = result.rows[0];
        res.json({ id: u.id, username: u.username, name: u.name, position: u.position, color: u.color, role: u.role, annualLeave: Number(u.annual_leave) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 결재자 목록 - 직원→전연희, 전연희→전승범, 전승범→전승범(자체결재)
app.get('/api/users/approvers', authMiddleware, async (req, res) => {
    try {
        let result;
        if (req.user.position === '대표') {
            // 대표(전승범): 자체 결재 → 본인만 반환
            result = await pool.query(
                "SELECT id, name, position FROM users WHERE id = $1", [req.user.id]
            );
        } else if (req.user.role === 'admin') {
            // 관리자(전연희 등, 대표 아닌): 대표만 반환
            result = await pool.query(
                "SELECT id, name, position FROM users WHERE position = '대표' AND role = 'admin'"
            );
        } else {
            // 일반 직원: 대표가 아닌 관리자만 반환 (전연희)
            result = await pool.query(
                "SELECT id, name, position FROM users WHERE role = 'admin' AND position != '대표' ORDER BY name"
            );
        }
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 직원 이름 목록 (사다리 게임용)
app.get('/api/users/names', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query("SELECT id, name, position, color FROM users ORDER BY id");
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 직원별 연차 현황 (관리자 전용)
app.get('/api/users/leave-summary', authMiddleware, adminOnly, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT u.id, u.name, u.position, u.annual_leave,
                   COALESCE(SUM(CASE WHEN d.status = 'approved' AND d.type = 'vacation' AND d.deducted_leave > 0
                       THEN d.deducted_leave ELSE 0 END), 0) as used_leave,
                   COALESCE(SUM(CASE WHEN d.status = 'pending' AND d.type = 'vacation' AND d.deducted_leave > 0
                       THEN d.deducted_leave ELSE 0 END), 0) as pending_leave
            FROM users u
            LEFT JOIN documents d ON u.id = d.applicant_id
            GROUP BY u.id, u.name, u.position, u.annual_leave
            ORDER BY u.name
        `);
        res.json(result.rows.map(r => ({
            id: r.id,
            name: r.name,
            position: r.position,
            annualLeave: Number(r.annual_leave),
            usedLeave: Number(r.used_leave),
            pendingLeave: Number(r.pending_leave)
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/users/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { name, position, color, role, annualLeave, password } = req.body;
        const fields = [];
        const values = [];
        let idx = 1;

        if (name !== undefined) { fields.push(`name = $${idx++}`); values.push(name); }
        if (position !== undefined) { fields.push(`position = $${idx++}`); values.push(position); }
        if (color !== undefined) { fields.push(`color = $${idx++}`); values.push(color); }
        if (role !== undefined) { fields.push(`role = $${idx++}`); values.push(role); }
        if (annualLeave !== undefined) { fields.push(`annual_leave = $${idx++}`); values.push(annualLeave); }
        if (password) { fields.push(`password_hash = $${idx++}`); values.push(await bcrypt.hash(password, 10)); }

        if (fields.length === 0) return res.status(400).json({ error: '수정할 항목이 없습니다' });

        values.push(req.params.id);
        await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id = $${idx}`, values);

        const result = await pool.query('SELECT id, username, name, position, color, role, annual_leave FROM users WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: '사용자를 찾을 수 없습니다' });
        const u = result.rows[0];
        res.json({ id: u.id, username: u.username, name: u.name, position: u.position, color: u.color, role: u.role, annualLeave: Number(u.annual_leave) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/users/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        const check = await pool.query('SELECT username FROM users WHERE id = $1', [req.params.id]);
        if (check.rows.length > 0 && check.rows[0].username === 'admin') {
            return res.status(400).json({ error: '기본 관리자 계정은 삭제할 수 없습니다' });
        }
        await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === Notifications API ===

async function createNotification(userId, type, title, message, link) {
    try {
        await pool.query(
            'INSERT INTO notifications (user_id, type, title, message, link) VALUES ($1, $2, $3, $4, $5)',
            [userId, type, title, message || '', link || 'documents']
        );
        // 30일 지난 알림 정리
        await pool.query("DELETE FROM notifications WHERE created_at < NOW() - INTERVAL '30 days'");
    } catch (err) { console.error('createNotification error:', err); }
}

app.get('/api/notifications', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30',
            [req.user.id]
        );
        res.json(result.rows.map(r => ({
            id: r.id, type: r.type, title: r.title, message: r.message,
            link: r.link, isRead: r.is_read, createdAt: r.created_at
        })));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/notifications/unread-count', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT COUNT(*) as cnt FROM notifications WHERE user_id = $1 AND is_read = false',
            [req.user.id]
        );
        res.json({ count: parseInt(result.rows[0].cnt) });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/notifications/:id/read', authMiddleware, async (req, res) => {
    try {
        await pool.query('UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/notifications/read-all', authMiddleware, async (req, res) => {
    try {
        await pool.query('UPDATE notifications SET is_read = true WHERE user_id = $1', [req.user.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/notifications/:id', authMiddleware, async (req, res) => {
    try {
        await pool.query('DELETE FROM notifications WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 지시사항/공지 전달 (관리자 전용)
app.post('/api/notifications/announcement', authMiddleware, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: '권한이 없습니다.' });
    try {
        const { message, target, user_ids } = req.body;
        if (!message || !message.trim()) return res.status(400).json({ error: '내용을 입력해주세요.' });

        let targetIds = [];
        if (target === 'all') {
            const result = await pool.query('SELECT id FROM users WHERE id != $1', [req.user.id]);
            targetIds = result.rows.map(r => r.id);
        } else if (user_ids && user_ids.length > 0) {
            targetIds = user_ids;
        } else {
            return res.status(400).json({ error: '대상을 선택해주세요.' });
        }

        const title = '📢 지시사항: ' + message.trim().substring(0, 30) + (message.trim().length > 30 ? '...' : '');
        for (const uid of targetIds) {
            await createNotification(uid, 'announcement', title, message.trim(), null);
        }

        res.json({ success: true, count: targetIds.length });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// === Schedules API ===

app.get('/api/schedules', authMiddleware, async (req, res) => {
    try {
        const { month } = req.query;
        let result;
        if (month) {
            result = await pool.query(
                "SELECT s.*, u.name as user_name, u.color as user_color FROM schedules s JOIN users u ON s.user_id = u.id WHERE TO_CHAR(s.date, 'YYYY-MM') = $1 ORDER BY s.date, s.id",
                [month]
            );
        } else {
            result = await pool.query(
                "SELECT s.*, u.name as user_name, u.color as user_color FROM schedules s JOIN users u ON s.user_id = u.id ORDER BY s.date, s.id"
            );
        }
        res.json(result.rows.map(r => ({
            id: r.id, userId: r.user_id, date: r.date, title: r.title, type: r.type,
            userName: r.user_name, userColor: r.user_color, documentId: r.document_id || null,
            isCompleted: r.is_completed || false
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/schedules', authMiddleware, async (req, res) => {
    try {
        const { date, startDate, endDate, title, type } = req.body;
        if (!title) return res.status(400).json({ error: '일정 내용은 필수입니다' });

        // 날짜 범위 지원 (startDate~endDate) 또는 단일 날짜(date) 호환
        const start = startDate || date;
        const end = endDate || date;
        if (!start) return res.status(400).json({ error: '날짜는 필수입니다' });

        const dates = [];
        const cur = new Date(start);
        const last = new Date(end);
        while (cur <= last) {
            dates.push(cur.toISOString().slice(0, 10));
            cur.setDate(cur.getDate() + 1);
        }
        if (dates.length === 0) dates.push(start);

        const results = [];
        for (const d of dates) {
            const result = await pool.query(
                'INSERT INTO schedules (user_id, date, title, type) VALUES ($1, $2, $3, $4) RETURNING *',
                [req.user.id, d, title, type || 'normal']
            );
            results.push(result.rows[0]);
        }

        const mapped = results.map(r => ({ id: r.id, userId: r.user_id, date: r.date, title: r.title, type: r.type, userName: req.user.name, userColor: req.user.color }));
        res.json(mapped.length === 1 ? mapped[0] : mapped);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/schedules/:id', authMiddleware, async (req, res) => {
    try {
        const schedule = await pool.query('SELECT * FROM schedules WHERE id = $1', [req.params.id]);
        if (schedule.rows.length === 0) return res.status(404).json({ error: '일정을 찾을 수 없습니다' });

        const s = schedule.rows[0];
        if (s.document_id) return res.status(400).json({ error: '기안서류를 통해 생성된 일정은 서류에서 관리해주세요' });
        if (s.user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: '본인의 일정만 삭제할 수 있습니다' });
        }

        // 휴가였으면 연차 복구
        if (s.type === 'vacation') {
            await pool.query('UPDATE users SET annual_leave = annual_leave + 1 WHERE id = $1', [s.user_id]);
        }

        await pool.query('DELETE FROM schedules WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 일정 완료 토글
app.put('/api/schedules/:id/toggle-complete', authMiddleware, async (req, res) => {
    try {
        const schedule = await pool.query('SELECT * FROM schedules WHERE id = $1', [req.params.id]);
        if (schedule.rows.length === 0) return res.status(404).json({ error: '일정을 찾을 수 없습니다' });
        const s = schedule.rows[0];
        if (s.type !== 'normal') return res.status(400).json({ error: '일반 일정만 완료 처리할 수 있습니다' });

        const newVal = !s.is_completed;
        await pool.query('UPDATE schedules SET is_completed = $1 WHERE id = $2', [newVal, req.params.id]);
        res.json({ success: true, isCompleted: newVal });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 시간차 실근무시간 계산 (점심시간 12:00~13:00 제외)
function calcWorkHours(startTimeStr, endTimeStr) {
    const toMin = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
    const s = toMin(startTimeStr);
    const e = toMin(endTimeStr);
    const total = (e - s) / 60;
    // 점심시간(720~780분)과 겹치는 부분 제외
    const lunchStart = 720, lunchEnd = 780;
    let lunchOverlap = 0;
    if (s < lunchEnd && e > lunchStart) {
        lunchOverlap = (Math.min(e, lunchEnd) - Math.max(s, lunchStart)) / 60;
    }
    return Math.max(total - lunchOverlap, 0);
}

// === Documents API (기안서류) ===

app.get('/api/documents', authMiddleware, async (req, res) => {
    try {
        const { type, status, mine } = req.query;
        let query = `
            SELECT d.*, u1.name as applicant_name, u1.position as applicant_position, u2.name as approver_name
            FROM documents d
            JOIN users u1 ON d.applicant_id = u1.id
            LEFT JOIN users u2 ON d.approver_id = u2.id
        `;
        const conditions = [];
        const values = [];
        let idx = 1;

        if (type) { conditions.push(`d.type = $${idx++}`); values.push(type); }
        if (status) {
            if (status === 'pending') {
                // pending 조회 시 modification_pending도 포함 + 본인이 결재자인 것만
                conditions.push(`d.status IN ('pending', 'modification_pending')`);
                conditions.push(`d.approver_id = $${idx++}`);
                values.push(req.user.id);
            } else {
                conditions.push(`d.status = $${idx++}`); values.push(status);
            }
        }
        if (mine === 'true' || req.user.role !== 'admin') {
            conditions.push(`d.applicant_id = $${idx++}`);
            values.push(req.user.id);
        }

        if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
        query += ' ORDER BY d.created_at DESC';

        const result = await pool.query(query, values);
        res.json(result.rows.map(r => ({
            id: r.id, type: r.type, subType: r.sub_type,
            applicantId: r.applicant_id, applicantName: r.applicant_name, applicantPosition: r.applicant_position,
            approverId: r.approver_id, approverName: r.approver_name,
            startDate: r.start_date, endDate: r.end_date,
            startTime: r.start_time, endTime: r.end_time,
            reason: r.reason, status: r.status, deductedLeave: Number(r.deducted_leave),
            createdAt: r.created_at, processedAt: r.processed_at,
            modificationType: r.modification_type, modificationReason: r.modification_reason,
            newStartDate: r.new_start_date, newEndDate: r.new_end_date,
            newStartTime: r.new_start_time, newEndTime: r.new_end_time
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 승인 이력 조회 (관리자 전용)
app.get('/api/documents/history', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { employeeId, startDate, endDate, type } = req.query;
        let query = `
            SELECT d.*, u1.name as applicant_name, u1.position as applicant_position,
                   u2.name as approver_name
            FROM documents d
            JOIN users u1 ON d.applicant_id = u1.id
            LEFT JOIN users u2 ON d.approver_id = u2.id
            WHERE d.status IN ('approved', 'rejected')
        `;
        const values = [];
        let idx = 1;

        if (employeeId) {
            query += ` AND d.applicant_id = $${idx++}`;
            values.push(Number(employeeId));
        }
        if (startDate) {
            query += ` AND d.start_date >= $${idx++}`;
            values.push(startDate);
        }
        if (endDate) {
            query += ` AND d.start_date <= $${idx++}`;
            values.push(endDate);
        }
        if (type && type !== 'leave_adjustment') {
            query += ` AND d.type = $${idx++}`;
            values.push(type);
        }

        query += ' ORDER BY d.processed_at DESC';

        // 연차 조정 타입이면 leave_adjustments에서만 조회
        if (type === 'leave_adjustment') {
            let adjQuery = `
                SELECT la.*, u.name as user_name, u.position as user_position,
                       ab.name as adjusted_by_name
                FROM leave_adjustments la
                JOIN users u ON la.user_id = u.id
                JOIN users ab ON la.adjusted_by = ab.id
                WHERE 1=1
            `;
            const adjValues = [];
            let adjIdx = 1;
            if (employeeId) {
                adjQuery += ` AND la.user_id = $${adjIdx++}`;
                adjValues.push(Number(employeeId));
            }
            if (startDate) {
                adjQuery += ` AND la.created_at >= $${adjIdx++}`;
                adjValues.push(startDate);
            }
            if (endDate) {
                adjQuery += ` AND la.created_at <= ($${adjIdx++})::date + INTERVAL '1 day'`;
                adjValues.push(endDate);
            }
            adjQuery += ' ORDER BY la.created_at DESC';
            const adjResult = await pool.query(adjQuery, adjValues);
            return res.json(adjResult.rows.map(r => ({
                id: r.id, type: 'leave_adjustment', subType: '',
                applicantId: r.user_id, applicantName: r.user_name,
                applicantPosition: r.user_position,
                approverId: r.adjusted_by, approverName: r.adjusted_by_name,
                startDate: null, endDate: null,
                startTime: null, endTime: null,
                reason: r.reason, status: 'completed',
                deductedLeave: Number(r.adjustment),
                createdAt: r.created_at, processedAt: r.created_at,
                isLeaveAdjustment: true
            })));
        }

        const result = await pool.query(query, values);
        res.json(result.rows.map(r => ({
            id: r.id, type: r.type, subType: r.sub_type,
            applicantId: r.applicant_id, applicantName: r.applicant_name,
            applicantPosition: r.applicant_position,
            approverId: r.approver_id, approverName: r.approver_name,
            startDate: r.start_date, endDate: r.end_date,
            startTime: r.start_time, endTime: r.end_time,
            reason: r.reason, status: r.status,
            deductedLeave: Number(r.deducted_leave),
            createdAt: r.created_at, processedAt: r.processed_at
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 수기 이력 추가 (관리자 전용)
app.post('/api/documents/manual', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { employeeId, type, subType, startDate, endDate, reason, startTime, endTime, deductedLeave } = req.body;
        if (!employeeId || !type || !subType || !startDate) {
            return res.status(400).json({ error: '필수 항목을 입력해주세요' });
        }

        const actualEndDate = endDate || startDate;
        const leave = Number(deductedLeave) || 0;

        // 연차 차감(양수) 또는 추가(음수)
        if (leave !== 0) {
            await pool.query('UPDATE users SET annual_leave = annual_leave - $1 WHERE id = $2', [leave, employeeId]);
        }

        const result = await pool.query(
            'INSERT INTO documents (type, sub_type, applicant_id, approver_id, start_date, end_date, reason, deducted_leave, start_time, end_time, status, processed_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW()) RETURNING id',
            [type, subType, employeeId, req.user.id, startDate, actualEndDate, reason || '', leave, startTime || null, endTime || null, 'approved']
        );
        const docId = result.rows[0].id;

        // 캘린더 일정 자동 생성
        if (type === 'vacation' || type === 'attendance') {
            const empResult = await pool.query('SELECT name FROM users WHERE id = $1', [employeeId]);
            const empName = empResult.rows[0]?.name || '';
            let scheduleTitle = `${subType} - ${empName}`;
            if (subType === '시간차' && startTime && endTime) {
                scheduleTitle = `시간차(${startTime}~${endTime}) - ${empName}`;
            }
            const start = new Date(startDate);
            const end = new Date(actualEndDate);
            for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                const dateStr = d.toISOString().split('T')[0];
                await pool.query(
                    'INSERT INTO schedules (user_id, date, title, type, document_id) VALUES ($1, $2, $3, $4, $5)',
                    [employeeId, dateStr, scheduleTitle, type, docId]
                );
            }
        }

        res.json({ id: docId, success: true });
    } catch (err) {
        console.error('POST /api/documents/manual error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/documents', authMiddleware, async (req, res) => {
    try {
        const { type, subType, approverId, startDate, endDate, reason, startTime, endTime } = req.body;
        if (!type || !subType || !approverId || !startDate) {
            return res.status(400).json({ error: '필수 항목을 입력해주세요' });
        }

        // 휴가 연차 차감 계산
        let deductedLeave = 0;
        if (type === 'vacation') {
            if (subType === '연차') {
                const start = new Date(startDate);
                const end = new Date(endDate || startDate);
                deductedLeave = Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
            } else if (subType === '시간차') {
                if (startTime && endTime) {
                    const hours = calcWorkHours(startTime, endTime);
                    deductedLeave = parseFloat((hours / 8).toFixed(4));
                } else {
                    deductedLeave = 0.5;
                }
            }
            // 병가는 차감 없음

            if (deductedLeave > 0) {
                const userResult = await pool.query('SELECT annual_leave FROM users WHERE id = $1', [req.user.id]);
                if (Number(userResult.rows[0].annual_leave) < deductedLeave) {
                    return res.status(400).json({ error: `잔여연차(${userResult.rows[0].annual_leave}일)가 부족합니다.` });
                }
                await pool.query('UPDATE users SET annual_leave = annual_leave - $1 WHERE id = $2', [deductedLeave, req.user.id]);
            }
        }

        const actualEndDate = endDate || startDate;
        const result = await pool.query(
            'INSERT INTO documents (type, sub_type, applicant_id, approver_id, start_date, end_date, reason, deducted_leave, start_time, end_time) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id',
            [type, subType, req.user.id, approverId, startDate, actualEndDate, reason || '', deductedLeave, startTime || null, endTime || null]
        );
        const docId = result.rows[0].id;

        // 휴가/근태: 캘린더에 일정 자동 생성
        if (type === 'vacation' || type === 'attendance') {
            let scheduleTitle = `${subType} - ${req.user.name}`;
            if ((subType === '시간차' || subType === '기타') && startTime && endTime) {
                scheduleTitle = `${subType}(${startTime}~${endTime}) - ${req.user.name}`;
            }
            const multiDay = subType === '연차' || subType === '시간차';
            if ((type === 'vacation' && multiDay) || type === 'attendance') {
                const start = new Date(startDate);
                const end = new Date(actualEndDate);
                for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                    const dateStr = d.toISOString().split('T')[0];
                    await pool.query(
                        'INSERT INTO schedules (user_id, date, title, type, document_id) VALUES ($1, $2, $3, $4, $5)',
                        [req.user.id, dateStr, scheduleTitle, type, docId]
                    );
                }
            } else {
                await pool.query(
                    'INSERT INTO schedules (user_id, date, title, type, document_id) VALUES ($1, $2, $3, $4, $5)',
                    [req.user.id, startDate, scheduleTitle, type, docId]
                );
            }
        }

        // 알림: 결재자에게
        const typeLabels = { vacation: '휴가', attendance: '근태', reason: '시말서' };
        await createNotification(
            approverId, 'document_submitted',
            '새 서류 신청',
            `${req.user.name}님이 ${typeLabels[type] || type}(${subType})을 신청했습니다.`,
            'documents'
        );

        res.json({ id: docId, success: true });
    } catch (err) {
        console.error('POST /api/documents error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/documents/:id/approve', authMiddleware, async (req, res) => {
    try {
        const doc = await pool.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
        if (doc.rows.length === 0) return res.status(404).json({ error: '서류를 찾을 수 없습니다' });

        const d = doc.rows[0];
        // 지정된 결재자만 승인 가능 (대표 자체결재 포함)
        if (d.approver_id !== req.user.id) {
            return res.status(403).json({ error: '지정된 결재자만 승인할 수 있습니다' });
        }
        if (d.status !== 'pending') return res.status(400).json({ error: '이미 처리된 서류입니다' });

        await pool.query('UPDATE documents SET status = $1, processed_at = NOW() WHERE id = $2', ['approved', req.params.id]);

        // 알림: 신청자에게
        const tl = { vacation: '휴가', attendance: '근태', reason: '시말서' };
        await createNotification(
            d.applicant_id, 'document_approved',
            '서류 승인',
            `${tl[d.type] || d.type}(${d.sub_type}) 신청이 승인되었습니다.`,
            'documents'
        );

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/documents/:id/reject', authMiddleware, async (req, res) => {
    try {
        const doc = await pool.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
        if (doc.rows.length === 0) return res.status(404).json({ error: '서류를 찾을 수 없습니다' });

        const d = doc.rows[0];
        // 지정된 결재자만 반려 가능
        if (d.approver_id !== req.user.id) {
            return res.status(403).json({ error: '지정된 결재자만 반려할 수 있습니다' });
        }
        if (d.status !== 'pending') return res.status(400).json({ error: '이미 처리된 서류입니다' });

        // 연차 복구 (차감이면 +, 추가였으면 -)
        if (Number(d.deducted_leave) !== 0) {
            await pool.query('UPDATE users SET annual_leave = annual_leave + $1 WHERE id = $2', [d.deducted_leave, d.applicant_id]);
        }

        // 연동된 일정 삭제
        await pool.query('DELETE FROM schedules WHERE document_id = $1', [req.params.id]);

        await pool.query('UPDATE documents SET status = $1, processed_at = NOW() WHERE id = $2', ['rejected', req.params.id]);

        // 알림: 신청자에게
        const tl2 = { vacation: '휴가', attendance: '근태', reason: '시말서' };
        await createNotification(
            d.applicant_id, 'document_rejected',
            '서류 반려',
            `${tl2[d.type] || d.type}(${d.sub_type}) 신청이 반려되었습니다.`,
            'documents'
        );

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 수정/취소 요청
app.put('/api/documents/:id/request-modification', authMiddleware, async (req, res) => {
    try {
        const doc = await pool.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
        if (doc.rows.length === 0) return res.status(404).json({ error: '서류를 찾을 수 없습니다' });
        const d = doc.rows[0];
        if (d.applicant_id !== req.user.id) return res.status(403).json({ error: '본인 서류만 수정 요청할 수 있습니다' });
        if (d.status !== 'approved') return res.status(400).json({ error: '승인된 서류만 수정 요청할 수 있습니다' });

        const { modification_type, modification_reason, new_start_date, new_end_date, new_start_time, new_end_time } = req.body;
        if (!modification_type || !modification_reason) return res.status(400).json({ error: '수정 유형과 사유를 입력해주세요' });

        await pool.query(
            `UPDATE documents SET status = 'modification_pending',
             modification_type = $1, modification_reason = $2,
             new_start_date = $3, new_end_date = $4, new_start_time = $5, new_end_time = $6
             WHERE id = $7`,
            [modification_type, modification_reason, new_start_date || null, new_end_date || null, new_start_time || null, new_end_time || null, req.params.id]
        );

        // 알림: 결재자에게
        const tl3 = { vacation: '휴가', attendance: '근태', reason: '시말서' };
        const modLabel = modification_type === 'cancel' ? '취소' : '수정';
        await createNotification(
            d.approver_id, 'modification_requested',
            '서류 수정 요청',
            `${req.user.name}님이 ${tl3[d.type] || d.type}(${d.sub_type}) ${modLabel}을 요청했습니다.`,
            'documents'
        );

        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 수정 요청 승인
app.put('/api/documents/:id/approve-modification', authMiddleware, async (req, res) => {
    try {
        const doc = await pool.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
        if (doc.rows.length === 0) return res.status(404).json({ error: '서류를 찾을 수 없습니다' });
        const d = doc.rows[0];
        // 지정된 결재자만 처리 가능 (대표 자체결재 포함)
        if (d.approver_id !== req.user.id) return res.status(403).json({ error: '지정된 결재자만 처리할 수 있습니다' });
        if (d.status !== 'modification_pending') return res.status(400).json({ error: '수정 대기 중인 서류가 아닙니다' });

        if (d.modification_type === 'cancel') {
            // 취소: 연차 복구 + 일정 삭제 + status cancelled
            if (Number(d.deducted_leave) !== 0) {
                await pool.query('UPDATE users SET annual_leave = annual_leave + $1 WHERE id = $2', [d.deducted_leave, d.applicant_id]);
            }
            await pool.query('DELETE FROM schedules WHERE document_id = $1', [req.params.id]);
            await pool.query(
                `UPDATE documents SET status = 'cancelled', processed_at = NOW(),
                 modification_type = NULL, modification_reason = NULL,
                 new_start_date = NULL, new_end_date = NULL, new_start_time = NULL, new_end_time = NULL
                 WHERE id = $1`, [req.params.id]
            );
        } else {
            // 수정: 날짜 변경 + 연차 재계산 + 일정 재생성
            const newStart = d.new_start_date || d.start_date;
            const newEnd = d.new_end_date || d.end_date;
            const newStartTime = d.new_start_time || d.start_time;
            const newEndTime = d.new_end_time || d.end_time;
            const oldDeducted = Number(d.deducted_leave);

            // 새 연차 차감량 계산
            let newDeducted = 0;
            if (d.type === 'vacation') {
                if (d.sub_type === '연차') {
                    const s = new Date(newStart);
                    const e = new Date(newEnd);
                    newDeducted = Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1;
                } else if (d.sub_type === '시간차') {
                    if (newStartTime && newEndTime) {
                        const hours = calcWorkHours(newStartTime, newEndTime);
                        newDeducted = parseFloat((hours / 8).toFixed(4));
                    } else { newDeducted = 0.5; }
                }
            }

            // 연차 차이 반영
            const diff = oldDeducted - newDeducted;
            if (diff !== 0) {
                await pool.query('UPDATE users SET annual_leave = annual_leave + $1 WHERE id = $2', [diff, d.applicant_id]);
            }

            // 기존 일정 삭제 + 새 일정 생성
            await pool.query('DELETE FROM schedules WHERE document_id = $1', [req.params.id]);
            if (d.type === 'vacation' || d.type === 'attendance') {
                const userName = (await pool.query('SELECT name FROM users WHERE id = $1', [d.applicant_id])).rows[0].name;
                let scheduleTitle = `${d.sub_type} - ${userName}`;
                if (d.sub_type === '시간차' && newStartTime && newEndTime) {
                    scheduleTitle = `시간차(${newStartTime}~${newEndTime}) - ${userName}`;
                }
                const start = new Date(newStart);
                const end = new Date(newEnd);
                for (let dt = new Date(start); dt <= end; dt.setDate(dt.getDate() + 1)) {
                    const dateStr = dt.toISOString().split('T')[0];
                    await pool.query(
                        'INSERT INTO schedules (user_id, date, title, type, document_id) VALUES ($1, $2, $3, $4, $5)',
                        [d.applicant_id, dateStr, scheduleTitle, d.type, req.params.id]
                    );
                }
            }

            // 서류 업데이트
            await pool.query(
                `UPDATE documents SET status = 'approved', processed_at = NOW(),
                 start_date = $1, end_date = $2, start_time = $3, end_time = $4, deducted_leave = $5,
                 modification_type = NULL, modification_reason = NULL,
                 new_start_date = NULL, new_end_date = NULL, new_start_time = NULL, new_end_time = NULL
                 WHERE id = $6`,
                [newStart, newEnd, newStartTime, newEndTime, newDeducted, req.params.id]
            );
        }

        // 알림: 신청자에게
        const tl4 = { vacation: '휴가', attendance: '근태', reason: '시말서' };
        const modLabel2 = d.modification_type === 'cancel' ? '취소' : '수정';
        await createNotification(
            d.applicant_id, 'modification_approved',
            '수정 요청 승인',
            `${tl4[d.type] || d.type}(${d.sub_type}) ${modLabel2} 요청이 승인되었습니다.`,
            'documents'
        );

        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 수정 요청 반려
app.put('/api/documents/:id/reject-modification', authMiddleware, async (req, res) => {
    try {
        const doc = await pool.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
        if (doc.rows.length === 0) return res.status(404).json({ error: '서류를 찾을 수 없습니다' });
        const d = doc.rows[0];
        if (d.approver_id !== req.user.id) return res.status(403).json({ error: '지정된 결재자만 처리할 수 있습니다' });
        if (d.status !== 'modification_pending') return res.status(400).json({ error: '수정 대기 중인 서류가 아닙니다' });
        // 기존 승인 상태로 복원, 수정요청 내용 초기화
        await pool.query(
            `UPDATE documents SET status = 'approved',
             modification_type = NULL, modification_reason = NULL,
             new_start_date = NULL, new_end_date = NULL, new_start_time = NULL, new_end_time = NULL
             WHERE id = $1`, [req.params.id]
        );

        // 알림: 신청자에게
        const tl5 = { vacation: '휴가', attendance: '근태', reason: '시말서' };
        const modLabel3 = d.modification_type === 'cancel' ? '취소' : '수정';
        await createNotification(
            d.applicant_id, 'modification_rejected',
            '수정 요청 반려',
            `${tl5[d.type] || d.type}(${d.sub_type}) ${modLabel3} 요청이 반려되었습니다.`,
            'documents'
        );

        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 서류 수정
app.put('/api/documents/:id', authMiddleware, async (req, res) => {
    try {
        const doc = await pool.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
        if (doc.rows.length === 0) return res.status(404).json({ error: '서류를 찾을 수 없습니다' });

        const d = doc.rows[0];
        const isApplicant = d.applicant_id === req.user.id;
        const isApprover = d.approver_id === req.user.id;
        // 권한: 대기중/반려 → 신청자 본인 또는 결재자, 승인 → 결재자만
        if (d.status === 'approved') {
            if (!isApprover) return res.status(403).json({ error: '승인된 서류는 결재자만 수정할 수 있습니다' });
        } else {
            if (!isApplicant && !isApprover) return res.status(403).json({ error: '수정 권한이 없습니다' });
        }

        const { subType, startDate, endDate, reason, approverId, startTime, endTime } = req.body;
        const newSubType = subType || d.sub_type;
        const newStartDate = startDate || d.start_date;
        const newEndDate = endDate || startDate || d.end_date;
        const newReason = reason !== undefined ? reason : d.reason;
        const newApproverId = approverId || d.approver_id;
        const newStartTime = startTime !== undefined ? startTime : d.start_time;
        const newEndTime = endTime !== undefined ? endTime : d.end_time;

        // 연차 재계산: 기존 차감분 복구 후 새로 차감
        const oldDeducted = Number(d.deducted_leave);
        if (d.status !== 'rejected' && oldDeducted > 0) {
            await pool.query('UPDATE users SET annual_leave = annual_leave + $1 WHERE id = $2', [oldDeducted, d.applicant_id]);
        }

        let newDeducted = 0;
        if (d.type === 'vacation') {
            if (newSubType === '연차') {
                const s = new Date(newStartDate);
                const e = new Date(newEndDate);
                newDeducted = Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1;
            } else if (newSubType === '시간차') {
                if (newStartTime && newEndTime) {
                    const hours = calcWorkHours(newStartTime, newEndTime);
                    newDeducted = parseFloat((hours / 8).toFixed(4));
                } else {
                    newDeducted = 0.5;
                }
            }
            if (newDeducted > 0) {
                const userResult = await pool.query('SELECT annual_leave FROM users WHERE id = $1', [d.applicant_id]);
                if (Number(userResult.rows[0].annual_leave) < newDeducted) {
                    if (d.status !== 'rejected' && oldDeducted > 0) {
                        await pool.query('UPDATE users SET annual_leave = annual_leave - $1 WHERE id = $2', [oldDeducted, d.applicant_id]);
                    }
                    return res.status(400).json({ error: `잔여연차(${userResult.rows[0].annual_leave}일)가 부족합니다.` });
                }
                await pool.query('UPDATE users SET annual_leave = annual_leave - $1 WHERE id = $2', [newDeducted, d.applicant_id]);
            }
        }

        // 반려 상태에서 수정 → 대기중으로 재제출
        const newStatus = d.status === 'rejected' ? 'pending' : d.status;

        await pool.query(
            'UPDATE documents SET sub_type=$1, start_date=$2, end_date=$3, reason=$4, approver_id=$5, deducted_leave=$6, status=$7, processed_at=$8, start_time=$9, end_time=$10 WHERE id=$11',
            [newSubType, newStartDate, newEndDate, newReason, newApproverId, newDeducted, newStatus, newStatus === 'pending' ? null : d.processed_at, newStartTime || null, newEndTime || null, req.params.id]
        );

        // 연동 일정 재생성
        await pool.query('DELETE FROM schedules WHERE document_id = $1', [req.params.id]);
        if (d.type === 'vacation' || d.type === 'attendance') {
            const applicant = await pool.query('SELECT name FROM users WHERE id = $1', [d.applicant_id]);
            const userName = applicant.rows[0].name;
            let scheduleTitle = `${newSubType} - ${userName}`;
            if (newSubType === '시간차' && newStartTime && newEndTime) {
                scheduleTitle = `시간차(${newStartTime}~${newEndTime}) - ${userName}`;
            }
            const multiDay = newSubType === '연차' || newSubType === '병가' || newSubType === '시간차';
            if (d.type === 'vacation' && multiDay) {
                const s = new Date(newStartDate);
                const e = new Date(newEndDate);
                for (let dd = new Date(s); dd <= e; dd.setDate(dd.getDate() + 1)) {
                    const dateStr = dd.toISOString().split('T')[0];
                    await pool.query(
                        'INSERT INTO schedules (user_id, date, title, type, document_id) VALUES ($1, $2, $3, $4, $5)',
                        [d.applicant_id, dateStr, scheduleTitle, d.type, req.params.id]
                    );
                }
            } else {
                await pool.query(
                    'INSERT INTO schedules (user_id, date, title, type, document_id) VALUES ($1, $2, $3, $4, $5)',
                    [d.applicant_id, newStartDate, scheduleTitle, d.type, req.params.id]
                );
            }
        }

        res.json({ success: true });
    } catch (err) {
        console.error('PUT /api/documents/:id error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/documents/:id', authMiddleware, async (req, res) => {
    try {
        const doc = await pool.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
        if (doc.rows.length === 0) return res.status(404).json({ error: '서류를 찾을 수 없습니다' });

        const d = doc.rows[0];
        const isDaepyo = req.user.position === '대표';
        const isApplicant = d.applicant_id === req.user.id;
        const isApprover = d.approver_id === req.user.id;
        // 대표는 모든 서류 삭제 가능
        if (!isDaepyo) {
            // 대기/반려: 신청자 본인 또는 결재자
            // 승인 완료: 결재자만 (신청자는 수정요청으로)
            if (d.status === 'approved') {
                if (!isApprover) return res.status(403).json({ error: '승인된 서류는 결재자만 삭제할 수 있습니다' });
            } else {
                if (!isApplicant && !isApprover) return res.status(403).json({ error: '삭제 권한이 없습니다' });
            }
        }

        // 반려 아닌 경우 연차 복구
        if (d.status !== 'rejected' && Number(d.deducted_leave) !== 0) {
            await pool.query('UPDATE users SET annual_leave = annual_leave + $1 WHERE id = $2', [d.deducted_leave, d.applicant_id]);
        }

        // 연동 일정은 ON DELETE CASCADE로 자동 삭제
        await pool.query('DELETE FROM documents WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === Expense Reports API (지출결의서) ===

// 지출결의서 작성
app.post('/api/expense-reports', authMiddleware, async (req, res) => {
    try {
        const { title, purpose, items } = req.body;
        if (!title) return res.status(400).json({ error: '제목을 입력해주세요' });
        if (!items || items.length === 0) return res.status(400).json({ error: '지출 항목을 추가해주세요' });
        const totalAmount = items.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);

        // 결재라인 결정
        let managerId = null, ceoId = null;
        const ceoResult = await pool.query("SELECT id FROM users WHERE position = '대표' AND role = 'admin' LIMIT 1");
        const ceoUser = ceoResult.rows[0];
        if (!ceoUser) return res.status(500).json({ error: '대표 계정을 찾을 수 없습니다' });
        ceoId = ceoUser.id;

        if (req.user.position === '대표') {
            // 대표 본인 → 자체 결재 (manager 없음)
            managerId = null;
        } else if (req.user.role === 'admin') {
            // 부장(관리자) → 1차 없이 대표에게 바로
            managerId = null;
        } else {
            // 일반 직원 → 부장(1차) + 대표(2차)
            const mgrResult = await pool.query("SELECT id FROM users WHERE role = 'admin' AND position != '대표' ORDER BY name LIMIT 1");
            managerId = mgrResult.rows.length > 0 ? mgrResult.rows[0].id : null;
        }

        const result = await pool.query(
            `INSERT INTO expense_reports (title, applicant_id, total_amount, purpose, items, manager_id, ceo_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
            [title, req.user.id, totalAmount, purpose || '', JSON.stringify(items), managerId, ceoId]
        );

        // 알림: 1차 결재자 또는 대표에게
        const notifyTo = managerId || ceoId;
        const applicantInfo = await pool.query('SELECT name, position FROM users WHERE id = $1', [req.user.id]);
        const applicantName = applicantInfo.rows[0] ? `${applicantInfo.rows[0].position} ${applicantInfo.rows[0].name}` : '';
        await createNotification(notifyTo, 'expense', '지출결의서 결재 요청', `${applicantName}님이 "${title}" 지출결의서를 제출했습니다.`, 'expense');

        res.json({ id: result.rows[0].id, success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 내 신청 목록
app.get('/api/expense-reports/my', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT er.*, u.name as applicant_name, u.position as applicant_position,
                    m.name as manager_name, m.position as manager_position,
                    c.name as ceo_name, c.position as ceo_position
             FROM expense_reports er
             LEFT JOIN users u ON er.applicant_id = u.id
             LEFT JOIN users m ON er.manager_id = m.id
             LEFT JOIN users c ON er.ceo_id = c.id
             WHERE er.applicant_id = $1
             ORDER BY er.created_at DESC`,
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 결재 대기 목록
app.get('/api/expense-reports/pending', authMiddleware, async (req, res) => {
    try {
        let result;
        if (req.user.position === '대표') {
            // 대표: manager_approved(1차 완료) + ceo_status=pending 이거나, manager 없이 ceo에게 바로 온 것
            result = await pool.query(
                `SELECT er.*, u.name as applicant_name, u.position as applicant_position,
                        m.name as manager_name, m.position as manager_position,
                        c.name as ceo_name, c.position as ceo_position
                 FROM expense_reports er
                 LEFT JOIN users u ON er.applicant_id = u.id
                 LEFT JOIN users m ON er.manager_id = m.id
                 LEFT JOIN users c ON er.ceo_id = c.id
                 WHERE er.ceo_id = $1 AND er.ceo_status = 'pending'
                   AND (er.manager_id IS NULL OR er.manager_status = 'approved')
                   AND er.status != 'rejected'
                 ORDER BY er.created_at DESC`,
                [req.user.id]
            );
        } else if (req.user.role === 'admin') {
            // 부장: manager_status=pending인 것
            result = await pool.query(
                `SELECT er.*, u.name as applicant_name, u.position as applicant_position,
                        m.name as manager_name, m.position as manager_position,
                        c.name as ceo_name, c.position as ceo_position
                 FROM expense_reports er
                 LEFT JOIN users u ON er.applicant_id = u.id
                 LEFT JOIN users m ON er.manager_id = m.id
                 LEFT JOIN users c ON er.ceo_id = c.id
                 WHERE er.manager_id = $1 AND er.manager_status = 'pending' AND er.status != 'rejected'
                 ORDER BY er.created_at DESC`,
                [req.user.id]
            );
        } else {
            result = { rows: [] };
        }
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 전체 이력 조회 (관리자만)
app.get('/api/expense-reports/history', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { applicant_id, start_date, end_date } = req.query;
        let query = `SELECT er.*, u.name as applicant_name, u.position as applicant_position,
                    m.name as manager_name, m.position as manager_position,
                    c.name as ceo_name, c.position as ceo_position
             FROM expense_reports er
             LEFT JOIN users u ON er.applicant_id = u.id
             LEFT JOIN users m ON er.manager_id = m.id
             LEFT JOIN users c ON er.ceo_id = c.id`;
        const conditions = [];
        const params = [];
        if (applicant_id) {
            params.push(applicant_id);
            conditions.push(`er.applicant_id = $${params.length}`);
        }
        if (start_date) {
            params.push(start_date);
            conditions.push(`er.created_at >= $${params.length}::date`);
        }
        if (end_date) {
            params.push(end_date);
            conditions.push(`er.created_at < ($${params.length}::date + INTERVAL '1 day')`);
        }
        if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
        query += ' ORDER BY er.created_at DESC';
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 상세 조회
app.get('/api/expense-reports/:id', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT er.*, u.name as applicant_name, u.position as applicant_position,
                    m.name as manager_name, m.position as manager_position,
                    c.name as ceo_name, c.position as ceo_position,
                    r.name as rejected_by_name
             FROM expense_reports er
             LEFT JOIN users u ON er.applicant_id = u.id
             LEFT JOIN users m ON er.manager_id = m.id
             LEFT JOIN users c ON er.ceo_id = c.id
             LEFT JOIN users r ON er.rejected_by = r.id
             WHERE er.id = $1`,
            [req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: '지출결의서를 찾을 수 없습니다' });
        const row = result.rows[0];
        // 본인 또는 관리자만 조회 가능
        if (row.applicant_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: '조회 권한이 없습니다' });
        }
        res.json(row);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 승인
app.put('/api/expense-reports/:id/approve', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM expense_reports WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: '지출결의서를 찾을 수 없습니다' });
        const er = result.rows[0];

        // 1차 결재 (부장)
        if (er.manager_id === req.user.id && er.manager_status === 'pending') {
            await pool.query(
                `UPDATE expense_reports SET manager_status = 'approved', manager_approved_at = NOW(), status = 'manager_approved' WHERE id = $1`,
                [req.params.id]
            );
            // 알림: 대표에게 + 신청자에게
            const applicantInfo = await pool.query('SELECT name, position FROM users WHERE id = $1', [er.applicant_id]);
            const aName = applicantInfo.rows[0] ? `${applicantInfo.rows[0].position} ${applicantInfo.rows[0].name}` : '';
            await createNotification(er.ceo_id, 'expense', '지출결의서 2차 결재 요청', `${aName}님의 "${er.title}" 지출결의서가 1차 승인되었습니다.`, 'expense');
            await createNotification(er.applicant_id, 'expense', '지출결의서 1차 승인', `"${er.title}" 지출결의서가 1차 승인되었습니다.`, 'expense');
            return res.json({ success: true, status: 'manager_approved' });
        }

        // 2차 결재 (대표) 또는 대표 자체 결재
        if (er.ceo_id === req.user.id && er.ceo_status === 'pending') {
            // 1차가 필요한데 아직 안된 경우 차단
            if (er.manager_id && er.manager_status !== 'approved') {
                return res.status(400).json({ error: '1차 결재가 완료되지 않았습니다' });
            }
            await pool.query(
                `UPDATE expense_reports SET ceo_status = 'approved', ceo_approved_at = NOW(), status = 'approved' WHERE id = $1`,
                [req.params.id]
            );
            // 알림: 신청자에게 (본인이 아닌 경우)
            if (er.applicant_id !== req.user.id) {
                await createNotification(er.applicant_id, 'expense', '지출결의서 최종 승인', `"${er.title}" 지출결의서가 최종 승인되었습니다.`, 'expense');
            }
            return res.json({ success: true, status: 'approved' });
        }

        res.status(403).json({ error: '결재 권한이 없습니다' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 반려
app.put('/api/expense-reports/:id/reject', authMiddleware, async (req, res) => {
    try {
        const { reason } = req.body;
        const result = await pool.query('SELECT * FROM expense_reports WHERE id = $1', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: '지출결의서를 찾을 수 없습니다' });
        const er = result.rows[0];

        const isManager = er.manager_id === req.user.id && er.manager_status === 'pending';
        const isCeo = er.ceo_id === req.user.id && er.ceo_status === 'pending';
        if (!isManager && !isCeo) return res.status(403).json({ error: '반려 권한이 없습니다' });

        await pool.query(
            `UPDATE expense_reports SET status = 'rejected', rejected_by = $1, reject_reason = $2 WHERE id = $3`,
            [req.user.id, reason || '', req.params.id]
        );

        // 알림: 신청자에게
        const rejectorInfo = await pool.query('SELECT name, position FROM users WHERE id = $1', [req.user.id]);
        const rName = rejectorInfo.rows[0] ? `${rejectorInfo.rows[0].position} ${rejectorInfo.rows[0].name}` : '';
        await createNotification(er.applicant_id, 'expense', '지출결의서 반려', `"${er.title}" 지출결의서가 ${rName}님에 의해 반려되었습니다.${reason ? ' 사유: ' + reason : ''}`, 'expense');

        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 삭제 (대표만 가능)
app.delete('/api/expense-reports/:id', authMiddleware, async (req, res) => {
    try {
        if (req.user.position !== '대표') {
            return res.status(403).json({ error: '지출결의서 삭제는 대표만 가능합니다' });
        }
        const result = await pool.query('DELETE FROM expense_reports WHERE id = $1 RETURNING id', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: '지출결의서를 찾을 수 없습니다' });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// === Box Inventory API (박스재고) ===

app.get('/api/box-inventory', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM box_inventory ORDER BY id');
        res.json(result.rows.map(r => ({
            id: r.id,
            productName: r.product_name,
            companyStock: r.company_stock,
            daesongStock: r.daesong_stock,
            updatedAt: r.updated_at
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/box-inventory/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { companyStock, daesongStock } = req.body;
        await pool.query(
            'UPDATE box_inventory SET company_stock = $1, daesong_stock = $2, updated_by = $3, updated_at = NOW() WHERE id = $4',
            [companyStock, daesongStock, req.user.id, req.params.id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === Planner API (마이 플래너) ===

// Todos
app.get('/api/planner/todos', authMiddleware, async (req, res) => {
    try {
        const { date } = req.query;
        const result = await pool.query(
            'SELECT * FROM planner_todos WHERE user_id = $1 AND date = $2 ORDER BY is_completed, sort_order, id',
            [req.user.id, date]
        );
        res.json(result.rows.map(r => ({ id: r.id, date: r.date, content: r.content, isCompleted: r.is_completed, sortOrder: r.sort_order })));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/planner/todos', authMiddleware, async (req, res) => {
    try {
        const { date, content } = req.body;
        const result = await pool.query(
            'INSERT INTO planner_todos (user_id, date, content) VALUES ($1, $2, $3) RETURNING id',
            [req.user.id, date, content]
        );
        res.json({ id: result.rows[0].id, success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/planner/todos/:id', authMiddleware, async (req, res) => {
    try {
        const { isCompleted, date } = req.body;
        const doc = await pool.query('SELECT user_id FROM planner_todos WHERE id = $1', [req.params.id]);
        if (!doc.rows[0] || doc.rows[0].user_id !== req.user.id) return res.status(403).json({ error: '권한 없음' });
        const sets = [];
        const vals = [];
        let idx = 1;
        if (isCompleted !== undefined) { sets.push(`is_completed = $${idx++}`); vals.push(isCompleted); }
        if (date !== undefined) { sets.push(`date = $${idx++}`); vals.push(date); }
        vals.push(req.params.id);
        await pool.query(`UPDATE planner_todos SET ${sets.join(', ')} WHERE id = $${idx}`, vals);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/planner/todos/:id', authMiddleware, async (req, res) => {
    try {
        await pool.query('DELETE FROM planner_todos WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Memos
app.get('/api/planner/memos', authMiddleware, async (req, res) => {
    try {
        const { date } = req.query;
        const result = await pool.query('SELECT * FROM planner_memos WHERE user_id = $1 AND date = $2', [req.user.id, date]);
        res.json(result.rows[0] ? { id: result.rows[0].id, content: result.rows[0].content } : null);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/planner/memos', authMiddleware, async (req, res) => {
    try {
        const { date, content } = req.body;
        await pool.query(
            'INSERT INTO planner_memos (user_id, date, content) VALUES ($1, $2, $3) ON CONFLICT (user_id, date) DO UPDATE SET content = $3',
            [req.user.id, date, content]
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// D-days
app.get('/api/planner/ddays', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM planner_ddays WHERE user_id = $1 ORDER BY target_date', [req.user.id]);
        res.json(result.rows.map(r => ({ id: r.id, title: r.title, targetDate: r.target_date, color: r.color })));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/planner/ddays', authMiddleware, async (req, res) => {
    try {
        const { title, targetDate, color } = req.body;
        const result = await pool.query(
            'INSERT INTO planner_ddays (user_id, title, target_date, color) VALUES ($1, $2, $3, $4) RETURNING id',
            [req.user.id, title, targetDate, color || '#F5A623']
        );
        res.json({ id: result.rows[0].id, success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/planner/ddays/:id', authMiddleware, async (req, res) => {
    try {
        await pool.query('DELETE FROM planner_ddays WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Habits
app.get('/api/planner/habits', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM planner_habits WHERE user_id = $1 ORDER BY id', [req.user.id]);
        res.json(result.rows.map(r => ({ id: r.id, title: r.title })));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/planner/habits', authMiddleware, async (req, res) => {
    try {
        const { title } = req.body;
        const result = await pool.query('INSERT INTO planner_habits (user_id, title) VALUES ($1, $2) RETURNING id', [req.user.id, title]);
        res.json({ id: result.rows[0].id, success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/planner/habits/:id', authMiddleware, async (req, res) => {
    try {
        await pool.query('DELETE FROM planner_habits WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Habit Logs
app.get('/api/planner/habit-logs', authMiddleware, async (req, res) => {
    try {
        const { month } = req.query;
        const result = await pool.query(
            `SELECT hl.* FROM planner_habit_logs hl JOIN planner_habits h ON hl.habit_id = h.id
             WHERE h.user_id = $1 AND to_char(hl.date, 'YYYY-MM') = $2`,
            [req.user.id, month]
        );
        res.json(result.rows.map(r => ({ id: r.id, habitId: r.habit_id, date: r.date, isDone: r.is_done })));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/planner/habit-logs', authMiddleware, async (req, res) => {
    try {
        const { habitId, date } = req.body;
        const h = await pool.query('SELECT user_id FROM planner_habits WHERE id = $1', [habitId]);
        if (!h.rows[0] || h.rows[0].user_id !== req.user.id) return res.status(403).json({ error: '권한 없음' });
        await pool.query('INSERT INTO planner_habit_logs (habit_id, date) VALUES ($1, $2) ON CONFLICT (habit_id, date) DO NOTHING', [habitId, date]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/planner/habit-logs', authMiddleware, async (req, res) => {
    try {
        const { habitId, date } = req.body;
        const h = await pool.query('SELECT user_id FROM planner_habits WHERE id = $1', [habitId]);
        if (!h.rows[0] || h.rows[0].user_id !== req.user.id) return res.status(403).json({ error: '권한 없음' });
        await pool.query('DELETE FROM planner_habit_logs WHERE habit_id = $1 AND date = $2', [habitId, date]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// Calendar dots + 상세 데이터 (할일/메모/D-day)
app.get('/api/planner/calendar-dots', authMiddleware, async (req, res) => {
    try {
        const { month } = req.query;
        const todos = await pool.query(
            "SELECT to_char(date, 'YYYY-MM-DD') as d, content, is_completed FROM planner_todos WHERE user_id = $1 AND to_char(date, 'YYYY-MM') = $2 ORDER BY is_completed, sort_order, id",
            [req.user.id, month]
        );
        const memos = await pool.query(
            "SELECT to_char(date, 'YYYY-MM-DD') as d, content FROM planner_memos WHERE user_id = $1 AND to_char(date, 'YYYY-MM') = $2",
            [req.user.id, month]
        );
        const ddays = await pool.query(
            "SELECT title, to_char(target_date, 'YYYY-MM-DD') as target_date FROM planner_ddays WHERE user_id = $1",
            [req.user.id]
        );
        // Group todos by date
        const todosByDate = {};
        todos.rows.forEach(r => {
            if (!todosByDate[r.d]) todosByDate[r.d] = [];
            todosByDate[r.d].push({ content: r.content, done: r.is_completed });
        });
        // Group memos by date
        const memosByDate = {};
        memos.rows.forEach(r => { memosByDate[r.d] = r.content; });
        // Group ddays by target_date
        const ddaysByDate = {};
        ddays.rows.forEach(r => {
            if (!ddaysByDate[r.target_date]) ddaysByDate[r.target_date] = [];
            ddaysByDate[r.target_date].push(r.title);
        });
        res.json({
            todoDates: Object.keys(todosByDate),
            memoDates: Object.keys(memosByDate),
            todosByDate, memosByDate, ddaysByDate
        });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// === CJ 이월금액 API ===
app.get('/api/cj-carryover', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { month } = req.query;
        const result = await pool.query(
            `SELECT *, to_char(start_date, 'YYYY-MM-DD') as start_date, to_char(end_date, 'YYYY-MM-DD') as end_date FROM cj_carryover WHERE month = $1`,
            [month]
        );
        res.json(result.rows[0] || { month, amount: 0, note: '', start_date: '', end_date: '' });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/cj-carryover', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { month, amount, note, startDate, endDate } = req.body;
        const result = await pool.query(
            `INSERT INTO cj_carryover (month, amount, note, start_date, end_date, updated_by, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())
             ON CONFLICT (month) DO UPDATE SET amount = $2, note = $3, start_date = $4, end_date = $5, updated_by = $6, updated_at = NOW()
             RETURNING *`,
            [month, amount || 0, note || '', startDate || null, endDate || null, req.user.id]
        );
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// === Settlements API (인증 추가) ===

app.get('/api/settlements', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { month } = req.query;

        // JSONB 안전 파싱 헬퍼
        function safeItems(val) {
            if (!val) return [];
            if (typeof val === 'string') { try { return JSON.parse(val); } catch { return []; } }
            return Array.isArray(val) ? val : [];
        }

        // SQL로 settlements + 정확히 날짜 범위가 매칭되는 pricing만 조회 (fallback 없음)
        // jsonb_agg ORDER BY p.id ASC: 최신 pricing 기록(높은 id)이 나중에 적용되어 우선순위 가짐 (for-date API와 동일 방식)
        const settlementQuery = month
            ? `SELECT s.*,
                 (SELECT jsonb_agg(p.items ORDER BY p.id ASC) FROM pricing p
                  WHERE p.partner = s.partner AND p.start_date <= s.date AND p.end_date >= s.date) as pricing_items
               FROM settlements s WHERE TO_CHAR(s.date, 'YYYY-MM') = $1 ORDER BY s.date, s.id`
            : `SELECT s.*,
                 (SELECT jsonb_agg(p.items ORDER BY p.id ASC) FROM pricing p
                  WHERE p.partner = s.partner AND p.start_date <= s.date AND p.end_date >= s.date) as pricing_items
               FROM settlements s ORDER BY s.date, s.id`;

        const result = month
            ? await pool.query(settlementQuery, [month])
            : await pool.query(settlementQuery);

        // product_mappings 조회 (품목명 매칭 fallback용)
        const mappingsResult = await pool.query('SELECT * FROM product_mappings ORDER BY id');
        const mappingsByPartner = {};
        mappingsResult.rows.forEach(m => {
            if (!mappingsByPartner[m.partner]) mappingsByPartner[m.partner] = {};
            mappingsByPartner[m.partner][m.sales_name] = m.pricing_name;
        });

        const data = result.rows.map(row => {
            const items = safeItems(row.items);
            const settlementDate = normDateSafe(row.date);

            // SQL에서 가져온 pricing items 사용 (정확한 날짜 범위 매칭만, fallback 없음)
            const rawPricingItems = safeItems(row.pricing_items);

            // pricing의 품목별 단가 맵 생성 (jsonb_agg 결과는 배열의 배열)
            const priceMap = {};
            rawPricingItems.forEach(pItems => {
                const pArr = safeItems(pItems);
                pArr.forEach(item => {
                    if (item && item.name) priceMap[item.name] = Number(item.price) || 0;
                });
            });

            // 해당 거래처의 product_mappings
            const partnerMappings = mappingsByPartner[row.partner] || {};

            // items의 단가를 pricing 단가로 업데이트
            let updatedItems = items;
            if (Object.keys(priceMap).length > 0 && items.length > 0) {
                updatedItems = items.map(item => {
                    if (!item || !item.name) return item;
                    // 1차: 정확한 이름 매칭
                    if (priceMap[item.name] !== undefined) {
                        const newPrice = priceMap[item.name];
                        return { ...item, price: newPrice, subtotal: newPrice * (item.qty || 0) };
                    }
                    // 2차: product_mappings 테이블 기반 매칭
                    const mappedName = partnerMappings[item.name];
                    if (mappedName && priceMap[mappedName] !== undefined) {
                        const newPrice = priceMap[mappedName];
                        return { ...item, price: newPrice, subtotal: newPrice * (item.qty || 0) };
                    }
                    // 3차: 특징 기반 매칭 (과일명+용도+중량+꼬마여부)
                    const featurePrice = matchItemToPricing(item.name, priceMap);
                    if (featurePrice !== undefined) {
                        return { ...item, price: featurePrice, subtotal: featurePrice * (item.qty || 0) };
                    }
                    // 미매칭 시 원본 유지
                    return item;
                });
            }

            const updatedAmount = updatedItems.length > 0
                ? updatedItems.reduce((sum, item) => sum + ((item.price || 0) * (item.qty || 0)), 0)
                : Number(row.amount);

            // 디버깅 로그: 모든 정산에 대해 pricing 매칭 상태 출력
            const origAmount = items.reduce((sum, i) => sum + ((i.price || 0) * (i.qty || 0)), 0);
            console.log(`[정산] ${settlementDate} ${row.partner} | DB금액=${origAmount} → 적용금액=${updatedAmount} | priceMap=${JSON.stringify(priceMap)} | items=${JSON.stringify(items.map(i => i.name))}`);

            return {
                id: row.id, date: row.date, partner: row.partner,
                amount: updatedAmount, items: updatedItems, fromPricing: row.from_pricing,
                isPaid: row.is_paid || false, paidAt: row.paid_at
            };
        });
        res.json(data);
    } catch (err) {
        console.error('[정산 조회 오류]', err.message, err.stack);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/settlements', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { date, partner, amount, items, fromPricing } = req.body;
        const result = await pool.query(
            'INSERT INTO settlements (date, partner, amount, items, from_pricing) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [date, partner, amount || 0, JSON.stringify(items || []), fromPricing || false]
        );
        const row = result.rows[0];
        res.json({
            id: row.id, date: row.date, partner: row.partner,
            amount: Number(row.amount), items: row.items, fromPricing: row.from_pricing
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 디버깅: 특정 날짜/거래처의 pricing 매칭 상태 확인
app.get('/api/settlements/debug-pricing', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { date, partner } = req.query;
        if (!date) return res.status(400).json({ error: 'date 파라미터 필요 (예: 2026-03-24)' });

        // 1. 해당 날짜의 정산 데이터
        let settQuery = 'SELECT id, date, partner, amount, items FROM settlements WHERE date = $1::date';
        const params = [date];
        if (partner) { settQuery += ' AND partner = $2'; params.push(partner); }
        const settlements = await pool.query(settQuery, params);

        // 2. 해당 날짜에 매칭되는 pricing
        let pricQuery = 'SELECT id, partner, start_date, end_date, items FROM pricing WHERE start_date <= $1::date AND end_date >= $1::date';
        const pricParams = [date];
        if (partner) { pricQuery += ' AND partner = $2'; pricParams.push(partner); }
        const pricings = await pool.query(pricQuery, pricParams);

        // 3. fallback pricing (기간 매칭 없을 때)
        let fallbackQuery = `SELECT id, partner, start_date, end_date, items FROM pricing
            WHERE end_date < $1::date ${partner ? 'AND partner = $2' : ''}
            ORDER BY end_date DESC LIMIT 3`;
        const fallbacks = await pool.query(fallbackQuery, partner ? [date, partner] : [date]);

        // 4. product_mappings
        let mapQuery = 'SELECT * FROM product_mappings';
        if (partner) { mapQuery += ' WHERE partner = $1'; }
        const mappings = await pool.query(mapQuery, partner ? [partner] : []);

        res.json({
            query: { date, partner },
            settlements: settlements.rows.map(r => ({
                id: r.id, date: normDateSafe(r.date), partner: r.partner,
                dbAmount: Number(r.amount),
                items: r.items
            })),
            matchedPricings: pricings.rows.map(r => ({
                id: r.id, partner: r.partner,
                startDate: normDateSafe(r.start_date), endDate: normDateSafe(r.end_date),
                items: r.items
            })),
            fallbackPricings: fallbacks.rows.map(r => ({
                id: r.id, partner: r.partner,
                startDate: normDateSafe(r.start_date), endDate: normDateSafe(r.end_date),
                items: r.items
            })),
            productMappings: mappings.rows
        });
    } catch (err) {
        res.status(500).json({ error: err.message, stack: err.stack });
    }
});

app.delete('/api/settlements/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        await pool.query('DELETE FROM settlements WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/settlements/:id/toggle-paid', authMiddleware, adminOnly, async (req, res) => {
    try {
        const result = await pool.query(
            'UPDATE settlements SET is_paid = NOT COALESCE(is_paid, false), paid_at = CASE WHEN COALESCE(is_paid, false) = false THEN NOW() ELSE NULL END WHERE id = $1 RETURNING *',
            [req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: '정산 데이터를 찾을 수 없습니다' });
        const row = result.rows[0];
        res.json({ id: row.id, isPaid: row.is_paid, paidAt: row.paid_at });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 정산 항목 수정 API
app.put('/api/settlements/:id/items', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { items, amount } = req.body;
        const result = await pool.query(
            'UPDATE settlements SET items = $1, amount = $2 WHERE id = $3 RETURNING *',
            [JSON.stringify(items), amount, req.params.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: '정산 데이터를 찾을 수 없습니다' });
        const row = result.rows[0];
        res.json({ id: row.id, date: row.date, partner: row.partner, amount: row.amount, items: row.items, isPaid: row.is_paid });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// CJ택배 일별 결제완료 API
app.get('/api/cj-daily-payments', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { month } = req.query;
        let result;
        if (month) {
            result = await pool.query(
                "SELECT * FROM cj_daily_payments WHERE TO_CHAR(date, 'YYYY-MM') = $1 ORDER BY date",
                [month]
            );
        } else {
            result = await pool.query('SELECT * FROM cj_daily_payments ORDER BY date');
        }
        res.json(result.rows.map(r => ({
            id: r.id, date: r.date, amount: Number(r.amount), isPaid: r.is_paid || false, paidAt: r.paid_at
        })));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/cj-daily-payments/toggle-paid', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { date, amount } = req.body;
        if (!date) return res.status(400).json({ error: '날짜를 지정해주세요' });
        // UPSERT: 없으면 생성, 있으면 토글
        const existing = await pool.query('SELECT * FROM cj_daily_payments WHERE date = $1', [date]);
        let result;
        if (existing.rows.length === 0) {
            result = await pool.query(
                'INSERT INTO cj_daily_payments (date, amount, is_paid, paid_at) VALUES ($1, $2, true, NOW()) RETURNING *',
                [date, amount || 0]
            );
        } else {
            result = await pool.query(
                'UPDATE cj_daily_payments SET is_paid = NOT is_paid, paid_at = CASE WHEN is_paid = false THEN NOW() ELSE NULL END, amount = $2 WHERE date = $1 RETURNING *',
                [date, amount || existing.rows[0].amount]
            );
        }
        const r = result.rows[0];
        res.json({ id: r.id, date: r.date, amount: Number(r.amount), isPaid: r.is_paid, paidAt: r.paid_at });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// 전체 미정산 합계 API (모든 월의 미결제 금액 합산)
app.get('/api/settlements/total-unpaid', authMiddleware, adminOnly, async (req, res) => {
    try {
        // JSONB 안전 파싱 헬퍼
        function safeItems(val) {
            if (!val) return [];
            if (typeof val === 'string') { try { return JSON.parse(val); } catch { return []; } }
            return Array.isArray(val) ? val : [];
        }

        // 대성/효돈 미결제 합계 (pricing 동적 적용 - GET /api/settlements과 동일 방식)
        const partnerResult = await pool.query(`
            SELECT s.*,
                (SELECT jsonb_agg(p.items ORDER BY p.id ASC) FROM pricing p
                 WHERE p.partner = s.partner AND p.start_date <= s.date AND p.end_date >= s.date) as pricing_items
            FROM settlements s
            WHERE COALESCE(s.is_paid, false) = false
            ORDER BY s.id
        `);

        // product_mappings 조회 (품목명 매칭 fallback용)
        const mappingsResult = await pool.query('SELECT * FROM product_mappings ORDER BY id');
        const mappingsByPartner = {};
        mappingsResult.rows.forEach(m => {
            if (!mappingsByPartner[m.partner]) mappingsByPartner[m.partner] = {};
            mappingsByPartner[m.partner][m.sales_name] = m.pricing_name;
        });

        let daesung = 0, hyodon = 0, aewol = 0;
        partnerResult.rows.forEach(row => {
            const items = safeItems(row.items);
            const rawPricingItems = safeItems(row.pricing_items);

            // pricing 단가 맵 생성 (최신 id가 나중에 적용되어 우선)
            const priceMap = {};
            rawPricingItems.forEach(pItems => {
                const pArr = safeItems(pItems);
                pArr.forEach(item => {
                    if (item && item.name) priceMap[item.name] = Number(item.price) || 0;
                });
            });

            const partnerMappings = mappingsByPartner[row.partner] || {};

            // items의 단가를 pricing 단가로 적용하여 금액 계산
            let amount;
            if (Object.keys(priceMap).length > 0 && items.length > 0) {
                amount = items.reduce((sum, item) => {
                    if (!item || !item.name) return sum + ((item && item.price || 0) * (item && item.qty || 0));
                    // 1차: 정확한 이름 매칭
                    if (priceMap[item.name] !== undefined) {
                        return sum + priceMap[item.name] * (item.qty || 0);
                    }
                    // 2차: product_mappings 기반 매칭
                    const mappedName = partnerMappings[item.name];
                    if (mappedName && priceMap[mappedName] !== undefined) {
                        return sum + priceMap[mappedName] * (item.qty || 0);
                    }
                    // 3차: 특징 기반 매칭 (과일명+용도+중량+꼬마여부)
                    const featurePrice = matchItemToPricing(item.name, priceMap);
                    if (featurePrice !== undefined) {
                        return sum + featurePrice * (item.qty || 0);
                    }
                    // 미매칭 시 원본 가격 사용
                    return sum + ((item.price || 0) * (item.qty || 0));
                }, 0);
            } else {
                amount = items.length > 0
                    ? items.reduce((sum, item) => sum + ((item.price || 0) * (item.qty || 0)), 0)
                    : Number(row.amount);
            }

            if (row.partner === '대성(시온)') daesung += amount;
            else if (row.partner === '효돈농협') hyodon += amount;
            else if (row.partner === '애월취나물') aewol += amount;
        });

        // CJ택배: 미결제 날짜의 박스수 합산 × 3100 + 모든 이월금액
        const cjBoxResult = await pool.query(`
            SELECT s.date, SUM(
                COALESCE((SELECT SUM((item->>'qty')::int) FROM jsonb_array_elements(
                    CASE WHEN jsonb_typeof(s.items) = 'array' THEN s.items ELSE '[]'::jsonb END
                ) item), 0)
            ) as box_count
            FROM settlements s
            WHERE (s.partner = '대성(시온)' OR s.partner = '효돈농협' OR s.partner = '애월취나물')
            GROUP BY s.date
        `);
        // CJ 일별 결제완료 상태 전체 조회
        const cjPaidResult = await pool.query(`SELECT date, is_paid FROM cj_daily_payments WHERE is_paid = true`);
        const cjPaidDates = new Set(cjPaidResult.rows.map(r => {
            const d = new Date(r.date);
            return d.toISOString().split('T')[0];
        }));
        let cjTotal = 0;
        cjBoxResult.rows.forEach(r => {
            const dateStr = new Date(r.date).toISOString().split('T')[0];
            if (!cjPaidDates.has(dateStr)) {
                cjTotal += Number(r.box_count) * 3100;
            }
        });

        // CJ 이월금액 합산 (모든 월)
        const carryoverResult = await pool.query(`SELECT COALESCE(SUM(amount), 0) as total FROM cj_carryover`);
        cjTotal += Number(carryoverResult.rows[0].total);

        // 선결제 잔액 차감
        const prepayResult = await pool.query(`
            SELECT partner, COALESCE(SUM(amount), 0) as total
            FROM prepayments
            GROUP BY partner
        `);
        let daesungPrepay = 0, hyodonPrepay = 0, aewolPrepay = 0;
        prepayResult.rows.forEach(r => {
            if (r.partner === '대성(시온)') daesungPrepay = Number(r.total);
            else if (r.partner === '효돈농협') hyodonPrepay = Number(r.total);
            else if (r.partner === '애월취나물') aewolPrepay = Number(r.total);
        });

        const daesungNet = daesung - daesungPrepay;
        const hyodonNet = hyodon - hyodonPrepay;
        const aewolNet = aewol - aewolPrepay;
        const total = daesungNet + hyodonNet + aewolNet + cjTotal;

        res.json({ daesung: daesungNet, hyodon: hyodonNet, aewol: aewolNet, cj: cjTotal, total });
    } catch (err) {
        console.error('전체 미정산 합계 오류:', err);
        res.status(500).json({ error: err.message });
    }
});

// CJ 자동계산: 해당 날짜 대성+효돈 박스수 합산

app.get('/api/settlements/box-count', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { date } = req.query;
        if (!date) return res.status(400).json({ error: '날짜를 지정해주세요' });

        const result = await pool.query(
            "SELECT partner, items FROM settlements WHERE date = $1 AND partner IN ('대성(시온)', '효돈농협', '애월취나물')",
            [date]
        );

        let daesung = 0, hyodon = 0, aewol = 0;
        result.rows.forEach(row => {
            const items = row.items || [];
            const qty = items.reduce((sum, item) => sum + (item.qty || 0), 0);
            if (row.partner === '대성(시온)') daesung += qty;
            else if (row.partner === '효돈농협') hyodon += qty;
            else if (row.partner === '애월취나물') aewol += qty;
        });

        res.json({ totalBoxes: daesung + hyodon + aewol, daesung, hyodon, aewol });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === Prepayments API (선결제) ===

app.get('/api/prepayments', authMiddleware, async (req, res) => {
    try {
        const { partner } = req.query;
        let result;
        if (partner) {
            result = await pool.query('SELECT * FROM prepayments WHERE partner = $1 ORDER BY date DESC, id DESC', [partner]);
        } else {
            result = await pool.query('SELECT * FROM prepayments ORDER BY date DESC, id DESC');
        }
        res.json(result.rows.map(r => ({
            id: r.id, partner: r.partner, amount: Number(r.amount),
            date: r.date, note: r.note
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/prepayments', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { partner, amount, date, note } = req.body;
        if (!partner || !amount || !date) return res.status(400).json({ error: '거래처, 금액, 날짜는 필수입니다' });

        const result = await pool.query(
            'INSERT INTO prepayments (partner, amount, date, note) VALUES ($1, $2, $3, $4) RETURNING *',
            [partner, amount, date, note || '']
        );
        const r = result.rows[0];
        res.json({ id: r.id, partner: r.partner, amount: Number(r.amount), date: r.date, note: r.note });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/prepayments/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        await pool.query('DELETE FROM prepayments WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/prepayments/balance', authMiddleware, async (req, res) => {
    try {
        // 거래처별 선결제 합계
        const prepayResult = await pool.query(
            "SELECT partner, COALESCE(SUM(amount), 0) as total FROM prepayments WHERE partner IN ('대성(시온)', '효돈농협', '애월취나물') GROUP BY partner"
        );
        // 거래처별 정산 합계 (실제 정산만 - 품목별 금액 세팅 제외)
        const settleResult = await pool.query(
            "SELECT partner, COALESCE(SUM(amount), 0) as total FROM settlements WHERE partner IN ('대성(시온)', '효돈농협', '애월취나물') AND (from_pricing IS NULL OR from_pricing = false) GROUP BY partner"
        );

        const prepayMap = {};
        prepayResult.rows.forEach(r => { prepayMap[r.partner] = Number(r.total); });
        const settleMap = {};
        settleResult.rows.forEach(r => { settleMap[r.partner] = Number(r.total); });

        const partners = ['대성(시온)', '효돈농협', '애월취나물'];
        const balances = partners.map(p => ({
            partner: p,
            prepaidTotal: prepayMap[p] || 0,
            settledTotal: settleMap[p] || 0,
            balance: Math.max(0, (prepayMap[p] || 0) - (settleMap[p] || 0))
        }));

        res.json(balances);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === Product Mappings API (품목 매칭 기억) ===

app.get('/api/product-mappings', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { partner } = req.query;
        let result;
        if (partner) {
            result = await pool.query('SELECT * FROM product_mappings WHERE partner = $1 ORDER BY id', [partner]);
        } else {
            result = await pool.query('SELECT * FROM product_mappings ORDER BY id');
        }
        res.json(result.rows.map(r => ({
            id: r.id, sales_name: r.sales_name, pricing_name: r.pricing_name, partner: r.partner
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/product-mappings', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { salesName, pricingName, partner } = req.body;
        if (!salesName || !pricingName || !partner) return res.status(400).json({ error: '필수 항목을 입력해주세요' });

        const result = await pool.query(
            `INSERT INTO product_mappings (sales_name, pricing_name, partner) VALUES ($1, $2, $3)
             ON CONFLICT (sales_name, partner) DO UPDATE SET pricing_name = $2
             RETURNING *`,
            [salesName, pricingName, partner]
        );
        const r = result.rows[0];
        res.json({ id: r.id, sales_name: r.sales_name, pricing_name: r.pricing_name, partner: r.partner });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/product-mappings/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        await pool.query('DELETE FROM product_mappings WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === Settlement Completions API (주간 정산 완료) ===

app.get('/api/settlement-completions', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { month } = req.query;
        let result;
        if (month) {
            // 해당 월에 걸치는 주차들 조회
            const startOfMonth = month + '-01';
            const endOfMonth = month + '-31';
            result = await pool.query(
                "SELECT sc.*, u.name as completed_by_name FROM settlement_completions sc LEFT JOIN users u ON sc.completed_by = u.id WHERE sc.week_start <= $2 AND sc.week_end >= $1 ORDER BY sc.week_start, sc.partner",
                [startOfMonth, endOfMonth]
            );
        } else {
            result = await pool.query(
                'SELECT sc.*, u.name as completed_by_name FROM settlement_completions sc LEFT JOIN users u ON sc.completed_by = u.id ORDER BY sc.week_start DESC, sc.partner'
            );
        }
        res.json(result.rows.map(r => ({
            id: r.id, partner: r.partner, weekStart: r.week_start, weekEnd: r.week_end,
            totalAmount: Number(r.total_amount), completedBy: r.completed_by,
            completedByName: r.completed_by_name, completedAt: r.completed_at
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/settlement-completions', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { partner, weekStart, weekEnd, totalAmount } = req.body;
        if (!partner || !weekStart || !weekEnd) return res.status(400).json({ error: '필수 항목을 입력해주세요' });

        const result = await pool.query(
            `INSERT INTO settlement_completions (partner, week_start, week_end, total_amount, completed_by)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (partner, week_start) DO UPDATE SET total_amount = $4, completed_by = $5, completed_at = NOW()
             RETURNING *`,
            [partner, weekStart, weekEnd, totalAmount || 0, req.user.id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/settlement-completions/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        await pool.query('DELETE FROM settlement_completions WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === Pricing API (인증 추가) ===

// 날짜를 YYYY-MM-DD로 안전하게 변환 (timezone 영향 없이)
function normDateSafe(d) {
    if (!d) return null;
    if (typeof d === 'string') return d.slice(0, 10);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

// 품목명에서 과일명/용도/중량 특징 추출 (프론트엔드 extractFeatures와 동일)
function extractFeatures(text) {
    const t = (text || '');
    let growType = '';
    if (/노지/.test(t)) growType = '노지';
    else if (/하우스/.test(t)) growType = '하우스';
    else if (/비가림/.test(t)) growType = '비가림';
    else if (/블러드/.test(t)) growType = '블러드';

    let fruit = null;
    if (/3종세트/.test(t)) fruit = '3종세트';
    else if (/블러드오렌지|블러드/.test(t)) fruit = '블러드오렌지';
    else if (/비가림|감귤/.test(t)) fruit = '비가림귤';
    else if (/수라향/.test(t)) fruit = '수라향';
    else if (/자몽/.test(t)) fruit = '자몽';
    else if (/천혜향/.test(t)) fruit = '천혜향';
    else if (/레드향/.test(t)) fruit = '레드향';
    else if (/한라봉/.test(t)) fruit = '한라봉';
    else if (/레몬/.test(t)) fruit = '레몬';
    else if (/카라향/.test(t)) fruit = '카라향';
    else if (/하귤/.test(t)) fruit = '하귤';

    let grade = null;
    if (/프리미엄\s*로얄/.test(t)) grade = '선물용';
    else if (/로얄과/.test(t)) grade = '로얄과';
    else if (/소과/.test(t)) grade = '소과';
    else if (/중대과/.test(t)) grade = '중대과';
    else if (/못난이/.test(t)) grade = '못난이';
    else if (/선물용/.test(t)) grade = '선물용';
    else if (/프리미엄/.test(t)) grade = '선물용';
    else if (/가정용/.test(t)) grade = '가정용';

    let size = '';
    if (/꼬마/.test(t)) size = '꼬마';

    let weight = null;
    const wMatch = t.match(/(\d+)\s*kg/i);
    if (wMatch) weight = wMatch[1] + 'kg';

    return { fruit, grade, weight, growType, size };
}

// pricing 단가맵에서 특징 기반 매칭 (서버용 - 프론트엔드 matchSalesToPricing과 동일 로직)
function matchItemToPricing(itemName, priceMap) {
    const sf = extractFeatures(itemName);
    if (!sf.fruit) return undefined;

    let bestMatch = null, bestScore = 0;
    for (const [pricingName, price] of Object.entries(priceMap)) {
        const pf = extractFeatures(pricingName);
        if (!pf.fruit || sf.fruit !== pf.fruit) continue;

        let score = 1, mismatch = false;
        if (sf.size !== pf.size) mismatch = true;
        if (sf.size && pf.size && sf.size === pf.size) score += 3;
        if (sf.growType || pf.growType) {
            if (sf.growType === pf.growType) score += 3;
            else mismatch = true;
        }
        if (sf.weight && pf.weight) {
            if (sf.weight === pf.weight) score += 2;
            else mismatch = true;
        }
        if (sf.grade && pf.grade) {
            if (sf.grade === pf.grade) score += 2;
            else mismatch = true;
        }
        if (mismatch) continue;
        if (score > bestScore) { bestScore = score; bestMatch = { name: pricingName, price }; }
    }
    return bestMatch ? bestMatch.price : undefined;
}

app.get('/api/pricing', authMiddleware, adminOnly, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM pricing ORDER BY start_date DESC, id DESC');
        const data = result.rows.map(row => ({
            id: row.id, startDate: normDateSafe(row.start_date), endDate: normDateSafe(row.end_date),
            partner: row.partner, items: row.items
        }));
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 특정 날짜에 해당하는 품목별 금액 조회 (SQL에서 직접 필터링)
app.get('/api/pricing/for-date', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { partner, date } = req.query;
        if (!partner || !date) return res.status(400).json({ error: 'partner와 date 파라미터가 필요합니다' });

        // 정산 날짜가 기간에 포함되는 pricing만 조회 (fallback 없음: 정확한 날짜 범위만 적용)
        const result = await pool.query(
            'SELECT * FROM pricing WHERE partner = $1 AND start_date <= $2::date AND end_date >= $2::date ORDER BY id ASC',
            [partner, date]
        );

        const data = result.rows.map(row => ({
            id: row.id, startDate: normDateSafe(row.start_date), endDate: normDateSafe(row.end_date),
            partner: row.partner, items: row.items
        }));
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/pricing', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { startDate, endDate, partner, items } = req.body;
        const result = await pool.query(
            'INSERT INTO pricing (start_date, end_date, partner, items) VALUES ($1, $2, $3, $4) RETURNING *',
            [startDate, endDate, partner, JSON.stringify(items || [])]
        );
        const row = result.rows[0];

        res.json({
            id: row.id, startDate: normDateSafe(row.start_date), endDate: normDateSafe(row.end_date),
            partner: row.partner, items: row.items
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/pricing/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        await pool.query('DELETE FROM pricing WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === Lunch Menu API ===

app.get('/api/lunch/menus', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM lunch_menus ORDER BY category, name');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/lunch/menus', authMiddleware, async (req, res) => {
    try {
        const { name, category } = req.body;
        if (!name) return res.status(400).json({ error: '식당 이름은 필수입니다' });
        const actualCategory = category || '기타';
        const result = await pool.query('INSERT INTO lunch_menus (name, category) VALUES ($1, $2) RETURNING *', [name, actualCategory]);
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/lunch/menus/:id', authMiddleware, async (req, res) => {
    try {
        await pool.query('DELETE FROM lunch_menus WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/lunch/today', authMiddleware, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const restaurants = await pool.query('SELECT id, name FROM lunch_menus ORDER BY name');
        const session = await pool.query('SELECT * FROM lunch_sessions WHERE date = $1', [today]);

        if (session.rows.length === 0) {
            return res.json({ restaurants: restaurants.rows, session: null, votes: [], myVote: null });
        }

        const s = session.rows[0];
        const votes = await pool.query(
            'SELECT v.menu_name, v.user_id, u.name as user_name, u.color as user_color FROM lunch_votes v JOIN users u ON v.user_id = u.id WHERE v.session_id = $1',
            [s.id]
        );
        const myVote = votes.rows.find(v => v.user_id === req.user.id);
        res.json({ restaurants: restaurants.rows, session: { id: s.id, date: s.date }, votes: votes.rows, myVote: myVote ? myVote.menu_name : null });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/lunch/recommend', authMiddleware, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const existing = await pool.query('SELECT * FROM lunch_sessions WHERE date = $1', [today]);
        if (existing.rows.length > 0) {
            const s = existing.rows[0];
            const votes = await pool.query(
                'SELECT v.menu_name, v.user_id, u.name as user_name, u.color as user_color FROM lunch_votes v JOIN users u ON v.user_id = u.id WHERE v.session_id = $1',
                [s.id]
            );
            const myVote = votes.rows.find(v => v.user_id === req.user.id);
            return res.json({ session: { id: s.id, date: s.date, menus: s.menus }, votes: votes.rows, myVote: myVote ? myVote.menu_name : null, isNew: false });
        }

        const allMenus = await pool.query('SELECT name, category FROM lunch_menus ORDER BY RANDOM() LIMIT 6');
        if (allMenus.rows.length === 0) return res.status(400).json({ error: '등록된 메뉴가 없습니다' });

        const menus = allMenus.rows.map(m => ({ name: m.name, category: m.category }));
        const result = await pool.query(
            'INSERT INTO lunch_sessions (date, menus) VALUES ($1, $2) RETURNING *',
            [today, JSON.stringify(menus)]
        );
        const s = result.rows[0];
        res.json({ session: { id: s.id, date: s.date, menus: s.menus }, votes: [], myVote: null, isNew: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/lunch/vote', authMiddleware, async (req, res) => {
    try {
        const { menuName } = req.body;
        if (!menuName) return res.status(400).json({ error: '식당명은 필수입니다' });

        const today = new Date().toISOString().split('T')[0];
        let session = await pool.query('SELECT * FROM lunch_sessions WHERE date = $1', [today]);
        if (session.rows.length === 0) {
            try {
                session = await pool.query("INSERT INTO lunch_sessions (date, menus) VALUES ($1, '[]'::jsonb) RETURNING *", [today]);
            } catch (e) {
                session = await pool.query('SELECT * FROM lunch_sessions WHERE date = $1', [today]);
            }
        }
        const sessionId = session.rows[0].id;

        await pool.query(
            `INSERT INTO lunch_votes (session_id, user_id, menu_name) VALUES ($1, $2, $3)
             ON CONFLICT (session_id, user_id) DO UPDATE SET menu_name = $3, created_at = NOW()`,
            [sessionId, req.user.id, menuName]
        );

        const votes = await pool.query(
            'SELECT v.menu_name, v.user_id, u.name as user_name, u.color as user_color FROM lunch_votes v JOIN users u ON v.user_id = u.id WHERE v.session_id = $1',
            [sessionId]
        );
        const myVote = votes.rows.find(v => v.user_id === req.user.id);
        res.json({ votes: votes.rows, myVote: myVote ? myVote.menu_name : null });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 점심 투표 초기화
app.delete('/api/lunch/today', authMiddleware, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const session = await pool.query('SELECT id FROM lunch_sessions WHERE date = $1', [today]);
        if (session.rows.length > 0) {
            await pool.query('DELETE FROM lunch_votes WHERE session_id = $1', [session.rows[0].id]);
            await pool.query('DELETE FROM lunch_sessions WHERE id = $1', [session.rows[0].id]);
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === CS Categories API ===
app.get('/api/cs-categories', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM cs_categories ORDER BY sort_order, id');
        res.json(result.rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/cs-categories', authMiddleware, async (req, res) => {
    try {
        const { name, color } = req.body;
        if (!name) return res.status(400).json({ error: '카테고리 이름을 입력해주세요' });
        const maxOrder = await pool.query('SELECT COALESCE(MAX(sort_order), 0) + 1 as next FROM cs_categories');
        const result = await pool.query(
            'INSERT INTO cs_categories (name, color, sort_order) VALUES ($1, $2, $3) RETURNING *',
            [name.trim(), color || '#9E9E9E', maxOrder.rows[0].next]
        );
        res.json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ error: '이미 존재하는 카테고리입니다' });
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/cs-categories/:id', authMiddleware, async (req, res) => {
    try {
        const { name, color } = req.body;
        if (!name) return res.status(400).json({ error: '카테고리 이름을 입력해주세요' });
        // 기존 이름 조회 (템플릿 카테고리명 업데이트용)
        const old = await pool.query('SELECT name FROM cs_categories WHERE id = $1', [req.params.id]);
        if (old.rows.length === 0) return res.status(404).json({ error: '카테고리를 찾을 수 없습니다' });
        const oldName = old.rows[0].name;
        const result = await pool.query(
            'UPDATE cs_categories SET name = $1, color = $2 WHERE id = $3 RETURNING *',
            [name.trim(), color || '#9E9E9E', req.params.id]
        );
        // 관련 템플릿의 카테고리명도 업데이트
        if (oldName !== name.trim()) {
            await pool.query('UPDATE cs_templates SET category = $1 WHERE category = $2', [name.trim(), oldName]);
        }
        res.json(result.rows[0]);
    } catch (err) {
        if (err.code === '23505') return res.status(400).json({ error: '이미 존재하는 카테고리입니다' });
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/cs-categories/:id', authMiddleware, async (req, res) => {
    try {
        const cat = await pool.query('SELECT name FROM cs_categories WHERE id = $1', [req.params.id]);
        if (cat.rows.length === 0) return res.status(404).json({ error: '카테고리를 찾을 수 없습니다' });
        // 해당 카테고리의 템플릿을 "미분류"로 이동
        await pool.query('UPDATE cs_templates SET category = $1 WHERE category = $2', ['미분류', cat.rows[0].name]);
        await pool.query('DELETE FROM cs_categories WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// === CS Templates API ===
app.get('/api/cs-templates', authMiddleware, async (req, res) => {
    try {
        const { category } = req.query;
        let result;
        if (category) {
            result = await pool.query('SELECT * FROM cs_templates WHERE category = $1 ORDER BY sort_order, id', [category]);
        } else {
            result = await pool.query('SELECT * FROM cs_templates ORDER BY category, sort_order, id');
        }
        res.json(result.rows.map(r => ({ ...r, createdBy: r.created_by, createdAt: r.created_at, sortOrder: r.sort_order })));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/cs-templates', authMiddleware, async (req, res) => {
    try {
        const { category, title, content, sortOrder } = req.body;
        const result = await pool.query(
            'INSERT INTO cs_templates (category, title, content, sort_order, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [category, title, content, sortOrder || 0, req.user.id]
        );
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/cs-templates/:id', authMiddleware, async (req, res) => {
    try {
        const { category, title, content } = req.body;
        const result = await pool.query(
            'UPDATE cs_templates SET category = $1, title = $2, content = $3 WHERE id = $4 RETURNING *',
            [category, title, content, req.params.id]
        );
        res.json(result.rows[0]);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/cs-templates/:id', authMiddleware, async (req, res) => {
    try {
        await pool.query('DELETE FROM cs_templates WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// === AI Workspace API ===

const AI_SYSTEM_PROMPTS = {
    marketing: '당신은 제주아꼼이네 농업회사법인의 마케팅 도우미입니다. 온라인 판매 홍보문구, 톡톡 이미지 문구, 숏클립 문구, SNS 게시글 등을 작성해줍니다. 제주 감귤, 천혜향, 레드향, 한라봉 등 제주 과일 판매 업체입니다. 친근하고 따뜻한 톤으로 작성해주세요.',
    qna: '당신은 친절하고 똑똑한 AI 어시스턴트입니다. 사용자가 궁금한 것을 무엇이든 물어보면 정확하고 이해하기 쉽게 답변해줍니다. 일상적인 질문, 업무 관련 질문, 상식, 아이디어 등 다양한 주제에 대해 도움을 줍니다.',
    document: '당신은 문서 작성 전문 도우미입니다. 보고서, 공문, 안내문, 이메일, 회의록, 기획서 등 다양한 업무 문서를 작성하거나 수정하는 것을 도와줍니다. 명확하고 깔끔한 문체로 작성하며, 사용자의 요청에 맞는 적절한 형식과 톤을 사용합니다.',
    cs: '당신은 제주아꼼이네 농업회사법인의 CS(고객상담) 답변 도우미입니다. 고객 문의, 클레임, 교환/반품, 배송 관련 답변을 작성해줍니다. 정중하고 공감하는 톤으로, 고객이 만족할 수 있도록 답변합니다. 제주 감귤, 천혜향, 레드향, 한라봉 등 제주 과일을 판매하는 업체입니다.',
    general: '당신은 다재다능한 AI 어시스턴트입니다. 대화, 질문 답변, 아이디어 브레인스토밍, 번역, 요약, 분석 등 다양한 작업을 도와줍니다. 사용자의 요청에 맞게 유연하게 대응하며, 친절하고 유용한 답변을 제공합니다.'
};
const AI_SYSTEM_PROMPT = AI_SYSTEM_PROMPTS.marketing; // 기본값 (하위 호환)

app.get('/api/ai/conversations', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT c.id, c.title, c.category, c.user_id, c.created_at, u.name as user_name FROM ai_conversations c JOIN users u ON c.user_id = u.id ORDER BY c.created_at DESC'
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/ai/conversations/:id', authMiddleware, async (req, res) => {
    try {
        const conv = await pool.query(
            'SELECT c.*, u.name as user_name FROM ai_conversations c JOIN users u ON c.user_id = u.id WHERE c.id = $1',
            [req.params.id]
        );
        if (conv.rows.length === 0) return res.status(404).json({ error: '대화를 찾을 수 없습니다' });

        const messages = await pool.query(
            "SELECT m.id, m.role, m.content, m.message_type, m.created_at, CASE WHEN m.role = 'user' THEN COALESCE(u.name, cu.name) ELSE 'AI' END as sender_name FROM ai_messages m LEFT JOIN users u ON m.sender_user_id = u.id LEFT JOIN users cu ON cu.id = (SELECT user_id FROM ai_conversations WHERE id = m.conversation_id) WHERE m.conversation_id = $1 ORDER BY m.created_at ASC",
            [req.params.id]
        );
        res.json({ conversation: conv.rows[0], messages: messages.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/ai/conversations', authMiddleware, async (req, res) => {
    try {
        const { title, category } = req.body || {};
        const validCategory = AI_SYSTEM_PROMPTS[category] ? category : 'marketing';
        const result = await pool.query(
            'INSERT INTO ai_conversations (user_id, title, category) VALUES ($1, $2, $3) RETURNING *',
            [req.user.id, title || '새 대화', validCategory]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/ai/conversations/:id', authMiddleware, async (req, res) => {
    try {
        const conv = await pool.query('SELECT user_id FROM ai_conversations WHERE id = $1', [req.params.id]);
        if (conv.rows.length === 0) return res.status(404).json({ error: '대화를 찾을 수 없습니다' });
        if (conv.rows[0].user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: '삭제 권한이 없습니다' });
        }
        await pool.query('DELETE FROM ai_conversations WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 대화방 이름 수정
app.put('/api/ai/conversations/:id/title', authMiddleware, async (req, res) => {
    try {
        const { title } = req.body;
        if (!title || !title.trim()) return res.status(400).json({ error: '이름을 입력해주세요' });
        const conv = await pool.query('SELECT user_id FROM ai_conversations WHERE id = $1', [req.params.id]);
        if (conv.rows.length === 0) return res.status(404).json({ error: '대화를 찾을 수 없습니다' });
        if (conv.rows[0].user_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: '수정 권한이 없습니다' });
        }
        await pool.query('UPDATE ai_conversations SET title = $1 WHERE id = $2', [title.trim(), req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/ai/chat', authMiddleware, async (req, res) => {
    try {
        const { conversationId, message, image, imageMimeType } = req.body;
        if (!conversationId) return res.status(400).json({ error: '대화 ID는 필수입니다' });
        if (!message && !image) return res.status(400).json({ error: '메시지 또는 이미지는 필수입니다' });

        const userMessage = message || '이 이미지를 분석해주세요';

        // 대화 존재 확인
        const conv = await pool.query(
            'SELECT * FROM ai_conversations WHERE id = $1',
            [conversationId]
        );
        if (conv.rows.length === 0) return res.status(404).json({ error: '대화를 찾을 수 없습니다' });

        // 사용자 메시지 저장
        await pool.query(
            "INSERT INTO ai_messages (conversation_id, role, content, message_type, sender_user_id) VALUES ($1, $2, $3, 'text', $4)",
            [conversationId, 'user', image ? `📎 ${userMessage}` : userMessage, req.user.id]
        );

        let assistantContent;

        if (image) {
            // 이미지 포함 → Gemini API 사용
            if (!process.env.GEMINI_API_KEY) {
                return res.status(500).json({ error: 'GEMINI_API_KEY가 설정되지 않았습니다' });
            }

            const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
            const response = await genai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: [{
                    role: 'user',
                    parts: [
                        { inlineData: { mimeType: imageMimeType || 'image/jpeg', data: image } },
                        { text: userMessage }
                    ]
                }]
            });

            // Gemini 응답에서 텍스트 추출
            if (response.candidates && response.candidates[0] && response.candidates[0].content) {
                const parts = response.candidates[0].content.parts || [];
                assistantContent = parts.filter(p => p.text).map(p => p.text).join('\n') || 'AI가 응답을 생성하지 못했습니다.';
            } else {
                assistantContent = 'AI가 응답을 생성하지 못했습니다.';
            }
        } else {
            // 텍스트만 → 기존 Claude API 사용
            if (!process.env.ANTHROPIC_API_KEY) {
                return res.status(500).json({ error: 'ANTHROPIC_API_KEY가 설정되지 않았습니다' });
            }

            // 기존 메시지 히스토리 로드 (텍스트만, 기존 NULL 데이터 호환)
            const history = await pool.query(
                "SELECT role, content FROM ai_messages WHERE conversation_id = $1 AND (message_type = 'text' OR message_type IS NULL) ORDER BY created_at ASC",
                [conversationId]
            );

            const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
            const aiResponse = await anthropic.messages.create({
                model: 'claude-sonnet-4-6',
                max_tokens: 2048,
                system: AI_SYSTEM_PROMPTS[conv.rows[0].category] || AI_SYSTEM_PROMPTS.marketing,
                messages: history.rows.map(m => ({ role: m.role, content: m.content }))
            });

            assistantContent = aiResponse.content[0].text;
        }

        // AI 응답 저장
        await pool.query(
            "INSERT INTO ai_messages (conversation_id, role, content, message_type) VALUES ($1, $2, $3, 'text')",
            [conversationId, 'assistant', assistantContent]
        );

        res.json({ reply: assistantContent });
    } catch (err) {
        const errMsg = err?.message || String(err);
        const status = err?.status || err?.statusCode || err?.code;
        console.error('AI 채팅 오류:', { status, message: errMsg, name: err?.name });

        const isNotFound = status === 404 || errMsg.includes('not found') || errMsg.includes('NOT_FOUND');
        const is429 = status === 429 || errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED');
        const isAuth = status === 401 || status === 403 || errMsg.includes('API_KEY') || errMsg.includes('PERMISSION_DENIED');

        if (isNotFound) {
            res.status(500).json({ error: 'AI 모델을 찾을 수 없습니다. 관리자에게 문의해주세요.' });
        } else if (is429) {
            res.status(429).json({ error: 'API 요청 한도 초과입니다. 잠시 후 다시 시도해주세요.' });
        } else if (isAuth) {
            res.status(500).json({ error: 'API 인증 오류입니다. 관리자에게 문의해주세요.' });
        } else {
            res.status(500).json({ error: `AI 응답 생성 오류: ${errMsg.substring(0, 100)}` });
        }
    }
});

// === AI 이미지 생성 (Gemini) ===
app.post('/api/ai/image', authMiddleware, async (req, res) => {
    try {
        const { conversationId, prompt, referenceImage, referenceImageMimeType } = req.body;
        if (!conversationId || !prompt) return res.status(400).json({ error: '대화 ID와 프롬프트는 필수입니다' });

        const conv = await pool.query(
            'SELECT * FROM ai_conversations WHERE id = $1',
            [conversationId]
        );
        if (conv.rows.length === 0) return res.status(404).json({ error: '대화를 찾을 수 없습니다' });

        // 사용자 메시지 저장
        const saveMsg = referenceImage ? `📎🎨 ${prompt}` : prompt;
        await pool.query(
            "INSERT INTO ai_messages (conversation_id, role, content, message_type, sender_user_id) VALUES ($1, 'user', $2, 'text', $3)",
            [conversationId, saveMsg, req.user.id]
        );

        if (!process.env.GEMINI_API_KEY) {
            return res.status(500).json({ error: 'GEMINI_API_KEY가 설정되지 않았습니다' });
        }

        const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

        // Gemini에 보낼 contents 구성
        const parts = [];
        if (referenceImage) {
            parts.push({ inlineData: { mimeType: referenceImageMimeType || 'image/jpeg', data: referenceImage } });
        }
        parts.push({ text: prompt });

        // Gemini 이미지 생성 함수 (재시도 로직 포함)
        const generateImage = async (retryCount = 0) => {
            try {
                return await genai.models.generateContent({
                    model: 'gemini-2.5-flash-image',
                    contents: [{ role: 'user', parts }],
                    config: {
                        responseModalities: ['Text', 'Image']
                    }
                });
            } catch (apiErr) {
                const status = apiErr?.status || apiErr?.statusCode || apiErr?.code;
                const errMsg = apiErr?.message || String(apiErr);
                const is429 = status === 429 || errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED');
                console.error(`이미지 생성 API 오류 (시도 ${retryCount + 1}):`, {
                    status,
                    message: errMsg,
                    name: apiErr?.name,
                    details: apiErr?.errorDetails || apiErr?.details
                });

                if (is429 && retryCount === 0) {
                    console.log('429 quota 초과 - 30초 후 재시도합니다...');
                    await new Promise(resolve => setTimeout(resolve, 30000));
                    return generateImage(1);
                }
                throw apiErr;
            }
        };

        const response = await generateImage();

        // 응답에서 이미지와 텍스트 추출
        let imageUrl = '';
        let revisedPrompt = '';

        if (response.candidates && response.candidates[0] && response.candidates[0].content) {
            const parts = response.candidates[0].content.parts || [];
            for (const part of parts) {
                if (part.inlineData && part.inlineData.data) {
                    const mimeType = part.inlineData.mimeType || 'image/png';
                    imageUrl = `data:${mimeType};base64,${part.inlineData.data}`;
                } else if (part.text) {
                    revisedPrompt = part.text;
                }
            }
        }

        if (!imageUrl) {
            return res.status(500).json({ error: '이미지 생성에 실패했습니다. 다른 프롬프트로 시도해 주세요.' });
        }

        // AI 응답 저장 (이미지 data URL + 텍스트를 JSON으로)
        const imageContent = JSON.stringify({ url: imageUrl, revised_prompt: revisedPrompt });
        await pool.query(
            "INSERT INTO ai_messages (conversation_id, role, content, message_type) VALUES ($1, 'assistant', $2, 'image')",
            [conversationId, imageContent]
        );

        res.json({ imageUrl, revisedPrompt });
    } catch (err) {
        const errMsg = err?.message || String(err);
        const status = err?.status || err?.statusCode || err?.code;
        console.error('이미지 생성 오류:', { status, message: errMsg, name: err?.name, details: err?.errorDetails || err?.details });

        const is429 = status === 429 || errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED');
        const isNotFound = status === 404 || errMsg.includes('not found') || errMsg.includes('NOT_FOUND');
        const isAuth = status === 401 || status === 403 || errMsg.includes('API_KEY') || errMsg.includes('PERMISSION_DENIED');
        const isSafety = errMsg.includes('SAFETY') || errMsg.includes('blocked') || errMsg.includes('safety');

        if (is429) {
            res.status(429).json({ error: 'API 요청 한도 초과입니다. 잠시 후 다시 시도해주세요.' });
        } else if (isNotFound) {
            res.status(500).json({ error: 'AI 모델을 찾을 수 없습니다. 관리자에게 문의해주세요.' });
        } else if (isAuth) {
            res.status(500).json({ error: 'API 인증 오류입니다. 관리자에게 문의해주세요.' });
        } else if (isSafety) {
            res.status(400).json({ error: '안전 정책에 의해 이미지 생성이 차단되었습니다. 다른 프롬프트로 시도해주세요.' });
        } else {
            res.status(500).json({ error: `이미지 생성 실패: ${errMsg.substring(0, 100)}` });
        }
    }
});

// === Work Logs API (업무일지) ===
// 내 업무일지 조회 (월별)
app.get('/api/work-logs', authMiddleware, async (req, res) => {
    try {
        const { month } = req.query; // '2026-03'
        let startDate, endDate;
        if (month) {
            startDate = `${month}-01`;
            const [y, m] = month.split('-').map(Number);
            endDate = `${y}-${String(m).padStart(2, '0')}-${new Date(y, m, 0).getDate()}`;
        } else {
            const now = new Date();
            const y = now.getFullYear();
            const m = now.getMonth() + 1;
            startDate = `${y}-${String(m).padStart(2, '0')}-01`;
            endDate = `${y}-${String(m).padStart(2, '0')}-${new Date(y, m, 0).getDate()}`;
        }
        const result = await pool.query(
            'SELECT id, date, content, created_at FROM work_logs WHERE user_id = $1 AND date BETWEEN $2 AND $3 ORDER BY date',
            [req.user.id, startDate, endDate]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('업무일지 조회 오류:', err);
        res.status(500).json({ error: '업무일지 조회 실패' });
    }
});

// 관리자: 특정 직원의 업무일지 조회
app.get('/api/work-logs/admin', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { month, user_id } = req.query;
        if (!user_id) return res.status(400).json({ error: '사용자 ID가 필요합니다' });
        let startDate, endDate;
        if (month) {
            startDate = `${month}-01`;
            const [y, m] = month.split('-').map(Number);
            endDate = `${y}-${String(m).padStart(2, '0')}-${new Date(y, m, 0).getDate()}`;
        } else {
            const now = new Date();
            const y = now.getFullYear();
            const m = now.getMonth() + 1;
            startDate = `${y}-${String(m).padStart(2, '0')}-01`;
            endDate = `${y}-${String(m).padStart(2, '0')}-${new Date(y, m, 0).getDate()}`;
        }
        const result = await pool.query(
            'SELECT id, date, content, created_at FROM work_logs WHERE user_id = $1 AND date BETWEEN $2 AND $3 ORDER BY date',
            [user_id, startDate, endDate]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('업무일지 관리자 조회 오류:', err);
        res.status(500).json({ error: '업무일지 조회 실패' });
    }
});

// 업무일지 작성 (upsert)
app.post('/api/work-logs', authMiddleware, async (req, res) => {
    try {
        const { date, content } = req.body;
        if (!date || !content) return res.status(400).json({ error: '날짜와 내용은 필수입니다' });
        const result = await pool.query(
            `INSERT INTO work_logs (user_id, date, content) VALUES ($1, $2, $3)
             ON CONFLICT (user_id, date) DO UPDATE SET content = $3
             RETURNING *`,
            [req.user.id, date, content]
        );
        res.json(result.rows[0]);
    } catch (err) {
        console.error('업무일지 저장 오류:', err);
        res.status(500).json({ error: '업무일지 저장 실패' });
    }
});

// 업무일지 수정
app.put('/api/work-logs/:id', authMiddleware, async (req, res) => {
    try {
        const { content } = req.body;
        if (!content) return res.status(400).json({ error: '내용은 필수입니다' });
        const result = await pool.query(
            'UPDATE work_logs SET content = $1 WHERE id = $2 AND user_id = $3 RETURNING *',
            [content, req.params.id, req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: '업무일지를 찾을 수 없습니다' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error('업무일지 수정 오류:', err);
        res.status(500).json({ error: '업무일지 수정 실패' });
    }
});

// 업무일지 삭제
app.delete('/api/work-logs/:id', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            'DELETE FROM work_logs WHERE id = $1 AND user_id = $2 RETURNING *',
            [req.params.id, req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: '업무일지를 찾을 수 없습니다' });
        res.json({ success: true });
    } catch (err) {
        console.error('업무일지 삭제 오류:', err);
        res.status(500).json({ error: '업무일지 삭제 실패' });
    }
});

// === 연차 조정 API ===

// 연차 조정 등록 (대표/부장만 가능)
app.post('/api/leave-adjustments', authMiddleware, adminOnly, async (req, res) => {
    try {
        if (req.user.position !== '부장' && req.user.position !== '대표') {
            return res.status(403).json({ error: '연차 조정 권한이 없습니다 (대표/부장만 가능)' });
        }
        const { user_id, adjustment, reason } = req.body;
        if (!user_id || adjustment === undefined || !reason) {
            return res.status(400).json({ error: '대상 직원, 조정값, 사유를 입력해주세요' });
        }
        const adj = Number(adjustment);
        if (isNaN(adj) || adj === 0) {
            return res.status(400).json({ error: '유효한 조정값을 입력해주세요' });
        }

        // 이력 저장
        const result = await pool.query(
            'INSERT INTO leave_adjustments (user_id, adjustment, reason, adjusted_by) VALUES ($1, $2, $3, $4) RETURNING *',
            [user_id, adj, reason, req.user.id]
        );

        // users.annual_leave 업데이트
        await pool.query('UPDATE users SET annual_leave = annual_leave + $1 WHERE id = $2', [adj, user_id]);

        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        console.error('POST /api/leave-adjustments error:', err);
        res.status(500).json({ error: err.message });
    }
});

// 연차 조정 내역 조회 (관리자)
app.get('/api/leave-adjustments', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { employeeId, startDate, endDate } = req.query;
        let query = `
            SELECT la.*, u.name as user_name, u.position as user_position,
                   ab.name as adjusted_by_name
            FROM leave_adjustments la
            JOIN users u ON la.user_id = u.id
            JOIN users ab ON la.adjusted_by = ab.id
        `;
        const values = [];
        const conditions = [];
        let idx = 1;

        if (employeeId) {
            conditions.push(`la.user_id = $${idx++}`);
            values.push(Number(employeeId));
        }
        if (startDate) {
            conditions.push(`la.created_at >= $${idx++}`);
            values.push(startDate);
        }
        if (endDate) {
            conditions.push(`la.created_at <= ($${idx++})::date + INTERVAL '1 day'`);
            values.push(endDate);
        }

        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }
        query += ' ORDER BY la.created_at DESC';

        const result = await pool.query(query, values);
        res.json(result.rows.map(r => ({
            id: r.id,
            userId: r.user_id,
            userName: r.user_name,
            userPosition: r.user_position,
            adjustment: Number(r.adjustment),
            reason: r.reason,
            adjustedByName: r.adjusted_by_name,
            createdAt: r.created_at
        })));
    } catch (err) {
        console.error('GET /api/leave-adjustments error:', err);
        res.status(500).json({ error: err.message });
    }
});

// 연차 조정 삭제/취소 (대표/부장만 가능, annual_leave 원복)
app.delete('/api/leave-adjustments/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        if (req.user.position !== '부장' && req.user.position !== '대표') {
            return res.status(403).json({ error: '연차 조정 취소 권한이 없습니다 (대표/부장만 가능)' });
        }
        const { id } = req.params;
        // 기존 조정 내역 조회
        const existing = await pool.query('SELECT * FROM leave_adjustments WHERE id = $1', [id]);
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: '조정 내역을 찾을 수 없습니다' });
        }
        const record = existing.rows[0];

        // annual_leave 원복 (반대 값 적용)
        await pool.query('UPDATE users SET annual_leave = annual_leave - $1 WHERE id = $2', [Number(record.adjustment), record.user_id]);

        // 이력 삭제
        await pool.query('DELETE FROM leave_adjustments WHERE id = $1', [id]);

        res.json({ success: true });
    } catch (err) {
        console.error('DELETE /api/leave-adjustments error:', err);
        res.status(500).json({ error: err.message });
    }
});

// === 정산현황 API ===

// 전체 날짜 목록 + 데이터 조회
app.get('/api/settlement-status', authMiddleware, adminOnly, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM settlement_status ORDER BY date DESC');
        res.json(result.rows);
    } catch (err) {
        console.error('GET /api/settlement-status error:', err);
        res.status(500).json({ error: err.message });
    }
});

// 날짜 추가/수정 (upsert)
app.post('/api/settlement-status', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { date, current_cash, settlement_scheduled, unsettled, coupang_unpaid, selfmall_unpaid,
                ad_naver, ad_gfa, card_fee, corp_card, hyodong, daesong, aewol, delivery, memo } = req.body;
        if (!date) return res.status(400).json({ error: '날짜가 필요합니다' });

        const result = await pool.query(`
            INSERT INTO settlement_status (date, current_cash, settlement_scheduled, unsettled, coupang_unpaid, selfmall_unpaid,
                ad_naver, ad_gfa, card_fee, corp_card, hyodong, daesong, aewol, delivery, memo, updated_by, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW())
            ON CONFLICT (date) DO UPDATE SET
                current_cash=EXCLUDED.current_cash, settlement_scheduled=EXCLUDED.settlement_scheduled,
                unsettled=EXCLUDED.unsettled, coupang_unpaid=EXCLUDED.coupang_unpaid, selfmall_unpaid=EXCLUDED.selfmall_unpaid,
                ad_naver=EXCLUDED.ad_naver, ad_gfa=EXCLUDED.ad_gfa, card_fee=EXCLUDED.card_fee, corp_card=EXCLUDED.corp_card,
                hyodong=EXCLUDED.hyodong, daesong=EXCLUDED.daesong, aewol=EXCLUDED.aewol, delivery=EXCLUDED.delivery,
                memo=EXCLUDED.memo, updated_by=EXCLUDED.updated_by, updated_at=NOW()
            RETURNING *
        `, [date, current_cash||0, settlement_scheduled||0, unsettled||0, coupang_unpaid||0, selfmall_unpaid||0,
            ad_naver||0, ad_gfa||0, card_fee||0, corp_card||0, hyodong||0, daesong||0, aewol||0, delivery||0, memo||'', req.user.id]);

        res.json(result.rows[0]);
    } catch (err) {
        console.error('POST /api/settlement-status error:', err);
        res.status(500).json({ error: err.message });
    }
});

// 날짜 삭제
app.delete('/api/settlement-status/:date', authMiddleware, adminOnly, async (req, res) => {
    try {
        await pool.query('DELETE FROM settlement_status WHERE date = $1', [req.params.date]);
        res.json({ success: true });
    } catch (err) {
        console.error('DELETE /api/settlement-status error:', err);
        res.status(500).json({ error: err.message });
    }
});

// SPA fallback
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 서버 시작
initDB().then(() => {
    app.listen(PORT, () => {
        console.log(`서버 실행 중: http://localhost:${PORT}`);
    });
}).catch(err => {
    console.error('DB 초기화 실패:', err);
    process.exit(1);
});

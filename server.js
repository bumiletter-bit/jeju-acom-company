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

    // 기존 admin 아이디를 ceo로 변경
    const oldAdmin = await pool.query("SELECT id FROM users WHERE username = 'admin'");
    if (oldAdmin.rows.length > 0) {
        await pool.query("UPDATE users SET username = 'ceo' WHERE username = 'admin'");
        console.log('관리자 아이디 변경: admin → ceo');
    }

    // 초기 관리자 계정 생성 (ceo 계정이 없을 때만)
    const adminCheck = await pool.query("SELECT id FROM users WHERE username = 'ceo'");
    if (adminCheck.rows.length === 0) {
        const hash = await bcrypt.hash('admin123', 10);
        await pool.query(
            "INSERT INTO users (username, password_hash, name, position, color, role, annual_leave) VALUES ($1, $2, $3, $4, $5, $6, $7)",
            ['ceo', hash, '전승범', '대표', '#ef4444', 'admin', 15]
        );
        console.log('초기 관리자 계정 생성: ceo / admin123');
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

    // AI 대화 테이블
    await pool.query(`
        CREATE TABLE IF NOT EXISTS ai_conversations (
            id SERIAL PRIMARY KEY,
            user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
            title VARCHAR(200) DEFAULT '새 대화',
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS ai_messages (
            id SERIAL PRIMARY KEY,
            conversation_id INTEGER REFERENCES ai_conversations(id) ON DELETE CASCADE,
            role VARCHAR(20) NOT NULL,
            content TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT NOW()
        )
    `);

    // ai_messages에 message_type 컬럼 추가 (이미지/텍스트 구분)
    await pool.query(`
        DO $$ BEGIN
            ALTER TABLE ai_messages ADD COLUMN message_type VARCHAR(10) DEFAULT 'text';
        EXCEPTION
            WHEN duplicate_column THEN NULL;
        END $$;
    `);

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
        const result = await pool.query('SELECT id, username, name, position, color, role, annual_leave FROM users WHERE id = $1', [req.user.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: '사용자를 찾을 수 없습니다' });
        const u = result.rows[0];
        res.json({ id: u.id, username: u.username, name: u.name, position: u.position, color: u.color, role: u.role, annualLeave: Number(u.annual_leave) });
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

// 결재자 목록 (직원→전연희 부장, 전연희 부장→전승범 대표)
app.get('/api/users/approvers', authMiddleware, async (req, res) => {
    try {
        let result;
        if (req.user.name === '전연희') {
            result = await pool.query("SELECT id, name, position FROM users WHERE name = '전승범' AND role = 'admin'");
        } else {
            result = await pool.query("SELECT id, name, position FROM users WHERE name = '전연희' AND role = 'admin'");
        }
        // 해당 결재자가 없으면 전체 관리자 목록 반환 (fallback)
        if (result.rows.length === 0) {
            result = await pool.query("SELECT id, name, position FROM users WHERE role = 'admin' ORDER BY name");
        }
        res.json(result.rows);
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
        if (check.rows.length > 0 && check.rows[0].username === 'ceo') {
            return res.status(400).json({ error: '기본 관리자 계정은 삭제할 수 없습니다' });
        }
        await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
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
            userName: r.user_name, userColor: r.user_color, documentId: r.document_id || null
        })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/schedules', authMiddleware, async (req, res) => {
    try {
        const { date, title, type } = req.body;
        if (!date || !title) return res.status(400).json({ error: '날짜와 일정 내용은 필수입니다' });

        const result = await pool.query(
            'INSERT INTO schedules (user_id, date, title, type) VALUES ($1, $2, $3, $4) RETURNING *',
            [req.user.id, date, title, type || 'normal']
        );

        // 휴가 시 연차 차감
        if (type === 'vacation') {
            await pool.query('UPDATE users SET annual_leave = annual_leave - 1 WHERE id = $1', [req.user.id]);
        }

        const r = result.rows[0];
        res.json({ id: r.id, userId: r.user_id, date: r.date, title: r.title, type: r.type, userName: req.user.name, userColor: req.user.color });
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
        if (status) { conditions.push(`d.status = $${idx++}`); values.push(status); }
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
            createdAt: r.created_at, processedAt: r.processed_at
        })));
    } catch (err) {
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
                    const sd = endDate || startDate;
                    const s = new Date(`${startDate}T${startTime}`);
                    const e = new Date(`${sd}T${endTime}`);
                    const hours = (e - s) / (1000 * 60 * 60);
                    deductedLeave = Math.round(hours / 8 * 10) / 10;
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
            if (subType === '시간차' && startTime && endTime) {
                scheduleTitle = `시간차(${startTime}~${endTime}) - ${req.user.name}`;
            }
            const multiDay = subType === '연차' || subType === '병가' || subType === '시간차';
            if (type === 'vacation' && multiDay) {
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
        if (d.approver_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: '결재 권한이 없습니다' });
        }
        if (d.status !== 'pending') return res.status(400).json({ error: '이미 처리된 서류입니다' });

        await pool.query('UPDATE documents SET status = $1, processed_at = NOW() WHERE id = $2', ['approved', req.params.id]);
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
        if (d.approver_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: '결재 권한이 없습니다' });
        }
        if (d.status !== 'pending') return res.status(400).json({ error: '이미 처리된 서류입니다' });

        // 연차 복구
        if (Number(d.deducted_leave) > 0) {
            await pool.query('UPDATE users SET annual_leave = annual_leave + $1 WHERE id = $2', [d.deducted_leave, d.applicant_id]);
        }

        // 연동된 일정 삭제
        await pool.query('DELETE FROM schedules WHERE document_id = $1', [req.params.id]);

        await pool.query('UPDATE documents SET status = $1, processed_at = NOW() WHERE id = $2', ['rejected', req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 서류 수정
app.put('/api/documents/:id', authMiddleware, async (req, res) => {
    try {
        const doc = await pool.query('SELECT * FROM documents WHERE id = $1', [req.params.id]);
        if (doc.rows.length === 0) return res.status(404).json({ error: '서류를 찾을 수 없습니다' });

        const d = doc.rows[0];
        // 권한: 대기중/반려 → 본인, 승인 → 관리자만
        if (d.status === 'approved') {
            if (req.user.role !== 'admin') return res.status(403).json({ error: '승인된 서류는 관리자만 수정할 수 있습니다' });
        } else {
            if (d.applicant_id !== req.user.id && req.user.role !== 'admin') {
                return res.status(403).json({ error: '본인의 서류만 수정할 수 있습니다' });
            }
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
                    const sd = newEndDate || newStartDate;
                    const s = new Date(`${newStartDate}T${newStartTime}`);
                    const e = new Date(`${sd}T${newEndTime}`);
                    const hours = (e - s) / (1000 * 60 * 60);
                    newDeducted = Math.round(hours / 8 * 10) / 10;
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
        // 권한: 대기중 → 본인/관리자, 승인 → 관리자만, 반려 → 본인/관리자
        if (d.status === 'approved' && req.user.role !== 'admin') {
            return res.status(403).json({ error: '승인된 서류는 관리자만 삭제할 수 있습니다' });
        }
        if (d.applicant_id !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ error: '본인의 서류만 삭제할 수 있습니다' });
        }

        // 반려 아닌 경우 연차 복구
        if (d.status !== 'rejected' && Number(d.deducted_leave) > 0) {
            await pool.query('UPDATE users SET annual_leave = annual_leave + $1 WHERE id = $2', [d.deducted_leave, d.applicant_id]);
        }

        // 연동 일정은 ON DELETE CASCADE로 자동 삭제
        await pool.query('DELETE FROM documents WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// === Settlements API (인증 추가) ===

app.get('/api/settlements', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { month } = req.query;
        let result;
        if (month) {
            result = await pool.query(
                "SELECT * FROM settlements WHERE TO_CHAR(date, 'YYYY-MM') = $1 ORDER BY date, id",
                [month]
            );
        } else {
            result = await pool.query('SELECT * FROM settlements ORDER BY date, id');
        }
        const data = result.rows.map(row => ({
            id: row.id, date: row.date, partner: row.partner,
            amount: Number(row.amount), items: row.items, fromPricing: row.from_pricing
        }));
        res.json(data);
    } catch (err) {
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

app.delete('/api/settlements/:id', authMiddleware, adminOnly, async (req, res) => {
    try {
        await pool.query('DELETE FROM settlements WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// CJ 자동계산: 해당 날짜 대성+효돈 박스수 합산
app.get('/api/settlements/box-count', authMiddleware, adminOnly, async (req, res) => {
    try {
        const { date } = req.query;
        if (!date) return res.status(400).json({ error: '날짜를 지정해주세요' });

        const result = await pool.query(
            "SELECT partner, items FROM settlements WHERE date = $1 AND partner IN ('대성(시온)', '효돈농협')",
            [date]
        );

        let daesung = 0, hyodon = 0;
        result.rows.forEach(row => {
            const items = row.items || [];
            const qty = items.reduce((sum, item) => sum + (item.qty || 0), 0);
            if (row.partner === '대성(시온)') daesung += qty;
            else if (row.partner === '효돈농협') hyodon += qty;
        });

        res.json({ totalBoxes: daesung + hyodon, daesung, hyodon });
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
            "SELECT partner, COALESCE(SUM(amount), 0) as total FROM prepayments WHERE partner IN ('대성(시온)', '효돈농협') GROUP BY partner"
        );
        // 거래처별 정산 합계 (실제 정산만 - 품목별 금액 세팅 제외)
        const settleResult = await pool.query(
            "SELECT partner, COALESCE(SUM(amount), 0) as total FROM settlements WHERE partner IN ('대성(시온)', '효돈농협') AND (from_pricing IS NULL OR from_pricing = false) GROUP BY partner"
        );

        const prepayMap = {};
        prepayResult.rows.forEach(r => { prepayMap[r.partner] = Number(r.total); });
        const settleMap = {};
        settleResult.rows.forEach(r => { settleMap[r.partner] = Number(r.total); });

        const partners = ['대성(시온)', '효돈농협'];
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

app.get('/api/pricing', authMiddleware, adminOnly, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM pricing ORDER BY start_date DESC, id DESC');
        const data = result.rows.map(row => ({
            id: row.id, startDate: row.start_date, endDate: row.end_date,
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

        const totalAmount = (items || []).reduce((sum, r) => sum + (r.price || 0), 0);
        const settlementItems = (items || []).map(r => ({
            name: r.name, price: r.price, qty: 1, subtotal: r.price
        }));
        await pool.query(
            'INSERT INTO settlements (date, partner, amount, items, from_pricing) VALUES ($1, $2, $3, $4, true)',
            [startDate, partner, totalAmount, JSON.stringify(settlementItems)]
        );

        res.json({
            id: row.id, startDate: row.start_date, endDate: row.end_date,
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

app.post('/api/lunch/menus', authMiddleware, adminOnly, async (req, res) => {
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

app.delete('/api/lunch/menus/:id', authMiddleware, adminOnly, async (req, res) => {
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

// === AI Workspace API ===

const AI_SYSTEM_PROMPT = '당신은 제주아꼼이네 농업회사법인의 마케팅 도우미입니다. 온라인 판매 홍보문구, 톡톡 이미지 문구, 숏클립 문구, SNS 게시글 등을 작성해줍니다. 제주 감귤, 천혜향, 레드향, 한라봉 등 제주 과일 판매 업체입니다.';

app.get('/api/ai/conversations', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT id, title, created_at FROM ai_conversations WHERE user_id = $1 ORDER BY created_at DESC',
            [req.user.id]
        );
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/ai/conversations/:id', authMiddleware, async (req, res) => {
    try {
        const conv = await pool.query(
            'SELECT * FROM ai_conversations WHERE id = $1 AND user_id = $2',
            [req.params.id, req.user.id]
        );
        if (conv.rows.length === 0) return res.status(404).json({ error: '대화를 찾을 수 없습니다' });

        const messages = await pool.query(
            'SELECT id, role, content, message_type, created_at FROM ai_messages WHERE conversation_id = $1 ORDER BY created_at ASC',
            [req.params.id]
        );
        res.json({ conversation: conv.rows[0], messages: messages.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/ai/conversations', authMiddleware, async (req, res) => {
    try {
        const result = await pool.query(
            'INSERT INTO ai_conversations (user_id) VALUES ($1) RETURNING *',
            [req.user.id]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/ai/conversations/:id', authMiddleware, async (req, res) => {
    try {
        await pool.query(
            'DELETE FROM ai_conversations WHERE id = $1 AND user_id = $2',
            [req.params.id, req.user.id]
        );
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

        // 대화 소유권 확인
        const conv = await pool.query(
            'SELECT * FROM ai_conversations WHERE id = $1 AND user_id = $2',
            [conversationId, req.user.id]
        );
        if (conv.rows.length === 0) return res.status(404).json({ error: '대화를 찾을 수 없습니다' });

        // 사용자 메시지 저장
        await pool.query(
            'INSERT INTO ai_messages (conversation_id, role, content) VALUES ($1, $2, $3)',
            [conversationId, 'user', image ? `📎 ${userMessage}` : userMessage]
        );

        // 첫 메시지면 대화 제목 업데이트
        const msgCount = await pool.query('SELECT COUNT(*) FROM ai_messages WHERE conversation_id = $1', [conversationId]);
        if (parseInt(msgCount.rows[0].count) === 1) {
            const prefix = image ? '📎 ' : '';
            const title = prefix + (userMessage.length > 27 ? userMessage.substring(0, 27) + '...' : userMessage);
            await pool.query('UPDATE ai_conversations SET title = $1 WHERE id = $2', [title, conversationId]);
        }

        let assistantContent;

        if (image) {
            // 이미지 포함 → Gemini API 사용
            if (!process.env.GEMINI_API_KEY) {
                return res.status(500).json({ error: 'GEMINI_API_KEY가 설정되지 않았습니다' });
            }

            const genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
            const response = await genai.models.generateContent({
                model: 'gemini-2.0-flash',
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

            // 기존 메시지 히스토리 로드 (텍스트만)
            const history = await pool.query(
                "SELECT role, content FROM ai_messages WHERE conversation_id = $1 AND message_type = 'text' ORDER BY created_at ASC",
                [conversationId]
            );

            const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
            const aiResponse = await anthropic.messages.create({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 2048,
                system: AI_SYSTEM_PROMPT,
                messages: history.rows.map(m => ({ role: m.role, content: m.content }))
            });

            assistantContent = aiResponse.content[0].text;
        }

        // AI 응답 저장
        await pool.query(
            'INSERT INTO ai_messages (conversation_id, role, content) VALUES ($1, $2, $3)',
            [conversationId, 'assistant', assistantContent]
        );

        res.json({ reply: assistantContent });
    } catch (err) {
        console.error('AI 채팅 오류:', err);
        const errorMessage = err?.message || 'AI 응답 생성 중 오류가 발생했습니다';
        res.status(500).json({ error: '이미지 분석 중 오류가 발생했습니다. 다시 시도해주세요.' });
    }
});

// === AI 이미지 생성 (Gemini) ===
app.post('/api/ai/image', authMiddleware, async (req, res) => {
    try {
        const { conversationId, prompt, referenceImage, referenceImageMimeType } = req.body;
        if (!conversationId || !prompt) return res.status(400).json({ error: '대화 ID와 프롬프트는 필수입니다' });

        const conv = await pool.query(
            'SELECT * FROM ai_conversations WHERE id = $1 AND user_id = $2',
            [conversationId, req.user.id]
        );
        if (conv.rows.length === 0) return res.status(404).json({ error: '대화를 찾을 수 없습니다' });

        // 사용자 메시지 저장
        const saveMsg = referenceImage ? `📎🎨 ${prompt}` : prompt;
        await pool.query(
            "INSERT INTO ai_messages (conversation_id, role, content, message_type) VALUES ($1, 'user', $2, 'text')",
            [conversationId, saveMsg]
        );

        // 첫 메시지면 대화 제목 업데이트
        const msgCount = await pool.query('SELECT COUNT(*) FROM ai_messages WHERE conversation_id = $1', [conversationId]);
        if (parseInt(msgCount.rows[0].count) === 1) {
            const title = '🎨 ' + (prompt.length > 27 ? prompt.substring(0, 27) + '...' : prompt);
            await pool.query('UPDATE ai_conversations SET title = $1 WHERE id = $2', [title, conversationId]);
        }

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
                    model: 'gemini-2.0-flash-exp-image-generation',
                    contents: [{ role: 'user', parts }],
                    config: {
                        responseModalities: ['Text', 'Image']
                    }
                });
            } catch (apiErr) {
                const status = apiErr?.status || apiErr?.statusCode || apiErr?.code;
                const is429 = status === 429 || String(apiErr?.message || '').includes('429') || String(apiErr?.message || '').includes('RESOURCE_EXHAUSTED');
                console.error(`이미지 생성 API 오류 (시도 ${retryCount + 1}):`, apiErr);

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
        console.error('이미지 생성 오류:', err);
        const status = err?.status || err?.statusCode || err?.code;
        const is429 = status === 429 || String(err?.message || '').includes('429') || String(err?.message || '').includes('RESOURCE_EXHAUSTED');

        if (is429) {
            res.status(429).json({ error: '요청이 많아 잠시 후 다시 시도해주세요 (30초 후)' });
        } else {
            res.status(500).json({ error: '이미지 생성에 실패했습니다. 다시 시도해주세요.' });
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

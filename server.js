// server.js - 백엔드 전체 기능 구현

const express = require('express');
const cors = require('cors');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// 미들웨어 설정
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// 로그인 세션 설정 (30일 유효)
app.use(session({
  secret: 'quest-secret-key-9999',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 30 }
}));

// public 폴더(프론트엔드) 연결
app.use(express.static(path.join(__dirname, 'public')));

/* ==========================================
   도움 함수 (경험치 및 레벨 계산 규칙)
========================================== */
function needXP(level) {
  return level * 50 + 50;
}

// 로그인 확인용 미들웨어
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: "로그인이 필요합니다." });
  }
  next();
}

/* ==========================================
   1. 회원가입 및 로그인 API
========================================== */

// 회원가입 API
app.post('/api/signup', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "아이디와 비밀번호를 입력해주세요." });
  }

  const hashedPassword = bcrypt.hashSync(password, 10);

  db.run(`INSERT INTO users (username, password) VALUES (?, ?)`, [username, hashedPassword], function(err) {
    if (err) {
      if (err.message.includes('UNIQUE')) {
        return res.status(400).json({ error: "이미 존재하는 아이디입니다." });
      }
      return res.status(500).json({ error: "회원가입 실패" });
    }

    const userId = this.lastID;
    // 회원가입 성공 시 초기 프로필 생성 (LV 1, XP 0)
    db.run(`INSERT INTO profiles (user_id, level, xp, total, cleared) VALUES (?, 1, 0, 0, 0)`, [userId], (pErr) => {
      if (pErr) return res.status(500).json({ error: "프로필 생성 실패" });
      
      // 자동 로그인 처리
      req.session.userId = userId;
      req.session.username = username;
      res.json({ message: "회원가입 성공", user: { id: userId, username } });
    });
  });
});

// 로그인 API
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "아이디와 비밀번호를 입력해주세요." });
  }

  db.get(`SELECT * FROM users WHERE username = ?`, [username], (err, user) => {
    if (err || !user) {
      return res.status(400).json({ error: "아이디 또는 비밀번호가 틀렸습니다." });
    }

    const isValid = bcrypt.compareSync(password, user.password);
    if (!isValid) {
      return res.status(400).json({ error: "아이디 또는 비밀번호가 틀렸습니다." });
    }

    req.session.userId = user.id;
    req.session.username = user.username;
    res.json({ message: "로그인 성공", user: { id: user.id, username: user.username } });
  });
});

// 로그아웃 API
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ message: "로그아웃 성공" });
  });
});

/* ==========================================
   2. 데이터 조회 API (내 정보 및 퀘스트)
========================================== */

app.get('/api/me', requireAuth, (req, res) => {
  const userId = req.session.userId;

  // 프로필 가져오기
  db.get(`SELECT level, xp, total, cleared FROM profiles WHERE user_id = ?`, [userId], (err, profile) => {
    if (err || !profile) return res.status(500).json({ error: "프로필 조회 실패" });

    // 진행 중인 퀘스트 가져오기
    db.all(`SELECT * FROM quests WHERE user_id = ? ORDER BY created_at ASC`, [userId], (qErr, rows) => {
      if (qErr) return res.status(500).json({ error: "퀘스트 목록 조회 실패" });

      const quests = rows.map(q => ({
        id: q.id,
        type: q.type,
        name: q.name,
        desc: q.desc || "",
        xp: q.xp,
        rewardText: q.reward_text || "",
        rewardImg: q.reward_image || "",
        start: q.start_at || "",
        due: q.due_at || "",
        at: q.event_at || "",
        days: q.repeat_days ? JSON.parse(q.repeat_days) : [],
        time: q.repeat_time || "",
        lastDone: q.last_done_date || ""
      }));

      // 클리어 기록 가져오기 (최신순 300개)
      db.all(`SELECT id, quest_name as name, type, xp, cleared_at as at, reward_text as rewardText, reward_image as rewardImg FROM history WHERE user_id = ? ORDER BY id DESC LIMIT 300`, [userId], (hErr, history) => {
        if (hErr) return res.status(500).json({ error: "기록 조회 실패" });

        res.json({
          user: { id: userId, username: req.session.username },
          profile,
          quests,
          history
        });
      });
    });
  });
});

/* ==========================================
   3. 퀘스트 등록 및 삭제 API
========================================== */

// 퀘스트 등록
app.post('/api/quests', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const { id, type, name, desc, xp, rewardText, rewardImg, start, due, at, days, time } = req.body;

  if (!name || !xp) {
    return res.status(400).json({ error: "퀘스트 제목과 경험치를 확인해주세요." });
  }

  const repeatDaysStr = days ? JSON.stringify(days) : null;

  const query = `
    INSERT INTO quests (id, user_id, type, name, desc, xp, reward_text, reward_image, start_at, due_at, event_at, repeat_days, repeat_time, last_done_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')
  `;

  db.run(query, [id, userId, type, name, desc, xp, rewardText, rewardImg, start, due, at, repeatDaysStr, time], (err) => {
    if (err) return res.status(500).json({ error: "퀘스트 등록 실패" });
    res.json({ message: "퀘스트 등록 완료" });
  });
});

// 퀘스트 삭제
app.delete('/api/quests/:id', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const questId = req.params.id;

  db.run(`DELETE FROM quests WHERE id = ? AND user_id = ?`, [questId, userId], (err) => {
    if (err) return res.status(500).json({ error: "퀘스트 삭제 실패" });
    res.json({ message: "퀘스트 삭제 완료" });
  });
});

/* ==========================================
   4. 퀘스트 클리어 API (서버에서 XP / 레벨 계산)
========================================== */

app.post('/api/quests/:id/clear', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const questId = req.params.id;

  // 1. 해당 퀘스트가 존재하는지 확인
  db.get(`SELECT * FROM quests WHERE id = ? AND user_id = ?`, [questId, userId], (err, quest) => {
    if (err || !quest) return res.status(404).json({ error: "퀘스트를 찾을 수 없습니다." });

    // 2. 현재 프로필 가져오기
    db.get(`SELECT level, xp, total, cleared FROM profiles WHERE user_id = ?`, [userId], (pErr, profile) => {
      if (pErr || !profile) return res.status(500).json({ error: "프로필 정보 오류" });

      let { level, xp, total, cleared } = profile;
      const gainedXP = quest.xp;

      xp += gainedXP;
      total += gainedXP;
      cleared += 1;

      // 레벨업 계산 (남은 XP 이월 처리)
      let levelUpCount = 0;
      while (xp >= needXP(level)) {
        xp -= needXP(level);
        level += 1;
        levelUpCount += 1;
      }

      const now = new Date();
      // 한국 시간 기준 YYYY-MM-DD
      const p2 = n => (n < 10 ? "0" : "") + n;
      const todayStr = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`;

      // DB 갱신 작업 시작
      db.serialize(() => {
        // 프로필 업데이트
        db.run(`UPDATE profiles SET level = ?, xp = ?, total = ?, cleared = ? WHERE user_id = ?`,
          [level, xp, total, cleared, userId]
        );

        // 지난 기록(History) 추가
        db.run(`INSERT INTO history (user_id, quest_name, type, xp, cleared_at, reward_text, reward_image) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [userId, quest.name, quest.type, gainedXP, Date.now(), quest.reward_text || "", quest.reward_image || ""]
        );

        // 반복 퀘스트면 last_done_date만 오늘 날짜로 업데이트, 일반/타임어택/이벤트 퀘스트는 삭제
        if (quest.type === 'repeat') {
          db.run(`UPDATE quests SET last_done_date = ? WHERE id = ? AND user_id = ?`, [todayStr, questId, userId]);
        } else {
          db.run(`DELETE FROM quests WHERE id = ? AND user_id = ?`, [questId, userId]);
        }

        res.json({
          message: "클리어 완료",
          levelUp: levelUpCount,
          newLevel: level,
          newXP: xp,
          rewardText: quest.reward_text,
          rewardImg: quest.reward_image
        });
      });
    });
  });
});

/* ==========================================
   5. 데이터 전체 초기화 API
========================================== */

app.post('/api/reset', requireAuth, (req, res) => {
  const userId = req.session.userId;

  db.serialize(() => {
    db.run(`UPDATE profiles SET level = 1, xp = 0, total = 0, cleared = 0 WHERE user_id = ?`, [userId]);
    db.run(`DELETE FROM quests WHERE user_id = ?`, [userId]);
    db.run(`DELETE FROM history WHERE user_id = ?`, [userId]);
    res.json({ message: "초기화되었습니다." });
  });
});

/* ==========================================
   서버 실행
========================================== */
app.listen(PORT, () => {
  console.log(`=================================`);
  console.log(`서버가 준비되었습니다! http://localhost:${PORT}`);
  console.log(`=================================`);
});
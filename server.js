const express = require('express');
const cors = require('cors');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(session({
  secret: 'quest-key-123',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 30 }
}));

app.use(express.static(path.join(__dirname, 'public')));

function needXP(l) { return l * 50 + 50; }

// 가입
app.post('/api/signup', async (req, res) => {
  const { username, password } = req.body;
  const hashedPassword = bcrypt.hashSync(password, 10);
  try {
    const result = await db.query(`INSERT INTO users (username, password) VALUES (?, ?) RETURNING id`, [username, hashedPassword]);
    const userId = result.rows[0].id;
    await db.run(`INSERT INTO profiles (user_id) VALUES (?)`, [userId]);
    req.session.userId = userId;
    req.session.username = username;
    res.json({ message: "성공" });
  } catch (e) { res.status(400).json({ error: "가입 실패" }); }
});

// 로그인
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await db.get(`SELECT * FROM users WHERE username = ?`, [username]);
    if (user && bcrypt.compareSync(password, user.password)) {
      req.session.userId = user.id;
      req.session.username = user.username;
      return res.json({ message: "성공" });
    }
    res.status(400).json({ error: "아이디 또는 비번 틀림" });
  } catch (e) { res.status(500).json({ error: "에러" }); }
});

// 내 정보 불러오기
app.get('/api/me', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "로그인 필요" });
  try {
    const profile = await db.get(`SELECT * FROM profiles WHERE user_id = ?`, [req.session.userId]);
    const quests = await db.all(`SELECT * FROM quests WHERE user_id = ?`, [req.session.userId]);
    const history = await db.all(`SELECT id, quest_name as name, type, xp, cleared_at as at, reward_text as "rewardText", reward_image as "rewardImg" FROM history WHERE user_id = ? ORDER BY id DESC LIMIT 300`, [req.session.userId]);
    
    const formattedQuests = quests.map(q => ({
      ...q, rewardText: q.reward_text, rewardImg: q.reward_image, days: q.repeat_days ? JSON.parse(q.repeat_days) : []
    }));
    res.json({ profile, quests: formattedQuests, history });
  } catch (e) { res.status(500).json({ error: "데이터 로드 실패" }); }
});

// 퀘스트 등록
app.post('/api/quests', async (req, res) => {
  const { id, type, name, desc, xp, rewardText, rewardImg, start, due, at, days, time } = req.body;
  try {
    await db.run(`INSERT INTO quests (id, user_id, type, name, "desc", xp, reward_text, reward_image, start_at, due_at, event_at, repeat_days, repeat_time, last_done_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')`, 
    [id, req.session.userId, type, name, desc, xp, rewardText, rewardImg, start, due, at, JSON.stringify(days||[]), time]);
    res.json({ message: "성공" });
  } catch (e) { res.status(500).json({ error: "등록 실패" }); }
});

// 퀘스트 클리어
app.post('/api/quests/:id/clear', async (req, res) => {
  const qId = req.params.id;
  const uId = req.session.userId;
  try {
    const q = await db.get(`SELECT * FROM quests WHERE id = ? AND user_id = ?`, [qId, uId]);
    const p = await db.get(`SELECT * FROM profiles WHERE user_id = ?`, [uId]);
    let { level, xp, total, cleared } = p;
    xp += q.xp; total += q.xp; cleared += 1;
    let up = 0;
    while (xp >= needXP(level)) { xp -= needXP(level); level++; up++; }
    
    await db.run(`UPDATE profiles SET level=?, xp=?, total=?, cleared=? WHERE user_id=?`, [level, xp, total, cleared, uId]);
    await db.run(`INSERT INTO history (user_id, quest_name, type, xp, cleared_at, reward_text, reward_image) VALUES (?,?,?,?,?,?,?)`, 
      [uId, q.name, q.type, q.xp, Date.now(), q.reward_text, q.reward_image]);
    
    if (q.type === 'repeat') {
      const today = new Date(new Date().getTime() + (9*60*60*1000)).toISOString().split('T')[0];
      await db.run(`UPDATE quests SET last_done_date = ? WHERE id = ?`, [today, qId]);
    } else {
      await db.run(`DELETE FROM quests WHERE id = ?`, [qId]);
    }
    res.json({ levelUp: up, newLevel: level, rewardText: q.reward_text, rewardImg: q.reward_image });
  } catch (e) { res.status(500).json({ error: "실패" }); }
});

app.delete('/api/quests/:id', async (req, res) => {
  await db.run(`DELETE FROM quests WHERE id = ? AND user_id = ?`, [req.params.id, req.session.userId]);
  res.json({ message: "삭제" });
});

app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ message: "로그아웃" }); });

// DB 초기화 후 서버 시작
db.init().then(() => {
  app.listen(PORT, () => console.log(`🚀 서버 포트 ${PORT} 가동!`));
}).catch(err => {
  console.error("❌ 서버 시작 실패:", err);
});

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

const OpenAI = require('openai');
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY // 시스템 환경 변수에서 몰래 가져옴
});

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

// 퀘스트 수정 API
app.put('/api/quests/:id', async (req, res) => {
  const qId = req.params.id;
  const uId = req.session.userId;
  const { type, name, desc, xp, rewardText, rewardImg, start, due, at, days, time } = req.body;
  try {
    await db.run(`UPDATE quests SET type=?, name=?, "desc"=?, xp=?, reward_text=?, reward_image=?, start_at=?, due_at=?, event_at=?, repeat_days=?, repeat_time=? WHERE id=? AND user_id=?`,
    [type, name, desc, xp, rewardText, rewardImg, start, due, at, JSON.stringify(days||[]), time, qId, uId]);
    res.json({ message: "수정 성공" });
  } catch (e) { res.status(500).json({ error: "수정 실패" }); }
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

/* ==========================================
   AI 감정 일기 / 상담 API
========================================== */
app.post('/api/ai/chat', async (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "로그인 필요" });
  
  const { messages } = req.body; // 프론트엔드가 보낸 대화 기록들
  if (!messages || !messages.length) return res.status(400).json({ error: "메시지가 없습니다." });

  try {
    // 1. AI에게 역할 부여 (시스템 프롬프트)
    const systemPrompt = {
      role: "system",
      content: `
# Role: ADHD 특화 '감정 기록 및 기억 보조 AI 상담사'

## 1. 핵심 철학 (이 AI의 존재 이유)
사용자는 ADHD 특성상 감정을 스스로 자각하기 어렵고, 지나간 일의 기억이 흐릿해져 판단에 어려움을 겪습니다. 
당신의 목표는 냉랭하고 교훈적인 상담사가 아니라, 사용자의 감정을 정돈하고 객관적 사실을 기록해 주는 든든한 '기억 보조원(외부 뇌)'이 되는 것입니다.

## 2. 상담 스타일 (Tone & Manner)
- 따뜻한 공감: 친구나 다정한 누나/오빠처럼 부드럽고 가깝게 대화하세요. (딱딱한 전문 상담사 말투 금지)
- 판단 금지: 절대 사용자를 탓하거나 가르치려 들지 마세요.
- 구체화 유도: 사용자가 "그냥 짜증 난다"처럼 추상적으로 말하면, 감각과 상황을 구체적으로 끄집어내 주세요.
- 간결한 대답: 글이 너무 길면 ADHD 사용자가 집중하기 어렵습니다. 짧고 명확하게 질문하며 대화를 이어가세요.

## 3. 대화 중 필수 체크 (패턴 인식)
- 대화를 나누며 유사한 고민이나 반복되는 행동 패턴이 느껴지면 슬쩍 언급해 주세요.

## 4. 대화 종료 및 출력 포맷 (매우 중요)
사용자가 "그만할래", "끝", "일기 저장해줘" 등의 종료 의도를 보이면, 대화 내용을 총정리하여 **반드시 아래 JSON 형식으로만** 출력하세요. (JSON 외의 다른 잡다한 설명은 붙이지 마세요)

{
  "status": "completed",
  "emotion_tags": ["#감정1", "#감정2", "#감정3"],
  "focus_fact": "오늘 있었던 핵심 사건을 객관적으로 한 줄 요약",
  "memory_anchor": "날짜와 핵심 상황을 결합한 기억 메모",
  "pattern_match": {
    "is_similar": true, 
    "past_insight": "과거 유사 패턴 요약 (없으면 '해당 없음')"
  },
  "coach_tip": "ADHD 사용자를 위한 현실적이고 가벼운 추천 행동 1가지"
}
`
    };

    // 2. OpenAI API 호출
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini", // 빠르고 저렴한 최신 모델
      messages: [systemPrompt, ...messages],
    });

    const aiReply = completion.choices[0].message.content;
    res.json({ reply: aiReply });
  } catch (err) {
    console.error("AI 통신 에러:", err);
    res.status(500).json({ error: "AI와 통신하는 중 문제가 발생했습니다." });
  }
});

// DB 초기화 후 서버 시작
db.init().then(() => {
  app.listen(PORT, () => console.log(`🚀 서버 포트 ${PORT} 가동!`));
}).catch(err => {
  console.error("❌ 서버 시작 실패:", err);
});

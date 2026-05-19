const express = require('express');
const cors = require('cors');
const Parser = require('rss-parser');
const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());

// RSS 파서 (브라우저 User-Agent 지정 - 일부 사이트의 차단 회피)
const parser = new Parser({
  timeout: 10000,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0 Safari/537.36'
  }
});

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Claude 모델명 (모델이 바뀌면 이 한 줄만 수정)
const CLAUDE_MODEL = 'claude-sonnet-4-6';

// 데이터 저장 경로
const DATA_DIR = path.join(__dirname, 'data');
const CARDS_FILE = path.join(DATA_DIR, 'cards.json');

// data 폴더 생성
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ===== 분야별 구글 뉴스 검색어 =====
// 빈 문자열('')이면 구글 뉴스 한국판 메인 헤드라인을 가져옴
const categoryQueries = {
  general: '',
  politics: '정치',
  economy: '경제',
  science: '과학 기술',
  health: '의료 건강',
  international: '국제',
  sports: '스포츠',
  culture: '문화 예술',
  popular: '속보'
};

const categoryLabels = {
  general: '종합',
  politics: '정치',
  economy: '경제',
  science: '과학/기술',
  health: '의료/건강',
  international: '국제',
  sports: '스포츠',
  culture: '문화',
  popular: '인기'
};

// ===== 매체 정치 성향 분류 =====
// AllSides 방식의 좌·우 병치를 위해 사용. 분류 기준은 자유롭게 수정 가능.
// 중앙일보는 통상 중도~보수로 분류되나, 본 앱에서는 2단 비교를 위해 보수로 묶음.
const mediaBias = {
  '한겨레': 'progressive',
  '경향신문': 'progressive',
  '경향': 'progressive',
  '오마이뉴스': 'progressive',
  '프레시안': 'progressive',
  '미디어오늘': 'progressive',
  '조선일보': 'conservative',
  '조선비즈': 'conservative',
  '동아일보': 'conservative',
  '중앙일보': 'conservative',
  '문화일보': 'conservative',
  '세계일보': 'conservative'
};

function getSide(sourceName) {
  if (!sourceName) return 'unknown';
  for (const key of Object.keys(mediaBias)) {
    if (sourceName.includes(key)) return mediaBias[key];
  }
  return 'unknown';
}

// 그룹이 진보·보수 매체를 모두 포함하는지
function hasBothSides(group) {
  const sides = new Set(group.map(a => getSide(a.source)));
  return sides.has('progressive') && sides.has('conservative');
}

// 언론사명 정규화 (영문/변형 표기를 한국어 표준명으로)
function normalizeSource(name) {
  if (!name) return '뉴스';
  const cleaned = name.trim();
  const map = {
    'chosun': '조선일보',
    'chosunbiz': '조선비즈',
    'joongang': '중앙일보',
    'korea joongang daily': '중앙일보',
    'hankyoreh': '한겨레',
    'donga': '동아일보',
    'dong-a': '동아일보',
    'kyunghyang': '경향신문',
    'yonhap': '연합뉴스',
    'ohmynews': '오마이뉴스',
    'pressian': '프레시안'
  };
  const lower = cleaned.toLowerCase();
  for (const key of Object.keys(map)) {
    if (lower.includes(key)) return map[key];
  }
  return cleaned;
}

const NEWS_API_KEY = process.env.NEWS_API_KEY || 'your_api_key_here';

// ===== 구글 뉴스 RSS에서 기사 가져오기 =====
// 구글 뉴스는 안정적이며, 기사 제목 끝에 " - 언론사명" 형태로 출처를 제공
async function fetchGoogleNews(query) {
  const url = query
    ? `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ko&gl=KR&ceid=KR:ko`
    : `https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko`;

  const articles = [];

  try {
    const feed = await parser.parseURL(url);

    feed.items.slice(0, 25).forEach(item => {
      const rawTitle = (item.title || '').trim();
      let title = rawTitle;
      let source = '뉴스';

      // 구글 뉴스 제목 형식: "기사 제목 - 언론사명"
      const idx = rawTitle.lastIndexOf(' - ');
      if (idx > 0) {
        title = rawTitle.slice(0, idx).trim();
        source = rawTitle.slice(idx + 3).trim();
      }

      articles.push({
        id: `gn_${item.link}`,
        title: title,
        description: (item.contentSnippet || item.content || '').slice(0, 300),
        link: item.link,
        pubDate: item.pubDate || item.isoDate,
        source: normalizeSource(source),
        type: 'google'
      });
    });
  } catch (error) {
    console.error(`구글 뉴스 RSS 오류 (${query || '헤드라인'}):`, error.message);
  }

  return articles;
}

// News API에서 뉴스 가져오기 (보조 소스)
async function fetchNewsAPIArticles(category) {
  try {
    const queries = {
      politics: '정치 한국',
      economy: '경제 기업',
      science: '과학 기술',
      health: '건강 의료',
      international: '국제 뉴스',
      sports: '스포츠',
      culture: '문화 예술',
      popular: '인기',
      general: '한국 뉴스'
    };

    const response = await axios.get('https://newsapi.org/v2/everything', {
      params: {
        q: queries[category] || '한국',
        language: 'ko',
        sortBy: 'publishedAt',
        pageSize: 15,
        apiKey: NEWS_API_KEY
      },
      timeout: 5000
    });

    return response.data.articles.map(article => ({
      id: `api_${article.url}`,
      title: article.title,
      description: article.description || '',
      link: article.url,
      pubDate: article.publishedAt,
      source: normalizeSource(article.source.name),
      type: 'api'
    }));
  } catch (error) {
    console.error('News API 오류:', error.message);
    return [];
  }
}

// 유사도 계산
function calculateSimilarity(str1, str2) {
  const words1 = str1.toLowerCase().split(' ');
  const words2 = str2.toLowerCase().split(' ');

  let matches = 0;
  words1.forEach(w1 => {
    if (words2.some(w2 => w2.includes(w1) || w1.includes(w2))) {
      matches++;
    }
  });

  return matches / Math.max(words1.length, words2.length);
}

// 같은 기사 그룹화
function groupSimilarArticles(articles) {
  const groups = [];
  const used = new Set();

  articles.forEach((article, index) => {
    if (used.has(index)) return;

    const group = [article];
    used.add(index);

    articles.forEach((other, otherIndex) => {
      if (used.has(otherIndex)) return;

      const similarity = calculateSimilarity(article.title, other.title);
      if (similarity > 0.5) {
        group.push(other);
        used.add(otherIndex);
      }
    });

    if (group.length >= 2) {
      groups.push(group);
    }
  });

  return groups;
}

// Claude로 객관적 요약 및 관점 분석 (기존 /api/news 용 - 유지)
async function generateObjectiveSummaryWithClaude(articles) {
  try {
    const articlesText = articles
      .map(a => `[${a.source}]\n제목: ${a.title}\n내용: ${a.description}`)
      .join('\n\n---\n\n');

    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: `다음은 같은 사건에 대한 여러 신문사의 기사입니다. 객관적으로 분석해주세요.\n\n${articlesText}\n\n요청:\n1. [객관적 요약] - 감정적 표현 없이 핵심 사실만 2-3문장으로\n2. [신문사별 관점] - 각 신문사가 강조하는 부분과 어조`
        }
      ]
    });

    return message.content[0].text;
  } catch (error) {
    console.error('Claude API 오류:', error.message);
    return null;
  }
}

// ===== 카드 전용: 구조화된 분석 (사실 / 좌·우 해석 분리) =====
async function generateStructuredCardAnalysis(articles) {
  try {
    const articlesText = articles
      .map(a => `[${a.source}]\n제목: ${a.title}\n내용: ${a.description || ''}`)
      .join('\n\n---\n\n');

    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content:
`다음은 같은 사건에 대한 여러 신문사의 기사입니다.
매체 정치 성향 참고 - 진보 성향: 한겨레, 경향신문, 오마이뉴스 / 보수 성향: 조선일보, 동아일보, 중앙일보

${articlesText}

위 기사들을 분석해 아래 JSON 형식으로만 응답하세요. 코드블록(\`\`\`)이나 그 외 설명 없이 순수 JSON만 출력합니다.

{
  "facts": ["여러 매체가 공통으로 전한 검증 가능한 핵심 사실. 해석·평가·전망을 배제하고 '무슨 일이 있었는가'만. 항목당 한 문장으로 간결하게. 최대 3개."],
  "perspectives": {
    "progressive": "진보 성향 매체들이 이 사건에서 무엇을 강조하고 어떤 의미를 부여했는지 2문장 이내로 중립적으로 기술. 진보 성향 기사가 없으면 빈 문자열.",
    "conservative": "보수 성향 매체들이 이 사건에서 무엇을 강조하고 어떤 의미를 부여했는지 2문장 이내로 중립적으로 기술. 보수 성향 기사가 없으면 빈 문자열."
  }
}

원칙:
- 어느 쪽이 옳은지 판단하지 말 것. 차이 자체만 드러낼 것.
- facts(사실)와 perspectives(해석)를 명확히 분리할 것.
- facts에 형용사적 평가나 어조를 섞지 말 것.`
        }
      ]
    });

    let text = (message.content[0].text || '').trim();
    text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();

    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end !== -1) {
      text = text.slice(start, end + 1);
    }

    const parsed = JSON.parse(text);
    return {
      facts: Array.isArray(parsed.facts) ? parsed.facts.slice(0, 3) : [],
      perspectives: {
        progressive: (parsed.perspectives && parsed.perspectives.progressive) || '',
        conservative: (parsed.perspectives && parsed.perspectives.conservative) || ''
      }
    };
  } catch (error) {
    console.error('Claude 구조화 분석 오류:', error.message);
    return null;
  }
}

// 뉴스 데이터 통합 및 정렬
function mergeAndSortArticles(googleArticles, apiArticles) {
  const merged = [...googleArticles, ...apiArticles];

  const unique = [];
  const seen = new Set();

  merged.forEach(article => {
    if (article.title && !seen.has(article.title)) {
      seen.add(article.title);
      unique.push(article);
    }
  });

  return unique.sort((a, b) => {
    const dateA = new Date(a.pubDate || 0);
    const dateB = new Date(b.pubDate || 0);
    return dateB - dateA;
  }).slice(0, 30);
}

// 안전한 날짜 포맷
function formatDate(value) {
  const d = new Date(value);
  if (isNaN(d.getTime())) {
    return new Date().toLocaleDateString('ko-KR', {
      year: 'numeric', month: '2-digit', day: '2-digit'
    });
  }
  return d.toLocaleDateString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit'
  });
}

// 매일 5시마다 실행되는 크론 작업
async function generateDailyCards() {
  console.log('\n✨ [' + new Date().toLocaleString('ko-KR') + '] 자동 카드 생성 시작...');

  const allCards = {};
  const categories = Object.keys(categoryLabels);

  for (const category of categories) {
    console.log(`📰 ${categoryLabels[category]} 분야 처리 중...`);

    try {
      // 뉴스 수집 (구글 뉴스 + News API)
      const googleNews = await fetchGoogleNews(categoryQueries[category]);
      const apiNews = await fetchNewsAPIArticles(category);

      const articles = mergeAndSortArticles(googleNews, apiNews);

      // 같은 기사 그룹화 + 좌·우 매체가 함께 있는 그룹 우선 정렬
      const groups = groupSimilarArticles(articles);
      groups.sort((a, b) => (hasBothSides(b) ? 1 : 0) - (hasBothSides(a) ? 1 : 0));

      // 그룹별 Claude 구조화 분석
      const cards = [];

      for (let i = 0; i < Math.min(10, groups.length); i++) {
        const group = groups[i];
        let structured = null;

        if (process.env.ANTHROPIC_API_KEY) {
          structured = await generateStructuredCardAnalysis(group);
        }

        const progressiveOutlets = [
          ...new Set(group.filter(a => getSide(a.source) === 'progressive').map(a => a.source))
        ];
        const conservativeOutlets = [
          ...new Set(group.filter(a => getSide(a.source) === 'conservative').map(a => a.source))
        ];

        cards.push({
          id: `${category}_${i}_${Date.now()}`,
          category: category,
          categoryLabel: categoryLabels[category],
          title: group[0].title,
          date: formatDate(group[0].pubDate),
          facts: structured ? structured.facts : [],
          perspectives: {
            progressive: {
              outlets: progressiveOutlets,
              framing: structured ? structured.perspectives.progressive : ''
            },
            conservative: {
              outlets: conservativeOutlets,
              framing: structured ? structured.perspectives.conservative : ''
            }
          },
          sources: group.map(article => ({
            name: article.source,
            side: getSide(article.source),
            content: article.description || article.title,
            link: article.link
          })),
          createdAt: new Date().toISOString()
        });

        // API 요청 간 딜레이 (rate limiting)
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      allCards[category] = cards;
      console.log(`✅ ${categoryLabels[category]}: ${cards.length}개 카드 생성`);

    } catch (error) {
      console.error(`❌ ${categoryLabels[category]} 오류:`, error.message);
      allCards[category] = [];
    }
  }

  // 결과 저장
  try {
    fs.writeFileSync(CARDS_FILE, JSON.stringify({
      generatedAt: new Date().toISOString(),
      cards: allCards
    }, null, 2));

    console.log(`\n🎉 자동 카드 생성 완료! (${CARDS_FILE})`);
    console.log(`총 ${Object.values(allCards).flat().length}개 카드 생성됨`);
  } catch (error) {
    console.error('파일 저장 오류:', error);
  }
}

// 크론 작업 등록: 매일 05:00에 실행
cron.schedule('0 5 * * *', () => {
  generateDailyCards();
}, {
  timezone: 'Asia/Seoul'
});

console.log('⏰ 크론 작업 등록: 매일 오전 5시에 자동 실행');

// API 엔드포인트: 오늘의 카드 조회
app.get('/api/cards', (req, res) => {
  try {
    if (!fs.existsSync(CARDS_FILE)) {
      return res.json({
        success: true,
        message: '아직 생성된 카드가 없습니다. 내일 오전 5시에 자동 생성됩니다.',
        cards: {}
      });
    }

    const data = JSON.parse(fs.readFileSync(CARDS_FILE, 'utf-8'));
    res.json({
      success: true,
      ...data
    });
  } catch (error) {
    console.error('카드 조회 오류:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// API 엔드포인트: 특정 분야의 카드 조회
app.get('/api/cards/:category', (req, res) => {
  try {
    const { category } = req.params;

    if (!fs.existsSync(CARDS_FILE)) {
      return res.json({
        success: true,
        message: '아직 생성된 카드가 없습니다.',
        cards: []
      });
    }

    const data = JSON.parse(fs.readFileSync(CARDS_FILE, 'utf-8'));
    const cards = data.cards[category] || [];

    res.json({
      success: true,
      category: category,
      categoryLabel: categoryLabels[category],
      generatedAt: data.generatedAt,
      total: cards.length,
      cards: cards
    });
  } catch (error) {
    console.error('카드 조회 오류:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// API 엔드포인트: 지금 바로 생성 (GET/POST 둘 다 지원)
app.get('/api/generate-now', async (req, res) => {
  res.json({ message: '카드 생성 중... 잠시 후 완료됩니다.' });
  await generateDailyCards();
});

app.post('/api/generate-now', async (req, res) => {
  res.json({ message: '카드 생성 중... 잠시 후 완료됩니다.' });
  await generateDailyCards();
});

// 기존 뉴스 조회 엔드포인트 (호환성 유지)
app.get('/api/news', async (req, res) => {
  const category = req.query.category || 'general';

  try {
    const googleNews = await fetchGoogleNews(categoryQueries[category]);
    const apiNews = await fetchNewsAPIArticles(category);

    const articles = mergeAndSortArticles(googleNews, apiNews);
    const groups = groupSimilarArticles(articles);

    const formattedArticles = [];

    for (const group of groups) {
      let analysis = null;
      if (process.env.ANTHROPIC_API_KEY) {
        analysis = await generateObjectiveSummaryWithClaude(group);
      }

      formattedArticles.push({
        id: `group_${group[0].id}`,
        title: group[0].title,
        date: formatDate(group[0].pubDate),
        analysis: analysis,
        sources: group.map(article => ({
          name: article.source,
          content: article.description || article.title,
          link: article.link
        }))
      });
    }

    const ungroupedArticles = articles.filter(
      article => !groups.flat().find(a => a.id === article.id)
    );

    ungroupedArticles.forEach(article => {
      formattedArticles.push({
        id: article.id,
        title: article.title,
        date: formatDate(article.pubDate),
        analysis: null,
        sources: [{
          name: article.source,
          content: article.description || article.title,
          link: article.link
        }]
      });
    });

    res.json({
      success: true,
      articles: formattedArticles,
      total: formattedArticles.length
    });
  } catch (error) {
    console.error('API 오류:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 헬스체크
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🚀 PRISM 뉴스 서버 실행 중: http://localhost:${PORT}`);
  console.log('📰 구글 뉴스 RSS + News API + Claude 분석');
  console.log('⏰ 매일 오전 5시에 자동 카드 생성');
  console.log(`\n📌 테스트: http://localhost:${PORT}/api/generate-now (GET/POST)\n`);
});
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

const parser = new Parser();
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// 데이터 저장 경로
const DATA_DIR = path.join(__dirname, 'data');
const CARDS_FILE = path.join(DATA_DIR, 'cards.json');

// data 폴더 생성
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// RSS 피드 URL
const rssFeeds = {
  general: [
    'https://www.chosun.com/rss/',
    'https://www.joongang.co.kr/rss/',
    'https://www.khan.co.kr/rss/',
    'https://www.hani.co.kr/rss/',
    'https://www.donga.com/rss/'
  ],
  politics: [
    'https://www.chosun.com/politics/rss/',
    'https://www.khan.co.kr/politics/rss/'
  ],
  economy: [
    'https://www.chosun.com/business/rss/',
    'https://www.joongang.co.kr/economics/rss/'
  ],
  science: [
    'https://www.chosun.com/science/rss/',
    'https://www.khan.co.kr/science/rss/'
  ],
  health: [
    'https://www.khan.co.kr/life/health/rss/',
    'https://www.hani.co.kr/arti/health/rss/'
  ],
  international: [
    'https://www.chosun.com/world/rss/',
    'https://www.joongang.co.kr/international/rss/'
  ],
  sports: [
    'https://www.chosun.com/sports/rss/',
    'https://www.donga.com/sports/rss/'
  ],
  culture: [
    'https://www.khan.co.kr/culture/rss/',
    'https://www.hani.co.kr/arti/culture/rss/'
  ],
  popular: [
    'https://www.chosun.com/rss/',
    'https://www.joongang.co.kr/rss/'
  ]
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

const NEWS_API_KEY = process.env.NEWS_API_KEY || 'your_api_key_here';

// RSS 피드에서 뉴스 가져오기
async function fetchRSSNews(urls) {
  const articles = [];
  
  for (const url of urls) {
    try {
      const feed = await parser.parseURL(url);
      
      feed.items.slice(0, 5).forEach(item => {
        articles.push({
          id: `rss_${item.link}`,
          title: item.title,
          description: item.contentSnippet || item.summary || '',
          link: item.link,
          pubDate: item.pubDate,
          source: extractSourceName(url),
          type: 'rss'
        });
      });
    } catch (error) {
      console.error(`RSS 피드 오류 (${url}):`, error.message);
    }
  }
  
  return articles;
}

// News API에서 뉴스 가져오기
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
      source: article.source.name,
      type: 'api'
    }));
  } catch (error) {
    console.error('News API 오류:', error.message);
    return [];
  }
}

// 신문사명 추출
function extractSourceName(url) {
  if (url.includes('chosun')) return '조선일보';
  if (url.includes('joongang')) return '중앙일보';
  if (url.includes('khan')) return '경향신문';
  if (url.includes('hani')) return '한겨레';
  if (url.includes('donga')) return '동아일보';
  return '뉴스';
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

// Claude로 객관적 요약 및 관점 분석
async function generateObjectiveSummaryWithClaude(articles) {
  try {
    const articlesText = articles
      .map(a => `[${a.source}]\n제목: ${a.title}\n내용: ${a.description}`)
      .join('\n\n---\n\n');
    
    const message = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
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

// 뉴스 데이터 통합 및 정렬
function mergeAndSortArticles(rssArticles, apiArticles) {
  const merged = [...rssArticles, ...apiArticles];
  
  const unique = [];
  const seen = new Set();
  
  merged.forEach(article => {
    if (!seen.has(article.title)) {
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

// 매일 5시마다 실행되는 크론 작업
async function generateDailyCards() {
  console.log('\n✨ [' + new Date().toLocaleString('ko-KR') + '] 자동 카드 생성 시작...');
  
  const allCards = {};
  const categories = Object.keys(categoryLabels);
  
  for (const category of categories) {
    console.log(`📰 ${categoryLabels[category]} 분야 처리 중...`);
    
    try {
      // 뉴스 수집
      const rssUrls = rssFeeds[category] || rssFeeds.general;
      const rssNews = await fetchRSSNews(rssUrls);
      const apiNews = await fetchNewsAPIArticles(category);
      
      const articles = mergeAndSortArticles(rssNews, apiNews);
      
      // 같은 기사 그룹화
      const groups = groupSimilarArticles(articles);
      
      // 그룹별 Claude 분석
      const cards = [];
      
      for (let i = 0; i < Math.min(10, groups.length); i++) {
        const group = groups[i];
        let analysis = null;
        
        if (process.env.ANTHROPIC_API_KEY) {
          analysis = await generateObjectiveSummaryWithClaude(group);
        }
        
        cards.push({
          id: `${category}_${i}_${Date.now()}`,
          category: category,
          categoryLabel: categoryLabels[category],
          title: group[0].title,
          date: new Date(group[0].pubDate).toLocaleDateString('ko-KR', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
          }),
          analysis: analysis,
          sources: group.map(article => ({
            name: article.source,
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
    const rssUrls = rssFeeds[category] || rssFeeds.general;
    const rssNews = await fetchRSSNews(rssUrls);
    const apiNews = await fetchNewsAPIArticles(category);
    
    const articles = mergeAndSortArticles(rssNews, apiNews);
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
        date: new Date(group[0].pubDate).toLocaleDateString('ko-KR', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }),
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
        date: new Date(article.pubDate).toLocaleDateString('ko-KR', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit'
        }),
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
  console.log('📰 RSS + News API + Claude 분석 기능');
  console.log('⏰ 매일 오전 5시에 자동 카드 생성');
  console.log('\n📌 테스트: http://localhost:3001/api/generate-now (GET/POST)\n');
});
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
// customFields 로 RSS 의 미디어(이미지) 확장 필드까지 읽는다.
const parser = new Parser({
  timeout: 10000,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    // 일부 서버(오마이뉴스 등)는 Accept 헤더 없으면 406 으로 거부한다.
    'Accept': 'application/rss+xml, application/xml, text/xml, */*;q=0.8',
    'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8'
  },
  customFields: {
    item: [
      ['media:content', 'mediaContent', { keepArray: true }],
      ['media:thumbnail', 'mediaThumbnail', { keepArray: true }],
      ['content:encoded', 'contentEncoded']
    ]
  }
});

// 기사 RSS 항목에서 대표 이미지 URL 을 뽑는다.
// 우선순위: media:content → media:thumbnail → enclosure → 본문 내 첫 <img>
function extractImage(item) {
  // 1) media:content (Yahoo Media RSS 확장 - 한국 신문 다수 사용)
  if (Array.isArray(item.mediaContent)) {
    for (const m of item.mediaContent) {
      const url = (m && m.$ && m.$.url) || (m && m.url);
      if (url && /^https?:\/\//i.test(url)) return url;
    }
  }
  // 2) media:thumbnail
  if (Array.isArray(item.mediaThumbnail)) {
    for (const m of item.mediaThumbnail) {
      const url = m && m.$ && m.$.url;
      if (url && /^https?:\/\//i.test(url)) return url;
    }
  }
  // 3) <enclosure> (rss-parser 내장 처리)
  if (item.enclosure && item.enclosure.url) {
    const type = item.enclosure.type || '';
    if (!type || /^image\//.test(type)) return item.enclosure.url;
  }
  // 4) content:encoded · content · description 본문에서 첫 <img src=...> 추출
  const html = item.contentEncoded || item['content:encoded'] || item.content || item.description || '';
  const m = String(html).match(/<img[^>]+src=["']([^"']+)["']/i);
  if (m && /^https?:\/\//i.test(m[1])) return m[1];
  return '';
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Claude 모델명 (모델이 바뀌면 이 한 줄만 수정)
const CLAUDE_MODEL = 'claude-sonnet-4-6';

// 데이터 저장 경로
const DATA_DIR = path.join(__dirname, 'data');
const CARDS_FILE = path.join(DATA_DIR, 'cards.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// ===== 분야별 검색어 =====
// 한국 뉴스 검색어 (구글 뉴스 한국판). 빈 문자열이면 메인 헤드라인
const categoryQueries = {
  general: '',
  politics: '정치',
  economy: '경제',
  science: '과학 기술',
  health: '의료 건강',
  international: '국제',
  sports: '스포츠',
  culture: '문화 예술',
};

// 외신 검색어 (구글 뉴스 영문판) - 한국 관련 외국 보도 수집용
const foreignQueries = {
  general: 'South Korea',
  politics: 'South Korea politics',
  economy: 'South Korea economy',
  science: 'South Korea technology',
  health: 'South Korea health',
  international: 'South Korea',
  sports: 'South Korea sports',
  culture: 'South Korea culture',
};

// ===== 한국 신문사 직접 RSS 피드 (보조 소스) =====
// 구글 뉴스가 주력이고, 이 피드들은 출처가 100% 확정돼 보수/진보 분류 정확도를 높인다.
// 2026년 기준 작동 확인된 피드만 등록한다. 막히면 해당 항목만 건너뛴다.
// 각 신문사마다 분야(섹션)별 RSS 주소를 둔다.
const koreanPressFeeds = [
  {
    source: '조선일보',
    sections: {
      // Arc XP Outbound Feeds - 전체 피드 1개. 분야 구분 없이 모든 카테고리에서 사용한다.
      general: 'https://www.chosun.com/arc/outboundfeeds/rss/?outputType=xml'
    }
  },
  {
    source: '매일경제',
    sections: {
      // 사용자 제공 피드. 섹션 코드(40300001) 미확정이라 전 분야 공통으로 사용한다.
      general: 'https://www.mk.co.kr/rss/40300001/'
    }
  },
  {
    source: '한겨레',
    sections: {
      // 사용자 제공 전체 피드. 전 분야 공통으로 사용한다.
      general: 'http://www.hani.co.kr/rss/'
    }
  },
  {
    source: '오마이뉴스',
    sections: {
      general: 'https://rss.ohmynews.com/rss/ohmynews.xml'
    }
  },
  {
    source: '프레시안',
    sections: {
      general: 'https://www.pressian.com/api/v3/site/rss/news'
    }
  },
  {
    source: 'SBS',
    sections: {
      general: 'https://news.sbs.co.kr/news/headlineRssFeed.do?plink=RSSREADER'
    }
  },
  {
    source: '동아일보',
    sections: {
      general: 'https://rss.donga.com/total.xml',
      politics: 'https://rss.donga.com/politics.xml',
      economy: 'https://rss.donga.com/economy.xml',
      international: 'https://rss.donga.com/international.xml',
      science: 'https://rss.donga.com/science.xml',
      health: 'https://rss.donga.com/health.xml',
      sports: 'https://rss.donga.com/sports.xml',
      culture: 'https://rss.donga.com/culture.xml',
    }
  },
  {
    source: '경향신문',
    sections: {
      general: 'https://www.khan.co.kr/rss/rssdata/total_news.xml',
      politics: 'https://www.khan.co.kr/rss/rssdata/politic.xml',
      economy: 'https://www.khan.co.kr/rss/rssdata/economy.xml',
      international: 'https://www.khan.co.kr/rss/rssdata/world.xml',
      science: 'https://www.khan.co.kr/rss/rssdata/itnews.xml',
      health: 'https://www.khan.co.kr/rss/rssdata/society.xml',
      sports: 'https://www.khan.co.kr/rss/rssdata/sports.xml',
      culture: 'https://www.khan.co.kr/rss/rssdata/culture.xml',
    }
  },
  {
    source: '서울신문',
    sections: {
      general: 'https://www.seoul.co.kr/xml/rss/rss_top.xml',
      politics: 'https://www.seoul.co.kr/xml/rss/rss_politics.xml',
      economy: 'https://www.seoul.co.kr/xml/rss/rss_economy.xml',
      international: 'https://www.seoul.co.kr/xml/rss/rss_international.xml',
      science: 'https://www.seoul.co.kr/xml/rss/rss_science.xml',
      health: 'https://www.seoul.co.kr/xml/rss/rss_life.xml',
      sports: 'https://www.seoul.co.kr/xml/rss/rss_sports.xml',
      culture: 'https://www.seoul.co.kr/xml/rss/rss_culture.xml',
    }
  },
  // ===== 사용자 추가 요청 매체 (검증 완료) =====
  {
    source: '한국경제',
    sections: {
      general: 'https://www.hankyung.com/feed/all-news'
    }
  },
  {
    source: '연합뉴스',
    sections: {
      general: 'https://www.yna.co.kr/rss/news.xml'
    }
  },
  {
    source: '머니투데이',
    sections: {
      general: 'https://rss.mt.co.kr/mt_news.xml'
    }
  },
  {
    source: '뉴시스',
    sections: {
      general: 'https://newsis.com/RSS/sokbo.xml'
    }
  }
];

const categoryLabels = {
  general: '종합',
  politics: '정치',
  economy: '경제',
  science: '과학/기술',
  health: '의료/건강',
  international: '국제',
  sports: '스포츠',
  culture: '문화'
};

// ===== 한국 매체 정치 성향 분류 =====
// AllSides 방식의 진보/보수 병치를 위해 사용. 분류는 자유롭게 수정 가능.
// 중앙일보는 통상 중도~보수로 분류되나 본 앱에서는 보수로 묶음.
// 연합뉴스·KBS·SBS·YTN·뉴스1·뉴시스·한국일보·서울신문 등 통신사·중립 방송사는
// 성향 분류가 논쟁적이라 의도적으로 미분류(unknown)로 두었습니다.
// 진보/보수로 분류하고 싶으면 아래 맵에 한 줄씩 추가하세요.
const mediaBias = {
  // 진보 성향
  '한겨레': 'progressive',
  '경향신문': 'progressive',
  '경향': 'progressive',
  '오마이뉴스': 'progressive',
  '프레시안': 'progressive',
  '미디어오늘': 'progressive',
  'MBC': 'progressive',
  // JTBC RSS 는 사실상 죽은 피드(2024년 10월 이후 갱신 없음)라 등록 안 함
  // 보수 성향
  '조선일보': 'conservative',
  '조선비즈': 'conservative',
  '조선': 'conservative',
  '동아일보': 'conservative',
  '동아': 'conservative',
  '중앙일보': 'conservative',
  '중앙': 'conservative',
  '문화일보': 'conservative',
  '세계일보': 'conservative',
  '매일경제': 'conservative',
  '매경': 'conservative',
  '한국경제': 'conservative',
  '한경': 'conservative',
  '채널A': 'conservative'
  // 연합뉴스TV, 머니투데이, 뉴시스 는 중립/통신사로 unknown 유지
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

// ===== 그룹 "관점 다양성" 점수 =====
// PRISM의 핵심: 한 이슈를 여러 신문이 다뤘다 = 다양한 시각이 존재한다.
// 그런 주제를 카드 우선순위 앞쪽으로 보내기 위한 점수.
//  - 다룬 매체(언론사) 수가 많을수록  ↑  (가장 중요)
//  - 보수·진보가 모두 다뤘으면        ↑↑ (이념적으로 다양 = 진짜 다양한 시각)
//  - 진영(보수/진보/중도)이 다양할수록 ↑
function groupDiversityScore(group) {
  const outlets = new Set(group.map(a => a.source).filter(Boolean));
  const sides = new Set(group.map(a => getSide(a.source)));
  let score = 0;
  score += outlets.size * 100;            // 다룬 매체 수 (핵심 신호)
  if (hasBothSides(group)) score += 500;   // 보수+진보 동시 = 이념적 다양성
  score += sides.size * 30;                // 진영 다양성 (보수/진보/중도)
  score += group.length;                   // 동점일 때 기사 많은 쪽
  return score;
}

// ===== 외국 매체 판별 =====
const foreignOutletKeywords = [
  'reuters', 'associated press', 'afp', 'agence france', 'bloomberg',
  'bbc', 'cnn', 'new york times', 'the guardian', 'al jazeera',
  'nikkei', 'nhk', 'kyodo', 'xinhua', 'cgtn', 'south china morning post',
  'scmp', 'washington post', 'financial times', 'wall street journal',
  'the economist', 'abc news', 'nbc news', 'cbs news', 'deutsche welle',
  'france 24', 'japan times', 'channel news asia', 'the diplomat',
  'politico', 'axios', 'sky news', 'the independent', 'newsweek', 'cnbc'
];

function isForeign(name) {
  if (!name) return false;
  const lower = name.toLowerCase();
  return foreignOutletKeywords.some(k => lower.includes(k));
}

// 한국 언론사명 정규화 (영문/변형 표기를 한국어 표준명으로)
function normalizeSource(name) {
  if (!name) return '뉴스';
  const cleaned = name.trim();
  const map = {
    'chosunbiz': '조선비즈',
    'chosun': '조선일보',
    'joongang': '중앙일보',
    'korea joongang daily': '중앙일보',
    'hankyoreh': '한겨레',
    'hani': '한겨레',
    'donga': '동아일보',
    'dong-a': '동아일보',
    'kyunghyang': '경향신문',
    'yonhap': '연합뉴스',
    'ohmynews': '오마이뉴스',
    'pressian': '프레시안',
    'maeil': '매일경제',
    'mk.co.kr': '매일경제',
    'hankyung': '한국경제',
    'jtbc': 'JTBC',
    'newsis': '뉴시스',
    'mt.co.kr': '머니투데이',
    'moneytoday': '머니투데이',
    'yonhapnewstv': '연합뉴스TV',
    'yna.co.kr': '연합뉴스',
    'imbc': 'MBC',
    'sbs': 'SBS'
  };
  const lower = cleaned.toLowerCase();
  for (const key of Object.keys(map)) {
    if (lower.includes(key)) return map[key];
  }
  return cleaned;
}

const NEWS_API_KEY = process.env.NEWS_API_KEY || 'your_api_key_here';

// 구글 뉴스 제목에서 "기사 제목 - 언론사명" 분리
function splitTitleSource(rawTitle) {
  const raw = (rawTitle || '').trim();
  const idx = raw.lastIndexOf(' - ');
  if (idx > 0) {
    return { title: raw.slice(0, idx).trim(), source: raw.slice(idx + 3).trim() };
  }
  return { title: raw, source: '' };
}

// ===== 구글 뉴스 RSS (한국판) =====
// 최근 2주(14일)치 기사를 수집한다 - 주제 클러스터링의 재료
async function fetchGoogleNews(query) {
  const scopedQuery = query ? `${query} when:14d` : '';
  const url = scopedQuery
    ? `https://news.google.com/rss/search?q=${encodeURIComponent(scopedQuery)}&hl=ko&gl=KR&ceid=KR:ko`
    : `https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko`;

  const articles = [];
  try {
    const feed = await parser.parseURL(url);
    feed.items.slice(0, 80).forEach(item => {
      const { title, source } = splitTitleSource(item.title);
      articles.push({
        id: `gn_${item.link}`,
        title: title,
        description: (item.contentSnippet || item.content || '').slice(0, 300),
        link: item.link,
        pubDate: item.pubDate || item.isoDate,
        source: normalizeSource(source || '뉴스'),
        image: extractImage(item),
        type: 'google'
      });
    });
  } catch (error) {
    console.error(`구글 뉴스 RSS 오류 (${query || '헤드라인'}):`, error.message);
  }
  return articles;
}

// ===== 한국 신문사 직접 RSS 수집 (보조 소스) =====
// 분야(category)에 해당하는 각 신문사 섹션 피드를 가져온다.
// 출처가 피드 단위로 확정돼 있어 보수/진보 분류가 정확하다.
// 섹션 피드가 막히면 그 신문사의 전체(general) 피드로 폴백한다.
async function fetchKoreanPressNews(category) {
  const articles = [];
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000; // 최근 2주만

  // 한 피드 URL에서 기사를 읽어 articles 에 담는다. 실패 시 false 반환.
  const pullFeed = async (url, sourceName) => {
    try {
      const feed = await parser.parseURL(url);
      feed.items.slice(0, 40).forEach(item => {
        const pubDate = item.pubDate || item.isoDate;
        const t = pubDate ? new Date(pubDate).getTime() : NaN;
        if (!isNaN(t) && t < cutoff) return; // 2주보다 오래된 기사 제외
        articles.push({
          id: `kp_${item.link}`,
          title: (item.title || '').trim(),
          description: (item.contentSnippet || item.content || '').slice(0, 300),
          link: item.link,
          pubDate: pubDate,
          source: sourceName, // 피드 단위로 출처 확정
          image: extractImage(item),
          type: 'press'
        });
      });
      return true;
    } catch (error) {
      return false;
    }
  };

  for (const press of koreanPressFeeds) {
    const sectionUrl = press.sections[category];
    const generalUrl = press.sections.general;
    let ok = false;
    if (sectionUrl) ok = await pullFeed(sectionUrl, press.source);
    // 섹션 피드가 막혔고 전체 피드 주소가 다르면 전체 피드로 폴백
    if (!ok && generalUrl && generalUrl !== sectionUrl) {
      ok = await pullFeed(generalUrl, press.source);
    }
    if (!ok) {
      console.error(`신문 RSS 실패 (${press.source}/${category}) - 건너뜀`);
    }
  }
  return articles;
}

// ===== 구글 뉴스 RSS (영문판) - 한국 관련 외신만 필터 =====
// 외신도 최근 2주(14일)치를 가져온다
async function fetchForeignNews(query) {
  const scopedQuery = query ? `${query} when:14d` : query;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(scopedQuery)}&hl=en-US&gl=US&ceid=US:en`;
  const articles = [];
  try {
    const feed = await parser.parseURL(url);
    feed.items.slice(0, 50).forEach(item => {
      const { title, source } = splitTitleSource(item.title);
      if (isForeign(source)) {
        articles.push({
          id: `fn_${item.link}`,
          title: title,
          description: (item.contentSnippet || '').slice(0, 200),
          link: item.link,
          pubDate: item.pubDate || item.isoDate,
          source: source,
          image: extractImage(item),
          type: 'foreign'
        });
      }
    });
  } catch (error) {
    console.error(`외신 RSS 오류 (${query}):`, error.message);
  }
  return articles.slice(0, 25);
}

// ===== 외신 직접 RSS (NYT, CNN 등) =====
// fetchForeignNews(구글 영문) 와 함께 외신 풀에 합쳐진다.
// URL 미검증 - test-feeds.js 로 확인 필요.
const foreignPressFeeds = [
  { source: 'The New York Times', url: 'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml' },
  { source: 'CNN', url: 'http://rss.cnn.com/rss/edition.rss' }
];

async function fetchForeignPressNews() {
  const articles = [];
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  for (const press of foreignPressFeeds) {
    try {
      const feed = await parser.parseURL(press.url);
      feed.items.slice(0, 30).forEach(item => {
        const pubDate = item.pubDate || item.isoDate;
        const t = pubDate ? new Date(pubDate).getTime() : NaN;
        if (!isNaN(t) && t < cutoff) return;
        articles.push({
          id: `fp_${item.link}`,
          title: (item.title || '').trim(),
          description: (item.contentSnippet || item.content || '').slice(0, 200),
          link: item.link,
          pubDate: pubDate,
          source: press.source,
          image: extractImage(item),
          type: 'foreign'
        });
      });
    } catch (error) {
      console.error(`외신 RSS 실패 (${press.source}):`, error.message);
    }
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
// - 여러 매체가 다룬 같은 사건은 하나의 그룹으로 묶는다 (다관점 카드)
// - 단독 보도 기사도 1개짜리 그룹으로 포함해 분야별 카드 수를 채운다
function groupSimilarArticles(articles) {
  const multi = [];   // 2개 이상 매체가 다룬 사건
  const single = [];  // 단독 기사
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
      multi.push(group);
    } else {
      single.push(group);
    }
  });

  // 다관점 그룹을 앞에, 단독 기사를 뒤에 두어 카드 수를 채운다
  return [...multi, ...single];
}

// Claude 로 기사를 같은 사건·주제끼리 묶는다
// - 날짜·표현이 달라도 본질적으로 같은 사안이면 한 그룹으로 (같은 주제 다른 날짜 문제 해결)
// - 실패하거나 API 키가 없으면 단어 겹침 방식(groupSimilarArticles)으로 대체
// Claude 응답에서 안전하게 JSON 을 뽑아낸다.
// Claude 가 가끔 문자열 안에 raw 줄바꿈/탭/제어문자를 그대로 넣어 JSON.parse 가 실패한다.
// "Bad control character in string literal in JSON" 류 오류 방지.
// 두 단계로 시도: (1) 그대로 파싱  (2) 문자열 내부의 제어문자만 이스케이프 후 재시도
function safeJsonParse(text) {
  // 1차 시도 - 그대로
  try {
    return JSON.parse(text);
  } catch (_) {
    // 2차 시도 - 문자열 ("..." 안)의 raw 제어문자 이스케이프
    let inString = false;
    let escaped = false;
    let cleaned = '';
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      const code = c.charCodeAt(0);
      if (escaped) {
        cleaned += c;
        escaped = false;
        continue;
      }
      if (c === '\\') {
        cleaned += c;
        escaped = true;
        continue;
      }
      if (c === '"') {
        cleaned += c;
        inString = !inString;
        continue;
      }
      // 문자열 내부의 raw 제어문자 처리
      if (inString && code < 0x20) {
        if (c === '\n') cleaned += '\\n';
        else if (c === '\r') cleaned += '\\r';
        else if (c === '\t') cleaned += '\\t';
        // 그 외 제어문자(\x00 ~ \x1F)는 그냥 제거
        continue;
      }
      cleaned += c;
    }
    return JSON.parse(cleaned);
  }
}

async function clusterArticlesWithClaude(articles) {
  if (!process.env.ANTHROPIC_API_KEY || articles.length === 0) {
    return groupSimilarArticles(articles);
  }
  try {
    const list = articles
      .map((a, i) => `${i}. (${formatDate(a.pubDate)}) ${a.title} [${a.source}]`)
      .join('\n');

    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content:
`다음은 한 분야의 뉴스 기사 목록입니다. 각 줄은 "번호. (날짜) 제목 [매체]" 형식입니다.

${list}

같은 사건·같은 주제를 다룬 기사끼리 한 그룹으로 묶으세요.
- 날짜가 다르거나 제목 표현이 달라도, 본질적으로 같은 사안이면 같은 그룹입니다 (예: 같은 사건의 후속 보도).
- 서로 다른 사건은 반드시 다른 그룹으로 나눕니다.
- 어느 그룹에도 묶이지 않는 단독 기사는 혼자만 있는 그룹으로 둡니다.

코드블록이나 설명 없이 아래 형식의 순수 JSON 배열만 출력하세요. 각 내부 배열은 한 그룹에 속한 기사 번호 목록이며, 모든 기사 번호가 빠짐없이 정확히 한 번씩 포함돼야 합니다.

[[0,4,9],[1],[2,7],[3,5,8],[6]]`
        }
      ]
    });

    let text = (message.content[0].text || '').trim();
    text = text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start !== -1 && end !== -1) text = text.slice(start, end + 1);
    const indexGroups = safeJsonParse(text);

    const used = new Set();
    const groups = [];
    indexGroups.forEach(idxArr => {
      if (!Array.isArray(idxArr)) return;
      const group = [];
      idxArr.forEach(idx => {
        if (typeof idx === 'number' && articles[idx] && !used.has(idx)) {
          group.push(articles[idx]);
          used.add(idx);
        }
      });
      if (group.length > 0) {
        // 그룹 안에서 최신 기사가 앞에 오도록 정렬 (카드 제목·날짜가 최신 기준)
        group.sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0));
        groups.push(group);
      }
    });
    // Claude 가 빠뜨린 기사는 단독 그룹으로 보강
    articles.forEach((a, i) => {
      if (!used.has(i)) groups.push([a]);
    });

    if (groups.length === 0) return groupSimilarArticles(articles);
    // 여러 기사가 묶인 그룹(다관점)을 앞에, 단독 기사를 뒤에
    groups.sort((a, b) => b.length - a.length);
    return groups;
  } catch (error) {
    console.error('Claude 클러스터링 오류:', error.message);
    return groupSimilarArticles(articles);
  }
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

// ===== 카드 전용: 구조화된 분석 (사실 / 진보·보수·해외 해석 분리) =====
// ===== 카드 대표 SVG (이미지 폴백) =====
// RSS 에서 대표 이미지가 안 잡힌 카드에만 호출한다.
// 추상·미니멀·중립적인 작은 배너 SVG 를 만든다 (PRISM 톤: 베이지/네이비/머스타드).
// 실패 시 빈 문자열 반환 → 프론트에서 이미지/SVG 모두 없으면 자리 안 차지.
async function generateCardSvg(headline, categoryLabel) {
  if (!process.env.ANTHROPIC_API_KEY) return '';
  try {
    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 800,
      messages: [
        {
          role: 'user',
          content:
`다음 뉴스 카드를 위한 작은 배너 SVG 일러스트를 만드세요.

제목: "${headline}"
분야: ${categoryLabel}

규칙(엄격히 지킬 것):
- viewBox="0 0 240 80" (가로 240, 세로 80)
- 추상적·미니멀·중립적인 톤만 사용
- 사용 가능한 색: 배경 #f4f1ec, 주 도형 #2a2440, 보조 #a07a4a, 옅은 톤 #d9d4ca
- 실제 인물·국기·로고·정치 상징·종교 상징·텍스트 금지
- 사용 가능한 요소: rect, circle, ellipse, line, polyline, polygon, path, g
- 필터/그라데이션은 단순한 linearGradient 1개까지만 허용, drop-shadow 금지
- 스크립트/이벤트 핸들러/외부 이미지 금지
- 분야와 제목의 분위기를 추상적으로 암시 (예: 경제→상승/하강 선, 국제→연결된 원, 정치→교차하는 선)

코드블록(\`\`\`)이나 설명 없이 <svg ...>...</svg> 그 자체만 출력하세요.`
        }
      ]
    });
    let text = (message.content[0].text || '').trim();
    text = text.replace(/^```svg\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
    const m = text.match(/<svg[\s\S]*?<\/svg>/i);
    if (!m) return '';
    // 안전 정화: 스크립트·이벤트 핸들러·외부 참조 제거
    return m[0]
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
      .replace(/\son\w+\s*=\s*'[^']*'/gi, '')
      .replace(/<image[\s\S]*?\/?>/gi, '')
      .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '');
  } catch (error) {
    console.error('SVG 생성 오류:', error.message);
    return '';
  }
}

async function generateStructuredCardAnalysis(articles, foreignArticles) {
  try {
    const koreanText = articles
      .map(a => `[${a.source}]\n제목: ${a.title}\n내용: ${a.description || ''}`)
      .join('\n\n---\n\n');

    const foreignText = (foreignArticles && foreignArticles.length)
      ? foreignArticles.map(a => `[${a.source}] ${a.title} :: ${a.description || ''}`).join('\n')
      : '(관련 외신 기사 없음)';

    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content:
`아래는 같은 사건을 다룬 한국 신문·방송 기사들입니다.
매체 정치 성향 참고 - 진보: 한겨레, 경향신문, 오마이뉴스, 프레시안, MBC / 보수: 조선일보, 동아일보, 매일경제, 중앙일보, 문화일보 / 그 외 매체는 성향을 단정하지 말 것.

[한국 기사]
${koreanText}

아래는 비슷한 시기의 외신(외국 언론) 기사 목록입니다. 위 한국 사건과 관련 있을 수도, 전혀 무관할 수도 있습니다.

[외신 기사]
${foreignText}

이 카드의 목적은 '같은 사건을 매체마다 어떻게 다르게 전하는가'를 독자가 한눈에 보도록 정제하는 것입니다.
위 내용을 분석해 아래 JSON 형식으로만 응답하세요. 코드블록(\`\`\`)이나 설명 없이 순수 JSON만 출력합니다.

{
  "headline": "이 사건을 사실만으로 압축한 중립적 카드 제목. 12~22자 내외. 매체의 평가·감정어·수사·낙인을 모두 배제하고, 어떤 사건인지를 누가/무엇이/어떻게의 사실 한 줄로 요약. 자극적 표현('충격', '경악', '결국'), 따옴표로 인용된 발언, 매체별 프레이밍 단어를 쓰지 않는다. 원기사 제목을 그대로 쓰거나 거의 똑같이 베끼지 않는다. 마침표·물음표·느낌표 없이 명사형으로 끝낸다.",
  "facts": ["어느 매체도 이견을 달지 않는, 검증 가능한 핵심 사실. 해석·평가·전망을 배제하고 '무슨 일이 있었는가'만. 숫자·날짜·고유명사 등 구체적으로. 항목당 한 문장, 최대 3개."],
  "coreIssue": "이 사건을 두고 매체들의 보도가 갈리는 '핵심 질문'이나 '쟁점'을 한 문장으로 기술. 어느 쪽 입장도 취하지 말고, 무엇을 두고 의견이 다른지만 짚는다. 한 진영 기사만 있어 비교할 게 없으면 빈 문자열.",
  "perspectives": {
    "progressive": "진보 성향 매체의 프레이밍. 이 사건의 무엇을 핵심 문제로 보는지, 원인과 책임을 어디에 두는지, 무엇을 부각하고 무엇을 덜 다루는지를 2~3문장으로 중립 기술. 진보 기사가 없으면 빈 문자열.",
    "conservative": "보수 성향 매체의 프레이밍. 같은 사건을 두고 무엇을 핵심 문제로 보는지, 원인과 책임을 어디에 두는지, 무엇을 부각하고 무엇을 덜 다루는지를 2~3문장으로 중립 기술. 보수 기사가 없으면 빈 문자열.",
    "foreign": "외신이 '위 한국 사건과 명백히 동일한 사건'을 다룬 경우에만, 외신이 이 사건을 어떤 관점에서 다뤘는지 2~3문장으로 기술. 관련 외신이 없으면 빈 문자열."
  },
  "foreignOutlets": ["위 외신 기사 목록 중 이 사건을 실제로 다룬 매체명만 그대로 적기. 없으면 빈 배열."],
  "prismThought": {
    "short": "'프리즘의 생각' 짧은 버전. 소리 내어 읽으면 약 1분 30초 분량(약 350~500자). 이 사건이 왜 중요한지, 보도가 정확히 '어느 지점에서' 갈리는지, 무엇을 눈여겨봐야 하는지를 차분하게 정리한다.",
    "long": "'프리즘의 생각' 긴 버전. 소리 내어 읽으면 약 5분 분량(약 1300~1800자). 배경과 맥락, 핵심 쟁점, 서로 다른 프레이밍이 생기는 이유, 아직 불확실한 점, 독자가 스스로 따져볼 질문까지 차분하게 풀어 설명한다. 문단은 빈 줄로 구분한다."
  }
}

원칙:
- 이 정제의 핵심은 '차이를 보이게 하는 것'이다. coreIssue는 progressive와 conservative가 서로 다르게 답하는 '같은 질문'을 명확히 짚는다. 이 한 문장이 두 관점의 대비를 한눈에 보여주는 축이 된다.
- progressive와 conservative는 그 coreIssue를 서로 다르게 바라보는 방식으로 써서, 독자가 두 글을 나란히 읽으면 '바로 여기서 갈리는구나'가 분명히 드러나게 한다. 서로 무관한 두 요약이 되어서는 안 된다.
- 어느 쪽이 옳은지 판단하지 말 것. 우열을 매기지 말고 차이 자체만 드러낼 것.
- facts(사실)와 perspectives(해석)를 명확히 분리할 것. 한쪽 매체만 주장하는 내용은 fact가 아니라 perspective다.
- 기사가 한 진영에 쏠려 있으면(예: 보수 기사만 있음) 반대쪽 perspective는 빈 문자열로 두고, 없는 시각을 지어내지 말 것.
- 외신 기사가 한국 사건과 무관하면 절대 foreign을 채우지 말 것. 목록에 없는 외신을 지어내지 말 것.
- prismThought(프리즘의 생각)는 어느 한쪽도 편들지 않는다. 사실과 여러 해석을 정리하고, 보도가 갈리는 지점을 짚어 독자가 스스로 판단하도록 돕는 차분하고 사려 깊은 해설이다.
- prismThought는 음성으로 읽히므로 자연스러운 구어체 줄글로 작성하고, 불릿이나 기호(•, -, * 등)를 쓰지 않는다.`
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

    const parsed = safeJsonParse(text);
    const p = parsed.perspectives || {};
    return {
      headline: (typeof parsed.headline === 'string') ? parsed.headline.trim() : '',
      facts: Array.isArray(parsed.facts) ? parsed.facts.slice(0, 3) : [],
      coreIssue: (typeof parsed.coreIssue === 'string') ? parsed.coreIssue : '',
      perspectives: {
        progressive: p.progressive || '',
        conservative: p.conservative || '',
        foreign: p.foreign || ''
      },
      foreignOutlets: Array.isArray(parsed.foreignOutlets) ? parsed.foreignOutlets : [],
      prismThought: {
        short: (parsed.prismThought && parsed.prismThought.short) || '',
        long: (parsed.prismThought && parsed.prismThought.long) || ''
      }
    };
  } catch (error) {
    console.error('Claude 구조화 분석 오류:', error.message);
    return null;
  }
}

// 뉴스 데이터 통합 및 정렬
// 최근 2주(14일)치를 모은다 - 클러스터링 재료이며, 카드 노출은 별도로 '전날' 기준으로 거른다
// 여러 소스(구글 뉴스, News API, 신문사 직접 RSS)의 배열을 인자로 받는다.
//
// ⚠️ 단순 "최신순 slice" 가 아닌 이유:
//   매체들이 새벽에도 오늘치 기사를 빠르게 올려 상한(120)이 전부 오늘로 채워지면,
//   카드 만들 대상인 '어제 KST' 기사가 한 건도 안 들어가는 사고가 난다.
//   → 어제·오늘 KST 기사는 무조건 전부 보존하고, 남는 자리만 옛 기사로 채운다.
function mergeAndSortArticles(...articleLists) {
  const merged = [].concat(...articleLists);
  const unique = [];
  const seen = new Set();
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000; // 2주 전 시각

  // 제목 정규화 - 공백·문장부호·기호만 제거한다.
  // 주의: \W 는 ASCII 전용이라 한글이 전부 지워진다. 유니코드 속성(\p{P},\p{S})을 써야 한다.
  const normTitle = (t) =>
    (t || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');

  merged.forEach(article => {
    const key = normTitle(article.title);
    if (article.title && key && !seen.has(key)) {
      // 2주보다 오래된 기사는 제외 (날짜 불명 기사는 포함)
      const t = article.pubDate ? new Date(article.pubDate).getTime() : NaN;
      if (!isNaN(t) && t < cutoff) return;
      seen.add(key);
      unique.push(article);
    }
  });

  // 최신순 정렬
  unique.sort((a, b) => {
    const dateA = new Date(a.pubDate || 0);
    const dateB = new Date(b.pubDate || 0);
    return dateB - dateA;
  });

  // 어제·오늘 KST 기사는 무조건 전부 보존 (카드 만들 핵심 재료)
  // 그 외 옛 기사는 남는 자리에 최신순으로 채운다 (같은 주제의 2주 흐름 맥락용)
  const todayKst = kstDateStr(new Date());
  const yesterdayKst = kstDateStr(new Date(Date.now() - 24 * 60 * 60 * 1000));

  const recent = [];
  const older = [];
  unique.forEach(a => {
    const k = kstDateStr(a.pubDate);
    if (k === todayKst || k === yesterdayKst) recent.push(a);
    else older.push(a);
  });

  const LIMIT = 300;
  const remaining = Math.max(0, LIMIT - recent.length);
  return [...recent, ...older.slice(0, remaining)];
}

// 안전한 날짜 포맷
function formatDate(value) {
  const d = new Date(value);
  const base = isNaN(d.getTime()) ? new Date() : d;
  return base.toLocaleDateString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit'
  });
}

// 한국 시간(KST) 기준 날짜 문자열 (YYYY-MM-DD) - "오늘" 비교용
function kstDateStr(value) {
  if (value == null || value === '') return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return new Date(d.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Claude가 지목한 외신 매체명으로 외신 풀에서 실제 기사 찾기
function matchForeignArticles(foreignOutlets, foreignPool) {
  const matched = [];
  const seenLinks = new Set();
  (foreignOutlets || []).forEach(name => {
    const lname = String(name).toLowerCase();
    foreignPool.forEach(article => {
      const lsrc = (article.source || '').toLowerCase();
      if ((lsrc.includes(lname) || lname.includes(lsrc)) && !seenLinks.has(article.link)) {
        seenLinks.add(article.link);
        matched.push(article);
      }
    });
  });
  return matched;
}

// 매일 새벽 자동 실행되는 크론 작업
// 분야별로 생성할 카드 수 (각 섹션 최대 5개)
const CARDS_PER_CATEGORY = 5;

async function generateDailyCards() {
  console.log('\n✨ [' + new Date().toLocaleString('ko-KR') + '] 자동 카드 생성 시작...');

  // 기존 카드를 먼저 로드한다.
  // - 분야별로 즉시 저장하므로, 어제 만든 카드는 새 카드로 덮어쓰기 전까지 유지된다.
  // - 도중에 서비스가 죽어도 이미 저장된 분야는 살아남는다.
  let allCards = {};
  if (fs.existsSync(CARDS_FILE)) {
    try {
      const prev = JSON.parse(fs.readFileSync(CARDS_FILE, 'utf-8'));
      if (prev && prev.cards) allCards = prev.cards;
    } catch (e) {
      allCards = {};
    }
  }

  // 한 분야 끝날 때마다 cards.json 에 즉시 반영하는 헬퍼
  const saveProgress = () => {
    try {
      fs.writeFileSync(CARDS_FILE, JSON.stringify({
        generatedAt: new Date().toISOString(),
        cards: allCards
      }, null, 2));
      const total = Object.values(allCards).flat().length;
      console.log(`   💾 cards.json 저장 (누적 ${total}장)`);
    } catch (error) {
      console.error('   ⚠️ 저장 오류:', error.message);
    }
  };

  const categories = Object.keys(categoryLabels);

  for (const category of categories) {
    console.log(`📰 ${categoryLabels[category]} 분야 처리 중...`);

    try {
      // 한국 뉴스 수집 (구글 뉴스 + 신문사 직접 RSS + News API)
      const googleNews = await fetchGoogleNews(categoryQueries[category]);
      const pressNews = await fetchKoreanPressNews(category);
      const apiNews = await fetchNewsAPIArticles(category);
      const articles = mergeAndSortArticles(googleNews, pressNews, apiNews);

      // 외신 풀 수집 (분야당 1회)
      // 외신 풀 = 영문 구글뉴스 + 외신 직접 RSS (NYT, CNN 등)
      const foreignGoogle = await fetchForeignNews(foreignQueries[category]);
      const foreignPress = await fetchForeignPressNews();
      const foreignPool = [...foreignGoogle, ...foreignPress];

      // 같은 기사 그룹화 (Claude 가 같은 주제끼리 묶음)
      // → 여러 신문이 다룬 = 다양한 시각이 있는 주제를 우선순위 앞으로 정렬
      const groups = await clusterArticlesWithClaude(articles);
      groups.sort((a, b) => groupDiversityScore(b) - groupDiversityScore(a));

      // 그 전날(어제, 한국 시간) 어느 매체든 다룬 주제만 카드로 내보낸다
      // (2주치로 묶어 맥락·다관점은 살리되, 전날 보도가 있는 주제만 노출)
      const targetDay = kstDateStr(new Date(Date.now() - 24 * 60 * 60 * 1000));
      const selected = groups.filter(group =>
        group.some(a => a.pubDate && kstDateStr(a.pubDate) === targetDay)
      );
      console.log(`   → 전날 보도된 주제 ${selected.length}개`);

      const cards = [];

      // 카드 생성 루프
      // - 목표: CARDS_PER_CATEGORY (5장)
      // - 헤드라인 생성에 실패해 카드가 빠질 수 있으므로, 최대 후보 수(MAX_CANDIDATES)까지
      //   계속 시도해서 목표 수를 채운다. 목표가 채워지면 즉시 중단해 Claude 호출 절약.
      const MAX_CANDIDATES = 10;
      const candidateLimit = Math.min(MAX_CANDIDATES, selected.length);

      for (let i = 0; i < candidateLimit; i++) {
        if (cards.length >= CARDS_PER_CATEGORY) break;  // 목표 채워지면 즉시 중단

        const group = selected[i];
        let structured = null;

        if (process.env.ANTHROPIC_API_KEY) {
          structured = await generateStructuredCardAnalysis(group, foreignPool);
        }

        // Claude 가 중립 헤드라인을 만들지 못한 카드(분석 실패·빈 응답 등)는 제외하고
        // 다음 후보로 넘어간다. PRISM 의 '사실만으로 짓는 제목' 원칙을 지키기 위해
        // 원기사 제목 폴백 대신 다른 그룹을 시도한다.
        if (!structured || !structured.headline) {
          console.log(`   - ${category} 후보 ${i+1} 스킵: 헤드라인 생성 실패`);
          continue;
        }

        const progressiveOutlets = [
          ...new Set(group.filter(a => getSide(a.source) === 'progressive').map(a => a.source))
        ];
        const conservativeOutlets = [
          ...new Set(group.filter(a => getSide(a.source) === 'conservative').map(a => a.source))
        ];

        const foreignOutlets = structured.foreignOutlets;
        const matchedForeign = matchForeignArticles(foreignOutlets, foreignPool);

        // 카드 대표 이미지 - 그룹에서 이미지가 있는 첫 기사 (한국 우선, 없으면 외신)
        const groupImage = group.map(a => a.image).find(Boolean) || '';
        const foreignImage = matchedForeign.map(a => a.image).find(Boolean) || '';
        let image = groupImage || foreignImage;
        let svg = '';
        // 이미지가 전혀 없으면 Claude 로 추상 SVG 일러스트 생성 (폴백)
        if (!image) {
          svg = await generateCardSvg(structured.headline, categoryLabels[category]);
        }

        cards.push({
          id: `${category}_${cards.length}_${Date.now()}`,
          category: category,
          categoryLabel: categoryLabels[category],
          // 카드 제목: Claude 가 사실만으로 압축한 중립 제목 (헤드라인 없으면 위에서 이미 제외됨)
          title: structured.headline,
          date: formatDate(group[0].pubDate),
          image: image,
          svg: svg,
          facts: structured.facts,
          coreIssue: structured.coreIssue,
          prismThought: structured.prismThought,
          perspectives: {
            progressive: {
              outlets: progressiveOutlets,
              framing: structured.perspectives.progressive
            },
            conservative: {
              outlets: conservativeOutlets,
              framing: structured.perspectives.conservative
            },
            foreign: {
              outlets: foreignOutlets,
              framing: structured.perspectives.foreign
            }
          },
          sources: [
            ...group.map(article => ({
              name: article.source,
              side: getSide(article.source),
              content: article.description || article.title,
              link: article.link
            })),
            ...matchedForeign.map(article => ({
              name: article.source,
              side: 'foreign',
              content: article.description || article.title,
              link: article.link
            }))
          ],
          createdAt: new Date().toISOString()
        });

        // API 요청 간 딜레이 (rate limiting)
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      allCards[category] = cards;
      console.log(`✅ ${categoryLabels[category]}: ${cards.length}개 카드 생성`);
      saveProgress(); // 분야 하나 끝날 때마다 즉시 디스크에 저장

    } catch (error) {
      console.error(`❌ ${categoryLabels[category]} 오류:`, error.message);
      // 새 카드 생성 실패 시 - 기존 분야 카드를 지우지 말고 그대로 둔다.
      // (allCards[category] = [] 로 덮어쓰면 이전 카드까지 잃음)
      if (!allCards[category]) allCards[category] = [];
      saveProgress();
    }
  }

  console.log(`\n🎉 자동 카드 생성 완료! (${CARDS_FILE})`);
  console.log(`총 ${Object.values(allCards).flat().length}개 카드`);
}

// 크론 작업 등록: 매일 새벽 03:00(한국 시간)에 실행
// - 그 전날 하루치 뉴스가 모두 쌓인 뒤, 어제치 기사로 카드를 만든다
cron.schedule('0 3 * * *', () => {
  generateDailyCards();
}, {
  timezone: 'Asia/Seoul'
});

console.log('⏰ 크론 작업 등록: 매일 새벽 3시에 자동 실행');

// API 엔드포인트: 오늘의 카드 조회
app.get('/api/cards', (req, res) => {
  try {
    if (!fs.existsSync(CARDS_FILE)) {
      return res.json({
        success: true,
        message: '아직 생성된 카드가 없습니다. 내일 새벽 3시에 자동 생성됩니다.',
        cards: {}
      });
    }
    const data = JSON.parse(fs.readFileSync(CARDS_FILE, 'utf-8'));
    res.json({ success: true, ...data });
  } catch (error) {
    console.error('카드 조회 오류:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// API 엔드포인트: 특정 분야의 카드 조회
app.get('/api/cards/:category', (req, res) => {
  try {
    const { category } = req.params;
    if (!fs.existsSync(CARDS_FILE)) {
      return res.json({ success: true, message: '아직 생성된 카드가 없습니다.', cards: [] });
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
    res.status(500).json({ success: false, error: error.message });
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
    const pressNews = await fetchKoreanPressNews(category);
    const apiNews = await fetchNewsAPIArticles(category);
    const articles = mergeAndSortArticles(googleNews, pressNews, apiNews);
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

    res.json({ success: true, articles: formattedArticles, total: formattedArticles.length });
  } catch (error) {
    console.error('API 오류:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 헬스체크
// ===== 진단용 엔드포인트 =====
// /api/diagnose/economy 등으로 호출하면 어느 단계에서 기사가 사라지는지 보여준다.
// 카드가 0개일 때 원인 추적용.
app.get('/api/diagnose/:category', async (req, res) => {
  const category = req.params.category;
  if (!categoryQueries.hasOwnProperty(category)) {
    return res.status(400).json({ error: '알 수 없는 분야', category });
  }
  try {
    const googleNews = await fetchGoogleNews(categoryQueries[category]);
    const pressNews = await fetchKoreanPressNews(category);
    const apiNews = await fetchNewsAPIArticles(category);
    const articles = mergeAndSortArticles(googleNews, pressNews, apiNews);

    const targetDay = kstDateStr(new Date(Date.now() - 24 * 60 * 60 * 1000));
    const today = kstDateStr(new Date());

    // 날짜별로 기사 몇 건씩 있는지
    const byKstDate = {};
    articles.forEach(a => {
      const k = kstDateStr(a.pubDate) || '(날짜없음)';
      byKstDate[k] = (byKstDate[k] || 0) + 1;
    });

    // 매체별 기사 수
    const bySource = {};
    articles.forEach(a => {
      bySource[a.source || '(없음)'] = (bySource[a.source || '(없음)'] || 0) + 1;
    });

    // 전날 기사 샘플 5개
    const yesterdayArticles = articles.filter(
      a => a.pubDate && kstDateStr(a.pubDate) === targetDay
    );

    res.json({
      category,
      now_kst: today,
      target_day_kst: targetDay,
      counts: {
        googleNews: googleNews.length,
        pressNews: pressNews.length,
        apiNews: apiNews.length,
        merged: articles.length,
        yesterday: yesterdayArticles.length
      },
      articles_by_kst_date: byKstDate,
      articles_by_source: bySource,
      yesterday_samples: yesterdayArticles.slice(0, 5).map(a => ({
        title: a.title,
        source: a.source,
        pubDate: a.pubDate,
        kstDate: kstDateStr(a.pubDate)
      })),
      all_samples: articles.slice(0, 3).map(a => ({
        title: a.title,
        source: a.source,
        pubDate: a.pubDate,
        kstDate: kstDateStr(a.pubDate)
      }))
    });
  } catch (e) {
    res.status(500).json({ error: e.message, stack: e.stack });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🚀 PRISM 뉴스 서버 실행 중: http://localhost:${PORT}`);
  console.log('📰 구글 뉴스(한국·외신) + News API + Claude 분석');
  console.log('⏰ 매일 새벽 3시에 자동 카드 생성');
  console.log(`\n📌 테스트: http://localhost:${PORT}/api/generate-now (GET/POST)\n`);
});
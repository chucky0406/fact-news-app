// ===================================================================
// RSS 피드 검증 스크립트
// 사용법:  D:\fact-news-app 폴더에서  ->  node test-feeds.js
// server.js 의 koreanPressFeeds 에 등록된 모든 RSS 주소가
// 실제로 살아있는지(파싱되는지, 최근 기사가 있는지) 확인한다.
// rss-parser 는 이미 설치돼 있으므로 추가 설치 불필요.
// ===================================================================

const Parser = require('rss-parser');

const parser = new Parser({
  timeout: 12000,
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    'Accept': 'application/rss+xml, application/xml, text/xml, */*;q=0.8',
    'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8'
  }
});

// server.js 의 koreanPressFeeds 와 동일한 목록 (general 피드만 검증)
const feeds = [
  // 기존 등록 매체
  ['조선일보',   'https://www.chosun.com/arc/outboundfeeds/rss/?outputType=xml'],
  ['매일경제',   'https://www.mk.co.kr/rss/40300001/'],
  ['한겨레',     'http://www.hani.co.kr/rss/'],
  ['오마이뉴스', 'https://rss.ohmynews.com/rss/ohmynews.xml'],
  ['프레시안',   'https://www.pressian.com/api/v3/site/rss/news'],
  ['SBS',        'https://news.sbs.co.kr/news/headlineRssFeed.do?plink=RSSREADER'],
  ['동아일보',   'https://rss.donga.com/total.xml'],
  ['경향신문',   'https://www.khan.co.kr/rss/rssdata/total_news.xml'],
  ['서울신문',   'https://www.seoul.co.kr/xml/rss/rss_top.xml'],
  // === 신규 추가 매체 ===
  ['한국경제',   'https://www.hankyung.com/feed/all-news'],
  ['연합뉴스',   'https://www.yna.co.kr/rss/news.xml'],
  ['머니투데이', 'https://rss.mt.co.kr/mt_news.xml'],
  ['뉴시스',     'https://newsis.com/RSS/sokbo.xml'],
  // === 외신 직접 RSS ===
  ['NYT',        'https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml'],
  ['CNN',        'http://rss.cnn.com/rss/edition.rss']
];

async function checkFeed(name, url) {
  try {
    const feed = await parser.parseURL(url);
    const count = feed.items ? feed.items.length : 0;
    if (count === 0) {
      return `△  ${name.padEnd(8)} 연결은 됐지만 기사 0건  (${url})`;
    }
    const first = feed.items[0];
    const date = first.pubDate || first.isoDate || '날짜없음';
    const title = (first.title || '').slice(0, 30);
    return `✅ ${name.padEnd(8)} 기사 ${String(count).padStart(3)}건  최신: ${date}\n` +
           `   └ "${title}..."`;
  } catch (err) {
    return `❌ ${name.padEnd(8)} 실패: ${err.message}  (${url})`;
  }
}

(async () => {
  console.log('\n===== PRISM RSS 피드 검증 =====\n');
  let ok = 0;
  let fail = 0;
  for (const [name, url] of feeds) {
    const result = await checkFeed(name, url);
    console.log(result);
    if (result.startsWith('✅')) ok++;
    else fail++;
  }
  console.log(`\n----- 결과: 정상 ${ok} / 문제 ${fail} (총 ${feeds.length}) -----\n`);
  if (fail > 0) {
    console.log('❌/△ 표시된 매체는 주소가 막혔거나 바뀐 것입니다.');
    console.log('해당 매체 이름을 알려주시면 server.js 에서 주소를 고치거나 제거합니다.\n');
  }
})();
import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import './CardSection.css';

// 백엔드 API 주소 (URL이 바뀌면 이 한 줄만 수정하면 됩니다)
const API_BASE = "https://fact-news-app-production.up.railway.app";

// 카드 매체별 해석 칸 (위에서부터 표시되는 순서)
// 정치 라벨('보수/진보')을 붙이지 않는다. 박스 머리에는 그 사건을 보도한
// 매체 이름만 표시하고, 분류는 독자에게 맡긴다. 해외 박스만 '해외' 표시를 단다.
const PERSPECTIVE_DEFS = [
  { key: 'conservative', cls: 'prism-conservative' },
  { key: 'progressive', cls: 'prism-progressive' },
  { key: 'foreign', cls: 'prism-foreign', marker: '해외' }
];

// 카드의 해석 풍부도 = 채워진 해석 칸(진보/보수/해외) 개수
const cardRichness = (card) => {
  const p = card.perspectives || {};
  return ['progressive', 'conservative', 'foreign']
    .filter((k) => p[k] && p[k].framing).length;
};

function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [category, setCategory] = useState('home');
  const [cards, setCards] = useState({});
  const [loading, setLoading] = useState(false);

  // 카드 영역 높이 (고정 헤더 아래 남은 화면을 꽉 채움)
  const cardFeedRef = useRef(null);
  const [feedHeight, setFeedHeight] = useState('calc(100vh - 110px)');

  const categoryLabels = {
    general: '종합',
    politics: '정치',
    economy: '경제',
    science: '과학/기술',
    health: '의료/건강',
    international: '국제',
    sports: '스포츠',
    culture: '문화',
    popular: '인기',
    cards: '오늘의 카드',
    about: 'PRISM 소개'
  };

  // 카드 가져오기 (/api/cards 는 모든 분야 카드를 한 번에 반환)
  const fetchCards = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/cards`);
      const data = await response.json();
      if (data.success) {
        setCards(data.cards || {});
      }
    } catch (error) {
      console.error('카드 조회 오류:', error);
      setCards({});
    } finally {
      setLoading(false);
    }
  };

  // 카테고리 변경 시 (about 외에는 모두 카드 데이터 사용)
  useEffect(() => {
    setMenuOpen(false);
    if (category === 'about' || category === 'home') return;
    fetchCards();
  }, [category]);

  // 카드 영역 높이 측정 (고정 헤더 높이를 빼고 남은 화면을 채움)
  useEffect(() => {
    if (category === 'about') return;

    const measure = () => {
      const el = cardFeedRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const h = window.innerHeight - top;
      if (h > 0) setFeedHeight(`${Math.round(h)}px`);
    };

    const raf = requestAnimationFrame(measure);
    window.addEventListener('resize', measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', measure);
    };
  }, [category, loading]);

  const handleMenuToggle = () => {
    setMenuOpen(!menuOpen);
  };

  const handleCategoryChange = (newCategory) => {
    setCategory(newCategory);
  };

  // 첫 페이지(홈) - 작은 회전 프리즘 + curated by FOREB
  const renderHomePage = () => (
    <div
      className="prism-home"
      ref={cardFeedRef}
      style={{ height: feedHeight }}
    >
      <div className="prism-home-mark" aria-hidden="true">
        <svg
          className="prism-spinner-svg"
          viewBox="0 0 48 48"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* 세 면(facet) - 빛을 받아 면마다 다른 스펙트럼 톤 */}
          <path d="M24 6 L8.4 33 L24 24 Z" fill="#8fd3ff" fillOpacity="0.30" />
          <path d="M24 6 L39.6 33 L24 24 Z" fill="#caa6ff" fillOpacity="0.30" />
          <path d="M8.4 33 L39.6 33 L24 24 Z" fill="#ffd9a0" fillOpacity="0.22" />
          {/* 내부 모서리 - 면 분할 */}
          <path
            d="M24 6 L24 24 M8.4 33 L24 24 M39.6 33 L24 24"
            stroke="#ffffff"
            strokeOpacity="0.32"
            strokeWidth="1"
            strokeLinecap="round"
          />
          {/* 바깥 윤곽 */}
          <path
            d="M24 6 L39.6 33 L8.4 33 Z"
            fill="none"
            stroke="#ffffff"
            strokeOpacity="0.92"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          {/* 유리 광택 (모서리 글린트) */}
          <path
            d="M24 6 L16.6 18.8"
            fill="none"
            stroke="#ffffff"
            strokeOpacity="0.95"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <div className="prism-home-credit">
        curated by <span className="foreb-mark">FOREB</span>
      </div>
    </div>
  );

  // About PRISM 페이지 - 컨셉 정리 (왜 → 어떻게 → 약속)
  const renderAboutPage = () => (
    <div className="prism-about">
      <section className="prism-about-section">
        <h2 className="prism-about-section-title">왜 PRISM인가</h2>
        <p className="prism-about-lead">
          언젠가부터 뉴스를 읽는 일이 피곤해졌습니다. 같은 사건을 두고 매체마다
          다른 이야기를 하고, 어느 쪽을 믿어야 할지 판단하는 데 더 많은 시간이
          듭니다.
        </p>
        <p className="prism-about-lead">
          PRISM은 그 피로감에서 출발했습니다. 어느 쪽이 옳다고 말하지 않습니다.
          같은 사건이 어떻게 다르게 전해지는지를 나란히 보여주고, 판단은 읽는
          사람의 몫으로 남겨둡니다.
        </p>
      </section>

      <section className="prism-about-section">
        <h2 className="prism-about-section-title">PRISM은 이렇게 봅니다</h2>
        <div className="prism-about-cards">
          <div className="prism-about-card">
            <div className="prism-about-card-icon">🔭</div>
            <h3 className="prism-about-card-title">매체별로 나란히</h3>
            <p className="prism-about-card-text">
              하나의 사건을 여러 매체가 각각 어떻게 보도했는지 한자리에 모읍니다.
              우리가 고르지 않고, 차이를 그대로 드러냅니다.
            </p>
          </div>
          <div className="prism-about-card">
            <div className="prism-about-card-icon">⚖️</div>
            <h3 className="prism-about-card-title">사실과 해석을 나눠서</h3>
            <p className="prism-about-card-text">
              '무슨 일이 있었나'와 '그것을 어떻게 볼까'를 분리합니다. 사실만
              빠르게 확인할 수도, 해석을 비교할 수도 있습니다.
            </p>
          </div>
          <div className="prism-about-card">
            <div className="prism-about-card-icon">🍃</div>
            <h3 className="prism-about-card-title">차분하게</h3>
            <p className="prism-about-card-text">
              자극적인 제목도, 편드는 어조도 없습니다. 싸움이 아니라 정보를
              전합니다.
            </p>
          </div>
          <div className="prism-about-card">
            <div className="prism-about-card-icon">🧭</div>
            <h3 className="prism-about-card-title">정치만이 아니라</h3>
            <p className="prism-about-card-text">
              경제, 과학, 문화까지. 매일 다양한 분야의 카드가 새로 만들어집니다.
              세상은 정치보다 넓습니다.
            </p>
          </div>
        </div>
      </section>

      <section className="prism-about-section">
        <h2 className="prism-about-section-title">우리의 약속</h2>
        <ul className="prism-about-promise">
          <li className="prism-about-promise-item">
            매체에 '보수'나 '진보' 같은 딱지를 붙이지 않습니다. 누가
            보도했는지만 보여주고, 분류는 읽는 사람의 몫으로 둡니다.
          </li>
          <li className="prism-about-promise-item">
            같은 사건을 여러 곳에서 다룰 때, 그 차이를 가리지 않고 그대로
            보여줍니다.
          </li>
          <li className="prism-about-promise-item">
            PRISM은 정답을 정해주지 않습니다. 더 넓게 볼 수 있는 자리를 만들
            뿐입니다.
          </li>
        </ul>
      </section>

      <div className="prism-about-footer">News beyond bias: for you and for your kids.</div>
      <div className="prism-about-credit">
        curated by <span className="foreb-mark">FOREB</span>
      </div>
    </div>
  );

  // 카드 한 장 렌더링 (한 페이지 = 한 카드, 세로 스크롤로 끝까지 읽음)
  const renderCardPage = (card) => {
    const activePerspectives = PERSPECTIVE_DEFS
      .map((def) => ({
        ...def,
        data: card.perspectives && card.perspectives[def.key]
      }))
      .filter((p) => {
        if (!p.data || !p.data.framing) return false;
        // 매체 이름이 곧 라벨이므로, 보도 매체가 없으면 표시하지 않는다
        // (해외 박스는 '해외' 표시가 있어 예외)
        const hasOutlets = p.data.outlets && p.data.outlets.length > 0;
        return hasOutlets || Boolean(p.marker);
      });

    const hasFacts = card.facts && card.facts.length > 0;

    return (
      <div className="prism-card-page" key={card.id}>
        <article className="prism-card">
          <div className="prism-card-top">
            <span className="prism-card-cat">
              {card.categoryLabel || categoryLabels[card.category] || ''}
            </span>
            <span className="prism-card-date">{card.date}</span>
          </div>

          <h2 className="prism-card-title">{card.title}</h2>

          {/* 확인된 사실 */}
          {hasFacts && (
            <div className="prism-fact-box">
              <div className="prism-section-label">📌 확인된 사실</div>
              <ul className="prism-fact-list">
                {card.facts.map((fact, idx) => (
                  <li key={idx}>{fact}</li>
                ))}
              </ul>
            </div>
          )}

          {/* 매체별 해석 - 박스 머리에 보도 매체 이름만 표시 (정치 라벨 없음) */}
          {activePerspectives.length > 0 && (
            <>
              <div className="prism-section-label prism-perspective-label">
                🔍 매체별 해석
              </div>
              <div className="prism-perspective-grid">
                {activePerspectives.map((p) => (
                  <div className={`prism-perspective ${p.cls}`} key={p.key}>
                    <div className="prism-perspective-head">
                      {p.marker && (
                        <span className="prism-perspective-marker">
                          {p.marker}
                        </span>
                      )}
                      {(p.data.outlets || []).length > 0 && (
                        <div className="prism-outlet-tags">
                          {p.data.outlets.map((outlet, idx) => (
                            <span key={idx} className="prism-outlet-tag">
                              {outlet}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <p className="prism-framing">{p.data.framing}</p>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* 구버전 데이터 호환: facts/perspectives 없이 analysis만 있을 때 */}
          {!hasFacts && activePerspectives.length === 0 && card.analysis && (
            <div className="prism-fact-box">
              <p className="prism-framing prism-framing-fallback">
                {card.analysis}
              </p>
            </div>
          )}

          {/* 원문 링크 */}
          {card.sources && card.sources.length > 0 && (
            <div className="prism-card-sources">
              {card.sources
                .filter((s) => s.link)
                .map((source, idx) => (
                  <a
                    key={idx}
                    href={source.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="prism-source-link"
                  >
                    {source.name} 원문 ↗
                  </a>
                ))}
            </div>
          )}
        </article>
      </div>
    );
  };

  // 카드 페이저 (가로 스와이프) - 분야 페이지 / 오늘의 카드 공통
  const renderCardPager = (cardList, emptyMessage) => {
    return (
      <div
        className="prism-card-pager"
        ref={cardFeedRef}
        style={{ height: feedHeight }}
      >
        {loading && (
          <div className="prism-card-loading">불러오는 중입니다...</div>
        )}
        {!loading && cardList.length === 0 && (
          <div className="prism-cards-empty-note">{emptyMessage}</div>
        )}
        {!loading &&
          cardList.length > 0 &&
          cardList.map((card) => renderCardPage(card))}
      </div>
    );
  };

  // 분야 페이지 - 이 분야의 카드만 가로 스와이프로 표시
  const renderCategoryPage = () => {
    // 해석이 풍부한 카드를 앞으로 정렬
    const categoryCards = [...(cards[category] || [])].sort(
      (a, b) => cardRichness(b) - cardRichness(a)
    );
    return renderCardPager(categoryCards, '이 분야의 카드는 아직 없습니다.');
  };

  // 오늘의 카드 - 모든 분야 카드를 가로 스와이프로 (해석 풍부한 순)
  const renderCardsPage = () => {
    const categoryOrder = [
      'general', 'politics', 'economy', 'science', 'health',
      'international', 'sports', 'culture', 'popular'
    ];

    const allCards = [];
    categoryOrder.forEach((cat) => {
      (cards[cat] || []).forEach((card) => allCards.push(card));
    });
    // 해석이 풍부한 카드를 앞으로 정렬
    allCards.sort((a, b) => cardRichness(b) - cardRichness(a));

    return renderCardPager(allCards, '아직 생성된 카드가 없습니다.');
  };

  return (
    <div className={`App${category === 'home' ? ' home' : ''}`}>
      {/* 네비게이션 바 */}
      <nav className="navbar">
        <div className="navbar-left">
          <button className="menu-btn" onClick={handleMenuToggle}>
            ☰
          </button>
          <button 
            className="prism-header-btn"
            onClick={() => handleCategoryChange('home')}
          >
            <div className="prism-header">
              <h1 className="prism-title">PRISM</h1>
              <p className="prism-subtitle">News beyond bias: for you and for your kids.</p>
            </div>
          </button>
        </div>
        <div className="navbar-center">
          {category !== 'home' && (
            <div className="prism-spinner" aria-hidden="true">
              <svg
                className="prism-spinner-svg"
                viewBox="0 0 48 48"
                xmlns="http://www.w3.org/2000/svg"
              >
                {/* 세 면(facet) - 빛을 받아 면마다 다른 스펙트럼 톤 */}
                <path d="M24 6 L8.4 33 L24 24 Z" fill="#8fd3ff" fillOpacity="0.30" />
                <path d="M24 6 L39.6 33 L24 24 Z" fill="#caa6ff" fillOpacity="0.30" />
                <path d="M8.4 33 L39.6 33 L24 24 Z" fill="#ffd9a0" fillOpacity="0.22" />
                {/* 내부 모서리 - 면 분할 */}
                <path
                  d="M24 6 L24 24 M8.4 33 L24 24 M39.6 33 L24 24"
                  stroke="#ffffff"
                  strokeOpacity="0.32"
                  strokeWidth="1"
                  strokeLinecap="round"
                />
                {/* 바깥 윤곽 */}
                <path
                  d="M24 6 L39.6 33 L8.4 33 Z"
                  fill="none"
                  stroke="#ffffff"
                  strokeOpacity="0.92"
                  strokeWidth="1.7"
                  strokeLinejoin="round"
                />
                {/* 유리 광택 (모서리 글린트) */}
                <path
                  d="M24 6 L16.6 18.8"
                  fill="none"
                  stroke="#ffffff"
                  strokeOpacity="0.95"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                />
              </svg>
            </div>
          )}
        </div>
        <div className="navbar-right">
          <button className="user-btn">👤</button>
        </div>
      </nav>

      {/* 카테고리 바 */}
      <div className={`category-bar ${category}`}>
        <div className="category-bar-text">
          {categoryLabels[category]}
        </div>
      </div>

      {/* 드롭다운 메뉴 */}
      {menuOpen && <div className="backdrop" onClick={handleMenuToggle}></div>}
      {menuOpen && (
        <div className="dropdown-menu">
          <button
            className={`dropdown-link ${category === 'general' ? 'active' : ''}`}
            onClick={() => handleCategoryChange('general')}
          >
            종합
          </button>
          <button
            className={`dropdown-link ${category === 'politics' ? 'active' : ''}`}
            onClick={() => handleCategoryChange('politics')}
          >
            정치
          </button>
          <button
            className={`dropdown-link ${category === 'economy' ? 'active' : ''}`}
            onClick={() => handleCategoryChange('economy')}
          >
            경제
          </button>
          <button
            className={`dropdown-link ${category === 'science' ? 'active' : ''}`}
            onClick={() => handleCategoryChange('science')}
          >
            과학/기술
          </button>
          <button
            className={`dropdown-link ${category === 'health' ? 'active' : ''}`}
            onClick={() => handleCategoryChange('health')}
          >
            의료/건강
          </button>
          <button
            className={`dropdown-link ${category === 'international' ? 'active' : ''}`}
            onClick={() => handleCategoryChange('international')}
          >
            국제
          </button>
          <button
            className={`dropdown-link ${category === 'sports' ? 'active' : ''}`}
            onClick={() => handleCategoryChange('sports')}
          >
            스포츠
          </button>
          <button
            className={`dropdown-link ${category === 'culture' ? 'active' : ''}`}
            onClick={() => handleCategoryChange('culture')}
          >
            문화
          </button>
          <button
            className={`dropdown-link ${category === 'popular' ? 'active' : ''}`}
            onClick={() => handleCategoryChange('popular')}
          >
            인기
          </button>

          <button
            className={`dropdown-link ${category === 'cards' ? 'active' : ''}`}
            onClick={() => handleCategoryChange('cards')}
          >
            오늘의 카드
          </button>

          <button
            className={`dropdown-about ${category === 'about' ? 'active' : ''}`}
            onClick={() => handleCategoryChange('about')}
          >
            PRISM 소개
          </button>
        </div>
      )}

      {/* 메인 콘텐츠 */}
      <div className={`main-content${category === 'home' ? ' home' : ''}`}>
        {category === 'home' && renderHomePage()}
        {category === 'about' && renderAboutPage()}
        {category === 'cards' && renderCardsPage()}
        {category !== 'home' &&
          category !== 'about' &&
          category !== 'cards' &&
          renderCategoryPage()}
      </div>
    </div>
  );
}

export default App;
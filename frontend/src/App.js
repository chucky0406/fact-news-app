import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import './CardSection.css';

// 백엔드 API 주소 (URL이 바뀌면 이 한 줄만 수정하면 됩니다)
const API_BASE = "https://fact-news-app-production.up.railway.app";

// 카드 매체별 해석 칸 정의 (진보 / 보수 / 해외)
const PERSPECTIVE_DEFS = [
  { key: 'progressive', label: '진보', cls: 'prism-progressive' },
  { key: 'conservative', label: '보수', cls: 'prism-conservative' },
  { key: 'foreign', label: '해외', cls: 'prism-foreign' }
];

function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [category, setCategory] = useState('general');
  const [articles, setArticles] = useState([]);
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
    cards: '오늘의 카드'
  };

  // 분야 데이터 (뉴스 + 카드) 한 번에 가져오기
  const fetchCategoryData = async (cat) => {
    setLoading(true);
    try {
      const [newsRes, cardsRes] = await Promise.all([
        fetch(`${API_BASE}/api/news?category=${cat}`).then((r) => r.json()).catch(() => null),
        fetch(`${API_BASE}/api/cards`).then((r) => r.json()).catch(() => null)
      ]);
      setArticles(newsRes && newsRes.success ? newsRes.articles || [] : []);
      if (cardsRes && cardsRes.success) {
        setCards(cardsRes.cards || {});
      }
    } catch (error) {
      console.error('데이터 조회 오류:', error);
      setArticles([]);
    } finally {
      setLoading(false);
    }
  };

  // 카드만 가져오기 ('오늘의 카드' 메뉴용)
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

  // 카테고리 변경 시
  useEffect(() => {
    setMenuOpen(false);

    if (category === 'about') return;
    if (category === 'cards') {
      fetchCards();
    } else {
      fetchCategoryData(category);
    }
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

  // About PRISM 페이지
  const renderAboutPage = () => (
    <div className="about-section">
      <div className="about-header">
        <h1 className="about-logo">PRISM</h1>
        <p className="about-tagline">세상을 바라보는 객관적인 시각</p>
      </div>
      <div className="about-content">
        <div className="about-card">
          <h3 className="about-card-title">🔍 다중 관점</h3>
          <p className="about-card-text">
            같은 사건을 여러 신문사의 관점에서 분석합니다. 
            객관적인 시각으로 뉴스의 전체 그림을 파악하세요.
          </p>
        </div>
        <div className="about-card">
          <h3 className="about-card-title">🤖 AI 분석</h3>
          <p className="about-card-text">
            Claude AI가 각 기사를 분석하여 객관적 요약과 
            신문사별 관점을 제시합니다.
          </p>
        </div>
        <div className="about-card">
          <h3 className="about-card-title">📰 통합 뉴스</h3>
          <p className="about-card-text">
            조선, 중앙, 경향, 한겨레, 동아 등 주요 신문사의 
            뉴스를 한곳에서 확인하세요.
          </p>
        </div>
        <div className="about-card">
          <h3 className="about-card-title">⚡ 실시간 업데이트</h3>
          <p className="about-card-text">
            매일 오전 5시에 자동으로 뉴스가 업데이트됩니다. 
            항상 최신 정보를 제공합니다.
          </p>
        </div>
        <div className="about-card">
          <h3 className="about-card-title">📊 카테고리별 분류</h3>
          <p className="about-card-text">
            종합, 정치, 경제, 과학/기술, 의료/건강, 국제, 
            스포츠, 문화 등 다양한 분야의 뉴스를 제공합니다.
          </p>
        </div>
        <div className="about-card">
          <h3 className="about-card-title">✨ 오늘의 카드</h3>
          <p className="about-card-text">
            매일 생성되는 특별한 카드에서 주요 사건들을 
            카테고리별로 한눈에 확인할 수 있습니다.
          </p>
        </div>
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
      .filter((p) => p.data && p.data.framing);

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

          {/* 매체별 해석 (진보 / 보수 / 해외) */}
          {activePerspectives.length > 0 && (
            <>
              <div className="prism-section-label prism-perspective-label">
                🔍 매체별 해석
              </div>
              <div className="prism-perspective-grid">
                {activePerspectives.map((p) => (
                  <div className={`prism-perspective ${p.cls}`} key={p.key}>
                    <div className="prism-perspective-head">
                      <span className="prism-side-label">{p.label}</span>
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

  // 뉴스 기사 목록 렌더링 (분야 페이지 하단)
  const renderNewsList = () => {
    if (articles.length === 0) {
      return <div className="prism-news-empty">불러온 뉴스가 없습니다.</div>;
    }
    return (
      <div className="news-grid">
        {articles.map((article, index) => (
          <div key={index} className="news-article">
            <h2 className="article-title">{article.title}</h2>
            <div className="article-meta">
              <span className="article-date">{article.date}</span>
            </div>

            {article.analysis && (
              <div className="summary-block">
                <div className="summary-title">📋 객관적 분석</div>
                <p className="summary-text">{article.analysis}</p>
              </div>
            )}

            <div className="article-sources">
              {article.sources.map((source, idx) => (
                <div key={idx} className="source-block">
                  <div className="source-header">
                    {source.link ? (
                      <a
                        href={source.link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="source-name-link"
                      >
                        {source.name}
                      </a>
                    ) : (
                      <span className="source-name">{source.name}</span>
                    )}
                  </div>
                  <p className="source-content">{source.content}</p>
                  {source.link && (
                    <a
                      href={source.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="source-link"
                    >
                      원문 보기 →
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  };

  // 분야 페이지 - 가로 스와이프 카드 + 그 아래 뉴스 목록
  const renderCategoryPage = () => {
    const categoryCards = cards[category] || [];

    return (
      <div
        className="prism-category-view"
        ref={cardFeedRef}
        style={{ height: feedHeight }}
      >
        {loading && (
          <div className="prism-card-loading">불러오는 중입니다...</div>
        )}

        {!loading && (
          <>
            {/* 이 분야의 카드 - 옆으로 넘기는 가로 스와이프 */}
            {categoryCards.length > 0 && (
              <div className="prism-card-pager">
                {categoryCards.map((card) => renderCardPage(card))}
              </div>
            )}

            {categoryCards.length === 0 && (
              <div className="prism-cards-empty-note">
                이 분야의 카드는 아직 없습니다.<br />
                아래에서 최신 뉴스를 확인하세요.
              </div>
            )}

            {/* 카드 아래 - 기존 뉴스 목록 */}
            <div className="prism-news-section">
              <div className="prism-news-heading">
                📰 {categoryLabels[category]} 최신 뉴스
              </div>
              {renderNewsList()}
            </div>
          </>
        )}
      </div>
    );
  };

  // 오늘의 카드 - 모든 분야 카드를 가로 스와이프로
  const renderCardsPage = () => {
    const categoryOrder = [
      'general', 'politics', 'economy', 'science', 'health',
      'international', 'sports', 'culture', 'popular'
    ];

    const allCards = [];
    categoryOrder.forEach((cat) => {
      (cards[cat] || []).forEach((card) => allCards.push(card));
    });

    if (loading || allCards.length === 0) {
      return (
        <div
          className="prism-card-pager"
          ref={cardFeedRef}
          style={{ height: feedHeight }}
        >
          <div className="prism-card-loading">
            {loading
              ? '카드를 불러오는 중입니다...'
              : '아직 생성된 카드가 없습니다.'}
          </div>
        </div>
      );
    }

    return (
      <div
        className="prism-card-pager"
        ref={cardFeedRef}
        style={{ height: feedHeight }}
      >
        {allCards.map((card) => renderCardPage(card))}
      </div>
    );
  };

  return (
    <div className="App">
      {/* 네비게이션 바 */}
      <nav className="navbar">
        <div className="navbar-left">
          <button className="menu-btn" onClick={handleMenuToggle}>
            ☰
          </button>
          <button 
            className="prism-header-btn"
            onClick={() => handleCategoryChange('general')}
          >
            <div className="prism-header">
              <h1 className="prism-title">PRISM</h1>
              <p className="prism-subtitle">세상을 바라보는 객관적인 시각</p>
            </div>
          </button>
        </div>
        <div className="navbar-center"></div>
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
          <div className="dropdown-search">
            🔍 검색 (준비 중)
          </div>

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
            📋 오늘의 카드
          </button>

          <button
            className="dropdown-about"
            onClick={() => handleCategoryChange('about')}
          >
            About PRISM
          </button>
        </div>
      )}

      {/* 메인 콘텐츠 */}
      <div className="main-content">
        {category === 'about' && renderAboutPage()}
        {category === 'cards' && renderCardsPage()}
        {category !== 'about' && category !== 'cards' && renderCategoryPage()}
      </div>
    </div>
  );
}

export default App;
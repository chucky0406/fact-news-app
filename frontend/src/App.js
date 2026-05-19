import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import './CardSection.css';

// 백엔드 API 주소 (URL이 바뀌면 이 한 줄만 수정하면 됩니다)
const API_BASE = "https://fact-news-app-production.up.railway.app";

function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [category, setCategory] = useState('general');
  const [articles, setArticles] = useState([]);
  const [cards, setCards] = useState({});
  const [loading, setLoading] = useState(false);

  // 카드 스와이프 피드 높이 (고정 헤더 아래 남은 화면을 꽉 채움)
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

  // 뉴스 데이터 가져오기
  const fetchNews = async (selectedCategory) => {
    setLoading(true);
    try {
      const response = await fetch(
        `${API_BASE}/api/news?category=${selectedCategory}`
      );
      const data = await response.json();
      if (data.success) {
        setArticles(data.articles || []);
      }
    } catch (error) {
      console.error('뉴스 조회 오류:', error);
      setArticles([]);
    } finally {
      setLoading(false);
    }
  };

  // 카드 데이터 가져오기
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
    
    if (category === 'cards') {
      fetchCards();
    } else {
      fetchNews(category);
    }
  }, [category]);

  // 카드 피드 높이 측정 (고정 헤더 높이를 빼고 남은 화면을 채움)
  useEffect(() => {
    if (category !== 'cards') return;

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

  // 뉴스 페이지 렌더링
  const renderNewsPage = () => (
    <div className="news-grid">
      {loading && <div className="loading">뉴스를 불러오는 중입니다...</div>}
      {!loading && articles.length === 0 && (
        <div className="loading">
          아직 불러온 뉴스가 없습니다.<br />
          나중에 다시 시도해주세요.
        </div>
      )}
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

  // 카드 페이지 렌더링 - 풀스크린 세로 스와이프 피드
  const renderCardsPage = () => {
    const categoryOrder = [
      'general', 'politics', 'economy', 'science', 'health',
      'international', 'sports', 'culture', 'popular'
    ];

    // 모든 분야의 카드를 한 줄로 펼침
    const allCards = [];
    categoryOrder.forEach((cat) => {
      (cards[cat] || []).forEach((card) => allCards.push(card));
    });

    return (
      <div
        className="prism-card-feed"
        ref={cardFeedRef}
        style={{ height: feedHeight }}
      >
        {loading && (
          <div className="prism-card-loading">카드를 불러오는 중입니다...</div>
        )}

        {!loading && allCards.length === 0 && (
          <div className="prism-card-loading">
            아직 생성된 카드가 없습니다.<br />
            매일 오전 5시에 자동 생성됩니다.
          </div>
        )}

        {!loading && allCards.map((card) => {
          const prog = card.perspectives && card.perspectives.progressive;
          const cons = card.perspectives && card.perspectives.conservative;
          const hasProg = !!(prog && prog.framing);
          const hasCons = !!(cons && cons.framing);

          return (
            <section className="prism-card-screen" key={card.id}>
              <article className="prism-card">
                <div className="prism-card-top">
                  <span className="prism-card-cat">
                    {card.categoryLabel || categoryLabels[card.category] || ''}
                  </span>
                  <span className="prism-card-date">{card.date}</span>
                </div>

                <h2 className="prism-card-title">{card.title}</h2>

                {/* 확인된 사실 */}
                {card.facts && card.facts.length > 0 && (
                  <div className="prism-fact-box">
                    <div className="prism-section-label">📌 확인된 사실</div>
                    <ul className="prism-fact-list">
                      {card.facts.map((fact, idx) => (
                        <li key={idx}>{fact}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* 매체별 해석 (좌·우 병치) */}
                {(hasProg || hasCons) && (
                  <>
                    <div className="prism-section-label prism-perspective-label">
                      🔍 매체별 해석
                    </div>
                    <div className="prism-perspective-grid">
                      {hasProg && (
                        <div className="prism-perspective prism-progressive">
                          {(prog.outlets || []).length > 0 && (
                            <div className="prism-outlet-tags">
                              {prog.outlets.map((outlet, idx) => (
                                <span key={idx} className="prism-outlet-tag">
                                  {outlet}
                                </span>
                              ))}
                            </div>
                          )}
                          <p className="prism-framing">{prog.framing}</p>
                        </div>
                      )}
                      {hasCons && (
                        <div className="prism-perspective prism-conservative">
                          {(cons.outlets || []).length > 0 && (
                            <div className="prism-outlet-tags">
                              {cons.outlets.map((outlet, idx) => (
                                <span key={idx} className="prism-outlet-tag">
                                  {outlet}
                                </span>
                              ))}
                            </div>
                          )}
                          <p className="prism-framing">{cons.framing}</p>
                        </div>
                      )}
                    </div>
                  </>
                )}

                {/* 구버전 데이터 호환: facts/perspectives 없이 analysis만 있을 때 */}
                {(!card.facts || card.facts.length === 0) &&
                  !hasProg && !hasCons && card.analysis && (
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
            </section>
          );
        })}
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
        {category !== 'about' && category !== 'cards' && renderNewsPage()}
      </div>
    </div>
  );
}

export default App;
import React, { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [category, setCategory] = useState('general');
  const [articles, setArticles] = useState([]);
  const [cards, setCards] = useState({});
  const [loading, setLoading] = useState(false);

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
        `http://localhost:3001/api/news?category=${selectedCategory}`
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
      const response = await fetch('http://localhost:3001/api/cards');
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

  // 카드 페이지 렌더링
  const renderCardsPage = () => {
    const categoryOrder = [
      'general', 'politics', 'economy', 'science', 'health',
      'international', 'sports', 'culture', 'popular'
    ];

    return (
      <div className="cards-section">
        <div className="cards-header">
          <h2>📋 오늘의 카드</h2>
          <p className="cards-date">
            생성일: {cards.generatedAt ? new Date(cards.generatedAt).toLocaleDateString('ko-KR') : '로딩 중...'}
          </p>
        </div>

        {loading && <div className="loading">카드를 불러오는 중입니다...</div>}

        {!loading && Object.keys(cards).length === 0 && (
          <div className="loading">
            아직 생성된 카드가 없습니다.<br />
            내일 오전 5시에 자동 생성됩니다.
          </div>
        )}

        {!loading && Object.keys(cards).length > 0 && (
          <div className="cards-container">
            {categoryOrder.map((cat) => {
              const categoryCards = cards[cat] || [];
              if (categoryCards.length === 0) return null;

              return (
                <div key={cat} className="category-cards">
                  <h3 className="category-cards-title">
                    {categoryLabels[cat]}
                  </h3>
                  <div className="cards-grid">
                    {categoryCards.map((card) => (
                      <div key={card.id} className="card-item">
                        <h4 className="card-title">{card.title}</h4>
                        <p className="card-date">{card.date}</p>

                        {card.analysis && (
                          <div className="card-analysis">
                            <p>{card.analysis}</p>
                          </div>
                        )}

                        <div className="card-sources">
                          {card.sources.map((source, idx) => (
                            <a
                              key={idx}
                              href={source.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="card-source-link"
                              title={source.name}
                            >
                              {source.name}
                            </a>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
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
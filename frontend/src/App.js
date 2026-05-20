import React, { useState, useEffect, useRef } from 'react';
import './App.css';
import './CardSection.css';

// 백엔드 API 주소 (URL이 바뀌면 이 한 줄만 수정하면 됩니다)
const API_BASE = "https://fact-news-app.onrender.com";

// 카드 매체별 해석 칸 (위에서부터 표시되는 순서)
// 정치 라벨('보수/진보')을 붙이지 않는다. 박스 머리에는 그 사건을 보도한
// 매체 이름만 표시하고, 분류는 독자에게 맡긴다. 해외 박스만 '해외' 표시를 단다.
const PERSPECTIVE_DEFS = [
  { key: 'conservative', cls: 'prism-conservative' },
  { key: 'progressive', cls: 'prism-progressive' },
  { key: 'foreign', cls: 'prism-foreign', marker: '해외' }
];

// 카드의 해석 풍부도 = 채워진 해석 칸(진보/보수/해외) 개수
// 카드 "내용 풍부함" 점수 - 관점 수 > 보도 매체 수 > 사실 수 > 해설 유무 순
const cardRichness = (card) => {
  const p = card.perspectives || {};
  const perspectives = ['progressive', 'conservative', 'foreign']
    .filter((k) => p[k] && p[k].framing).length;
  const sources = Array.isArray(card.sources) ? card.sources.length : 0;
  const facts = Array.isArray(card.facts) ? card.facts.length : 0;
  const t = card.prismThought || {};
  const hasThought = (t.short || t.long) ? 1 : 0;
  return perspectives * 1000 + sources * 20 + facts * 5 + hasThought;
};

// 프리즘의 생각 - 짧은(1분 30초)/긴(5분) 해설 + 음성으로 듣기
// 음성은 브라우저 내장 TTS(Web Speech API)를 사용한다.
function PrismThoughts({ thought }) {
  const shortText = (thought && thought.short) || '';
  const longText = (thought && thought.long) || '';
  const [version, setVersion] = useState(shortText ? 'short' : 'long');
  const [isPlaying, setIsPlaying] = useState(false);

  // 화면을 벗어나면 읽던 음성을 멈춘다
  useEffect(() => {
    return () => {
      if (window.speechSynthesis) window.speechSynthesis.cancel();
    };
  }, []);

  if (!shortText && !longText) return null;

  const text = version === 'short' ? shortText : longText;

  const stopAudio = () => {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    setIsPlaying(false);
  };

  const playAudio = () => {
    const synth = window.speechSynthesis;
    if (!synth) {
      alert('이 브라우저에서는 음성 듣기를 지원하지 않습니다.');
      return;
    }
    synth.cancel();
    // 긴 문장은 일부 기기(iOS 등)에서 끊길 수 있어 문장 단위로 나눠 재생
    const chunks = text
      .split(/(?<=[.!?])\s+|\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (chunks.length === 0) return;
    chunks.forEach((chunk, idx) => {
      const utter = new SpeechSynthesisUtterance(chunk);
      utter.lang = 'ko-KR';
      utter.rate = 1.0;
      if (idx === chunks.length - 1) {
        utter.onend = () => setIsPlaying(false);
      }
      utter.onerror = () => setIsPlaying(false);
      synth.speak(utter);
    });
    setIsPlaying(true);
  };

  const toggleAudio = () => {
    if (isPlaying) stopAudio();
    else playAudio();
  };

  const chooseVersion = (v) => {
    if (v === version) return;
    stopAudio();
    setVersion(v);
  };

  return (
    <div className="prism-thought-box">
      <div className="prism-section-label">🔮 프리즘의 생각</div>
      <div className="prism-thought-controls">
        <div className="prism-thought-tabs">
          <button
            className={`prism-thought-tab ${version === 'short' ? 'active' : ''}`}
            onClick={() => chooseVersion('short')}
            disabled={!shortText}
          >
            1분 30초
          </button>
          <button
            className={`prism-thought-tab ${version === 'long' ? 'active' : ''}`}
            onClick={() => chooseVersion('long')}
            disabled={!longText}
          >
            5분
          </button>
        </div>
        <button
          className={`prism-thought-listen ${isPlaying ? 'playing' : ''}`}
          onClick={toggleAudio}
        >
          {isPlaying ? '■ 정지' : '🔊 듣기'}
        </button>
      </div>
      <p className="prism-thought-text">{text}</p>
    </div>
  );
}

// Claude AI 워드마크 옆에 붙는 작은 4점 스파클 마크
// - inline SVG, currentColor 사용 → 부모 텍스트 색을 그대로 따른다
//   (홈에선 흰색 톤, About에선 어두운 회색 톤으로 자동 적용)
function ClaudeMark() {
  return (
    <svg
      className="claude-mark"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M12 2 L13.7 10.3 L22 12 L13.7 13.7 L12 22 L10.3 13.7 L2 12 L10.3 10.3 Z"
        fill="currentColor"
      />
    </svg>
  );
}

// 카드 위치 점 표시 - 카드가 많으면 현재 위치 중심의 창(window)으로 보여준다
function CardDots({ total, current }) {
  const MAX = 9;
  const cur = Math.min(Math.max(current, 0), Math.max(total - 1, 0));
  let start = 0;
  let count = total;
  if (total > MAX) {
    count = MAX;
    start = Math.min(Math.max(cur - Math.floor(MAX / 2), 0), total - MAX);
  }
  const moreLeft = start > 0;
  const moreRight = start + count < total;
  const dots = [];
  for (let i = start; i < start + count; i++) {
    let cls = 'prism-dot';
    if (i === cur) {
      cls += ' active';
    } else if (
      (i === start && moreLeft) ||
      (i === start + count - 1 && moreRight)
    ) {
      cls += ' edge';
    } else if (
      (i === start + 1 && moreLeft) ||
      (i === start + count - 2 && moreRight)
    ) {
      cls += ' near-edge';
    }
    dots.push(<span key={i} className={cls} />);
  }
  return <div className="prism-card-dots">{dots}</div>;
}

function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [category, setCategory] = useState('home');
  const [cards, setCards] = useState({});
  const [loading, setLoading] = useState(false);
  const [currentCardIndex, setCurrentCardIndex] = useState(0);

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
    cards: '오늘의뉴스',
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
    setCurrentCardIndex(0);
  };

  // 첫 페이지(홈) - 작은 회전 프리즘 + curated by Claude AI 크레딧
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
        curated by <ClaudeMark /> Claude AI
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
        <h2 className="prism-about-section-title">카드는 이렇게 만들어집니다</h2>
        <ol className="prism-about-steps">
          <li className="prism-about-step">
            <span className="prism-about-step-num">1</span>
            <div className="prism-about-step-body">
              <h3 className="prism-about-step-title">넓게 모읍니다</h3>
              <p className="prism-about-step-text">
                매일, 지난 2주 동안 여러 신문과 방송, 그리고 외신이 보도한
                기사를 분야별로 모읍니다.
              </p>
            </div>
          </li>
          <li className="prism-about-step">
            <span className="prism-about-step-num">2</span>
            <div className="prism-about-step-body">
              <h3 className="prism-about-step-title">같은 이야기끼리 묶습니다</h3>
              <p className="prism-about-step-text">
                날짜와 표현이 달라도 같은 사건을 다룬 기사들을 하나로
                묶습니다. 흩어진 보도가 한 흐름이 됩니다.
              </p>
            </div>
          </li>
          <li className="prism-about-step">
            <span className="prism-about-step-num">3</span>
            <div className="prism-about-step-body">
              <h3 className="prism-about-step-title">여러 곳이 다룬 이슈를 먼저</h3>
              <p className="prism-about-step-text">
                많은 매체가 동시에 다룬 사건일수록 그만큼 시각도 다양합니다.
                PRISM은 그런 이슈를 먼저 골라 카드로 만듭니다.
              </p>
            </div>
          </li>
          <li className="prism-about-step">
            <span className="prism-about-step-num">4</span>
            <div className="prism-about-step-body">
              <h3 className="prism-about-step-title">사실과 해석으로 정제합니다</h3>
              <p className="prism-about-step-text">
                정제의 결과로 한 장의 카드가 만들어집니다. 어느 매체도 이견을
                달지 않는 사실, 보도가 갈리는 핵심 지점, 진영별로 다른 해석,
                그리고 어느 편도 들지 않는 '프리즘의 생각'까지 — 같은 사건의
                여러 얼굴이 한 자리에 놓입니다.
              </p>
            </div>
          </li>
        </ol>
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
        curated by <ClaudeMark /> Claude AI
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

          {/* 대표 사진(있으면) - 제목 바로 아래에 작게 표시.
              사진이 없으면 Claude 가 만든 추상 SVG 폴백을 보여준다.
              둘 다 없으면 빈 자리 차지하지 않는다. */}
          {card.image ? (
            <div className="prism-card-cover">
              <img
                src={card.image}
                alt=""
                loading="lazy"
                onError={(e) => { e.currentTarget.parentElement.style.display = 'none'; }}
              />
            </div>
          ) : card.svg ? (
            <div
              className="prism-card-cover prism-card-cover-svg"
              dangerouslySetInnerHTML={{ __html: card.svg }}
            />
          ) : null}

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

          {/* 보도가 갈리는 지점 - 진영별 해석 위에 한 문장으로 쟁점을 명시 */}
          {card.coreIssue && activePerspectives.length > 0 && (
            <div className="prism-issue-box">
              <span className="prism-issue-label">⚖️ 보도가 갈리는 지점</span>
              <p className="prism-issue-text">{card.coreIssue}</p>
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

          {/* 프리즘의 생각 - 짧은/긴 버전 + 음성 듣기 */}
          <PrismThoughts thought={card.prismThought} />

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
    const handlePagerScroll = (e) => {
      const el = e.currentTarget;
      if (!el.clientWidth) return;
      setCurrentCardIndex(Math.round(el.scrollLeft / el.clientWidth));
    };
    return (
      <div className="prism-card-pager-wrap" style={{ height: feedHeight }}>
        <div
          className="prism-card-pager"
          ref={cardFeedRef}
          onScroll={handlePagerScroll}
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
        {!loading && cardList.length > 1 && (
          <CardDots total={cardList.length} current={currentCardIndex} />
        )}
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

  // 오늘의뉴스 - 모든 분야 카드를 내용이 풍부한 순으로 (가로 스와이프)
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
    <div className={`App ${category}`}>
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
            className={`dropdown-link ${category === 'cards' ? 'active' : ''}`}
            onClick={() => handleCategoryChange('cards')}
          >
            오늘의뉴스
          </button>
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
            className={`dropdown-about ${category === 'about' ? 'active' : ''}`}
            onClick={() => handleCategoryChange('about')}
          >
            PRISM 소개
          </button>
        </div>
      )}

      {/* 메인 콘텐츠 */}
      <div className={`main-content ${category}`}>
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
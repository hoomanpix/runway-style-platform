import { useState } from 'react';

const media = {
  hero: '/manus-storage/async-images/SSqW4mfpxndpBm6G6cF5LY/image-1.webp',
  avatar: '/manus-storage/async-images/SSqW4mfpxndpBm6G6cF5LY/image-2.webp',
  wardrobe: '/manus-storage/async-images/SSqW4mfpxndpBm6G6cF5LY/image-3.webp',
  runway: '/manus-storage/async-images/SSqW4mfpxndpBm6G6cF5LY/image-4.webp',
};

type IconName = 'arrow' | 'spark' | 'play' | 'plus' | 'menu' | 'close' | 'chevron';

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true } as const;
  if (name === 'arrow') return <svg {...common}><path d="M4 12h15M13 6l6 6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (name === 'chevron') return <svg {...common}><path d="m9 5 7 7-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (name === 'spark') return <svg {...common}><path d="M12 2.75 14 10l7.25 2-7.25 2-2 7.25L10 14l-7.25-2L10 10l2-7.25Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>;
  if (name === 'play') return <svg {...common}><path d="m9 6 9 6-9 6V6Z" fill="currentColor" /></svg>;
  if (name === 'plus') return <svg {...common}><path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>;
  if (name === 'close') return <svg {...common}><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>;
  return <svg {...common}><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>;
}

function Wordmark({ inverse = false }: { inverse?: boolean }) {
  return <span className={`wordmark${inverse ? ' wordmark--inverse' : ''}`} aria-label="Runway Style">RUNWAY <i>STYLE</i></span>;
}

function Eyebrow({ children, light = false }: { children: string; light?: boolean }) {
  return <p className={`eyebrow${light ? ' eyebrow--light' : ''}`}><span className="eyebrow__line" />{children}</p>;
}

function App() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedLook, setSelectedLook] = useState(0);
  const [runwayFrame, setRunwayFrame] = useState(1);

  const scrollTo = (id: string) => {
    setMenuOpen(false);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="site-shell">
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="site-header">
        <button className="mobile-menu-button" type="button" aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
          <Icon name={menuOpen ? 'close' : 'menu'} size={20} />
        </button>
        <button className="brand-button" type="button" onClick={() => scrollTo('top')}><Wordmark /></button>
        <nav className={`main-nav${menuOpen ? ' main-nav--open' : ''}`} aria-label="Main navigation">
          <button type="button" className="nav-link nav-link--active" aria-current="page" onClick={() => scrollTo('top')}>Home</button>
          <button type="button" className="nav-link" onClick={() => scrollTo('studio')}>Studio</button>
          <button type="button" className="nav-link" onClick={() => scrollTo('wardrobe')}>Wardrobe</button>
          <button type="button" className="nav-link" onClick={() => scrollTo('runway')}>Runway</button>
        </nav>
        <button className="text-button header-signin" type="button" onClick={() => scrollTo('create')}>Sign in</button>
      </header>

      <main id="main">
        <section id="top" className="hero section-anchor" aria-labelledby="hero-title">
          <img className="hero__image" src={media.hero} alt="Model wearing an ivory sculptural coat in a futuristic fashion pavilion" />
          <div className="hero__wash" />
          <div className="hero__content">
            <Eyebrow light>AI FASHION STUDIO / 01</Eyebrow>
            <h1 id="hero-title">Your style<br /><em>beyond reality.</em></h1>
            <p className="hero__intro">Create your avatar. Try on iconic looks.<br className="desktop-only" /> Walk the runway on your own terms.</p>
            <button className="button button--cream" type="button" onClick={() => scrollTo('create')}>Get started <Icon name="arrow" size={16} /></button>
          </div>
          <div className="hero__meta">
            <span>RUNWAY STYLE</span>
            <span>EST. 2025</span>
            <span className="hero__meta-rule" />
            <span>01 / 04</span>
          </div>
          <div className="hero__float-card" aria-label="Avatar creation preview">
            <div className="float-card__top"><span>Create your avatar</span><Icon name="spark" size={13} /></div>
            <div className="float-card__figures"><span className="figure figure--one" /><span className="figure figure--two" /><span className="figure figure--three" /></div>
            <button className="float-card__button" type="button" onClick={() => scrollTo('create')}>Start <Icon name="arrow" size={13} /></button>
          </div>
          <button className="hero__scroll" type="button" aria-label="Scroll to explore" onClick={() => scrollTo('manifesto')}><span>Scroll to explore</span><span className="hero__scroll-arrow">↓</span></button>
        </section>

        <section id="manifesto" className="manifesto section-anchor" aria-labelledby="manifesto-title">
          <div className="manifesto__aside"><span>THE NEW<br />DRESS CODE</span><span>02 / 04</span></div>
          <div className="manifesto__copy">
            <Eyebrow>THE DIGITAL WARDROBE</Eyebrow>
            <h2 id="manifesto-title">What you wear<br /><em>is how you move.</em></h2>
            <p>Runway Style gives your point of view a new body. Build a private avatar, discover pieces that feel like you, and see your next look before it enters the world.</p>
            <button className="text-link" type="button" onClick={() => scrollTo('create')}>Explore the studio <Icon name="arrow" size={16} /></button>
          </div>
          <div className="manifesto__image-wrap">
            <img src={media.avatar} alt="Editorial portrait of a model in a tailored blazer" />
            <span className="image-note">A PRIVATE SPACE<br />FOR YOUR STYLE</span>
          </div>
        </section>

        <section id="create" className="creation-section section-anchor" aria-labelledby="creation-title">
          <div className="section-heading">
            <div><Eyebrow>THE FIRST LOOK / 01</Eyebrow><h2 id="creation-title">Create your<br /><em>digital self.</em></h2></div>
            <p>Four considered views. One profile that moves with you.</p>
          </div>
          <div className="creation-flow">
            <article className="flow-card flow-card--intro"><span className="flow-index">01</span><div className="flow-card__icon"><Icon name="spark" size={20} /></div><h3>Start with you.</h3><p>Upload four simple views of your body. Your photos stay private, attached only to your account.</p><button className="button button--indigo" type="button" onClick={() => scrollTo('studio')}>Start upload <Icon name="arrow" size={15} /></button></article>
            <article className="flow-card flow-card--views"><span className="flow-index">02</span><div className="view-grid"><div><span className="view-silhouette view-silhouette--front" /><small>Front</small></div><div><span className="view-silhouette view-silhouette--side" /><small>Left</small></div><div><span className="view-silhouette view-silhouette--side view-silhouette--right" /><small>Right</small></div><div><span className="view-silhouette view-silhouette--back" /><small>Back</small></div></div><p className="flow-caption">Front / left / right / back</p></article>
            <article className="flow-card flow-card--status"><span className="flow-index">03</span><div className="status-ring"><strong>4</strong><span>of 4</span></div><h3>Ready when<br />you are.</h3><p>Avatar generation will be available once your photo profile is complete.</p><span className="status-pill"><i /> Photo setup available</span></article>
          </div>
        </section>

        <section id="studio" className="studio-section section-anchor" aria-labelledby="studio-title">
          <div className="studio-section__head"><div><Eyebrow light>THE STYLE STUDIO / 02</Eyebrow><h2 id="studio-title">Make the look<br /><em>your own.</em></h2></div><p>Browse the wardrobe. Compose a point of view.<br />The next look is already waiting.</p></div>
          <div className="studio-canvas">
            <div className="studio-canvas__image-wrap"><img src={media.wardrobe} alt="Curated neutral wardrobe pieces arranged in a fashion studio" /><div className="studio-canvas__overlay"><span>LOOK / 0{selectedLook + 1}</span><span>SS / 2025</span></div></div>
            <aside className="look-panel" aria-label="Look selector"><div className="look-panel__heading"><span>Selected pieces</span><span>0{selectedLook + 1} / 04</span></div><div className="look-list">{['The Essential', 'Soft Structure', 'After Hours', 'New Classic'].map((look, index) => <button key={look} type="button" className={`look-item${selectedLook === index ? ' look-item--selected' : ''}`} onClick={() => setSelectedLook(index)}><span className="look-item__number">0{index + 1}</span><span><strong>{look}</strong><small>{['Trench / Silk / Leather', 'Wool / Cotton / Suede', 'Velvet / Tailoring / Gold', 'Linen / Knit / Canvas'][index]}</small></span><Icon name="chevron" size={15} /></button>)}</div><button className="button button--cream button--full" type="button" onClick={() => scrollTo('runway')}>Preview on runway <Icon name="arrow" size={15} /></button><span className="panel-note"><Icon name="spark" size={12} /> Try-on preview / concept experience</span></aside>
          </div>
        </section>

        <section id="wardrobe" className="wardrobe-section section-anchor" aria-labelledby="wardrobe-title">
          <div className="wardrobe-section__left"><Eyebrow>THE WARDROBE / 03</Eyebrow><h2 id="wardrobe-title">Find the<br /><em>unexpected.</em></h2><p>A curated edit of silhouettes, textures and details made to be combined. Save what catches you.</p><button className="text-link" type="button" onClick={() => scrollTo('studio')}>Open wardrobe <Icon name="arrow" size={16} /></button></div>
          <div className="wardrobe-section__tiles"><div className="wardrobe-tile wardrobe-tile--tall"><span className="tile-label">01 / OUTERWEAR</span><span className="tile-title">Quiet<br />authority.</span></div><div className="wardrobe-tile wardrobe-tile--small"><span className="tile-label">02 / DETAILS</span><span className="tile-title">The final<br />gesture.</span></div><div className="wardrobe-tile wardrobe-tile--cream"><span className="tile-label">03 / YOUR EDIT</span><span className="tile-title">Make it<br /><em>yours.</em></span><Icon name="plus" size={20} /></div></div>
        </section>

        <section id="runway" className="runway-section section-anchor" aria-labelledby="runway-title">
          <div className="runway-section__head"><div><Eyebrow light>THE VIRTUAL RUNWAY / 04</Eyebrow><h2 id="runway-title">See it<br /><em>in motion.</em></h2></div><span className="runway-season">SPRING / SUMMER 2025</span></div>
          <div className="runway-stage"><img src={media.runway} alt="Model walking through a futuristic virtual runway" /><div className="runway-stage__shade" /><div className="runway-stage__copy"><Wordmark inverse /><p>Every look has a<br /><em>point of view.</em></p></div><div className="runway-stage__controls"><button type="button" aria-label="Previous runway frame" onClick={() => setRunwayFrame(runwayFrame === 1 ? 6 : runwayFrame - 1)}><span>←</span></button><span>{runwayFrame} / 06</span><button type="button" aria-label="Next runway frame" onClick={() => setRunwayFrame(runwayFrame === 6 ? 1 : runwayFrame + 1)}><span>→</span></button><button className="runway-play" type="button" aria-label="Play runway preview"><Icon name="play" size={13} /></button></div><div className="runway-stage__rail" aria-hidden="true"><span className="rail-active" style={{ width: `${(runwayFrame / 6) * 100}%` }} /></div></div>
        </section>
      </main>

      <footer className="site-footer"><div><Wordmark inverse /><p>Your style.<br />Our technology.<br /><em>A new reality.</em></p></div><div className="footer-links"><button type="button" onClick={() => scrollTo('top')}>Home</button><button type="button" onClick={() => scrollTo('studio')}>Studio</button><button type="button" onClick={() => scrollTo('wardrobe')}>Wardrobe</button><button type="button" onClick={() => scrollTo('runway')}>Runway</button></div><div className="footer-meta"><span>© 2025 RUNWAY STYLE</span><span>MADE FOR YOUR POINT OF VIEW</span></div></footer>
    </div>
  );
}

export default App;

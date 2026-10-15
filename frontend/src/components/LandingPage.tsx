import { useState, useEffect } from 'react';
import { APP_NAME } from '@/brand';
import {
  X,
  Download,

  Heart,
  Plus,
  ChevronDown,
  ArrowUpRight,
  Send,
} from 'lucide-react';

function LandingPage({ onDownload }: { onDownload: () => void }) {
  const [scrolled, setScrolled] = useState(false);
  const [isScrolling, setIsScrolling] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);

  useEffect(() => {
    let scrollEndTimer = 0;
    const onScroll = () => {
      setScrolled(window.scrollY > 20);
      setIsScrolling(true);
      window.clearTimeout(scrollEndTimer);
      scrollEndTimer = window.setTimeout(() => setIsScrolling(false), 360);
    };
    window.addEventListener('scroll', onScroll);
    return () => {
      window.clearTimeout(scrollEndTimer);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  const openInstall = () => setInstallOpen(true);

  return (
    <>
      <div className={`pc-page pc-theme-milk ${isScrolling ? 'pc-is-scrolling' : ''}`}>
        {/* Header */}
        <header className={`pc-header ${scrolled ? 'pc-header-scrolled' : ''}`}>
          <div className="pc-container">
            <nav className="pc-nav">
              <a href="#top" className="pc-wordmark">
                <img
                  src="/header/header-dark.svg"
                  alt={APP_NAME}
                  className="pc-wordmark-logo"
                />
              </a>

              <div className="pc-nav-links">
                <a href="#why" className="pc-nav-link">Why {APP_NAME}</a>
                <a href="#little" className="pc-nav-link">The little things</a>
                <a href="#faq" className="pc-nav-link">FAQ</a>
              </div>

              <div className="pc-nav-right">
                <button onClick={openInstall} className="pc-button pc-button-secondary" style={{ padding: '10px 18px' }}>
                  <Download className="w-3.5 h-3.5" />
                  Download
                </button>

                <button onClick={onDownload} className="pc-button pc-nav-cta">
                  Open Web App
                  <ArrowUpRight className="w-4 h-4" />
                </button>

                <button
                  className="pc-menu-button"
                  onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                  aria-label="Toggle navigation menu"
                >
                  <ChevronDown className="w-4 h-4" />
                </button>
              </div>
            </nav>
          </div>

          {/* Mobile Menu */}
          {mobileMenuOpen && (
            <div className="pc-container" style={{ position: 'relative' }}>
              <div className="pc-mobile-menu">
                <a href="#why" className="pc-nav-link" onClick={() => setMobileMenuOpen(false)}>Why {APP_NAME}</a>
                <a href="#little" className="pc-nav-link" onClick={() => setMobileMenuOpen(false)}>The little things</a>
                <a href="#faq" className="pc-nav-link" onClick={() => setMobileMenuOpen(false)}>FAQ</a>
                <button onClick={openInstall} className="pc-button pc-nav-cta" style={{ width: 'fit-content' }}>
                  Get the app
                  <ArrowUpRight className="w-4 h-4 ml-1" />
                </button>
              </div>
            </div>
          )}
        </header>

        {/* Hero Section */}
        <section className="pc-hero" id="top">
          <div className="pc-container">
            <div className="pc-hero-grid">
              <div className="pc-hero-copy">
                <p className="pc-kicker pc-mono">A CHAT APP BUILT FOR VOICE AND GIST</p>
                <h1 className="pc-hero-title">
                  Stop typing it out. <br />
                  <span className="pc-hero-accent-wrap">
                    <span className="pc-hero-accent">Just say it.</span>
                    <svg
                      className="pc-hero-underline"
                      viewBox="0 0 280 20"
                      fill="none"
                      preserveAspectRatio="none"
                    >
                      <path
                        d="M4 14 Q 140 2, 276 12"
                        stroke="#0F8A5F"
                        strokeWidth="5.5"
                        strokeLinecap="round"
                      />
                    </svg>
                  </span>
                </h1>
                <p className="pc-hero-intro">
                  Voice notes that keep the tone of your voice. Live rooms where your group can
                  just talk. Anonymous Mode the group votes on together, not one person's call.
                </p>
                <div className="pc-hero-actions">
                  <button onClick={onDownload} className="pc-button pc-button-primary">
                    Open Web App
                    <ArrowUpRight className="w-4 h-4" />
                  </button>
                  <button onClick={openInstall} className="pc-button pc-button-secondary">
                    <Download className="w-4 h-4" />
                    Download APK
                  </button>
                </div>
              </div>

              {/* Phone Mockup Stage */}
              <div className="pc-phone-stage">
                <div className="pc-orbit-bg"></div>
                {/* Floating ambient glow dots */}
                <div className="pc-glow-dot pc-glow-coral"></div>
                <div className="pc-glow-dot pc-glow-mint"></div>
                <div className="pc-glow-dot pc-glow-yellow"></div>

                <div className="pc-phone">
                  {/* Dynamic island pill notch */}
                  <div className="pc-phone-notch"></div>

                  <div className="pc-phone-top">
                    <span className="pc-phone-time">9:41</span>
                    <span className="pc-status pc-mono">online</span>
                  </div>

                  <div className="pc-phone-screen">
                    <div className="pc-chat-card-top">
                      <div className="pc-chat-title">the gist room</div>
                      <div className="pc-chat-members-bar">
                        <span className="pc-members-text">4 friends · awake now</span>
                        <div className="pc-member-avatars">
                          <span className="pc-mini-avatar pc-avatar-coral">M</span>
                          <span className="pc-mini-avatar pc-avatar-mint">S</span>
                          <span className="pc-mini-avatar pc-avatar-yellow">A</span>
                        </div>
                      </div>
                    </div>

                    <div className="pc-pulse-line">
                      <span className="pc-pulse-dot"></span>
                      conversation is glowing
                    </div>

                    <div className="pc-bubbles-list">
                      <div className="pc-bubble pc-bubble-other">
                        I found the tiny cinema you were talking about.
                        <span className="bubble-time">Mara · 9:38</span>
                      </div>
                      <div className="pc-bubble pc-bubble-mine">
                        The one with the red seats? Send me the pin.
                        <span className="bubble-time">you · 9:39</span>
                      </div>
                      <div className="pc-bubble pc-bubble-other">
                        Already there. It feels like a secret.
                        <span className="bubble-time">Mara · 9:40</span>
                      </div>
                    </div>

                    <div className="pc-composer">
                      <div className="pc-composer-left">
                        <Plus className="w-3.5 h-3.5 text-[#86808b]" />
                        <span className="pc-composer-placeholder">Say something...</span>
                      </div>
                      <div className="pc-composer-send">
                        <Send className="w-3 h-3 text-white fill-white" />
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          </div>

          {/* Scroll Cue */}
          <div className="pc-scroll-wander-cue">
            <span className="pc-wander-dash"></span>
            <span className="pc-mono">SCROLL TO WANDER</span>
          </div>
        </section>

        {/* Marquee Banner */}
        <div className="pc-marquee">
          <div className="pc-marquee-track">
            {[...Array(4)].map((_, i) => (
              <span key={i} className="pc-marquee-group">
                <span className="pc-marquee-item pc-text-coral">MADE FOR THE IN-BETWEEN</span>
                <span className="pc-marquee-item pc-text-muted">LESS NOISE</span>
                <span className="pc-marquee-item pc-text-coral">MORE SIGNAL</span>
                <span className="pc-marquee-item pc-text-mint">PRIVATE BY DEFAULT</span>
                <span className="pc-marquee-item pc-text-coral">MADE FOR THE IN-BETWEEN</span>
              </span>
            ))}
          </div>
        </div>

        {/* Section 01: The Idea */}
        <section className="pc-section" id="why">
          <div className="pc-container">
            <div className="pc-story-grid">
              <div>
                <p className="pc-kicker pc-mono">01 / THE IDEA</p>
                <h2 className="pc-section-title">
                  Your group chat deserves a <span className="pc-title-lilac">real room.</span>
                </h2>
              </div>
              <div className="pc-story-copy">
                <p className="pc-story-text">
                  Most messengers give a channel a megaphone and a group chat nowhere
                  to actually talk. {APP_NAME} gives every Channel its own Gist Room, so
                  broadcasts and real conversation both get the space they need.
                </p>
                <p className="pc-story-note">
                  Drop in for a quick voice note. Stay for the live room that follows.
                </p>
                {/* Coral arc stroke under story */}
                <div className="pc-story-arc-wrap">
                  <svg className="pc-story-arc" viewBox="0 0 240 32" fill="none">
                    <path
                      d="M6 28 C 70 4, 170 4, 234 28"
                      stroke="#0F8A5F"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
              </div>
            </div>

          </div>
        </section>

        {/* The Chatimall Rule Coral Banner */}
        <section className="pc-manifesto">
          <div className="pc-container">
            <div className="pc-manifesto-inner">
              <div className="pc-manifesto-left">
                <p className="pc-kicker pc-mono pc-manifesto-kicker">THE {APP_NAME.toUpperCase()} RULE</p>
              </div>
              <div className="pc-manifesto-right">
                <h2 className="pc-manifesto-headline">
                  More room for the <span className="pc-manifesto-white">voices in it.</span>
                </h2>
              </div>
            </div>
          </div>
        </section>

        {/* Section 02: Tiny rituals */}
        <section className="pc-section" id="little">
          <div className="pc-container">
            <div className="pc-story-grid">
              <div>
                <p className="pc-kicker pc-mono">02 / HOW IT FEELS</p>
                <h2 className="pc-section-title">
                  Built around the way <br />
                  <span className="pc-title-lilac">you actually talk.</span>
                </h2>
              </div>
              <div className="pc-story-copy">
                <p className="pc-story-text">
                  Not every thought needs a full message. Some just need a voice, a room,
                  or a vote.
                </p>
              </div>
            </div>

            {/* Moments grid */}
            <div className="pc-moments">
              <div className="pc-moment-grid">
                {/* Card 1: Look at this */}
                <div className="pc-moment">
                  <div className="pc-moment-visual">
                    <img
                      src="/images/voice-note.svg"
                      alt="A voice note with an audio waveform"
                      className="pc-moment-img"
                      loading="lazy"
                    />
                  </div>
                  <div className="pc-moment-badge">
                    <span className="pc-mono pc-moment-tag pc-tag-mint">01 / VOICE</span>
                  </div>
                  <h3 className="pc-moment-title">The quick voice note</h3>
                  <p className="pc-moment-desc">
                    Say it out loud instead. Record, send, and play voice notes right in your conversations.
                  </p>
                </div>

                {/* Card 2: Late night drift */}
                <div className="pc-moment">
                  <div className="pc-moment-visual">
                    <img
                      src="/images/gist-room.svg"
                      alt="Friends talking together in a live audio room"
                      className="pc-moment-img"
                      loading="lazy"
                    />
                  </div>
                  <div className="pc-moment-badge">
                    <span className="pc-mono pc-moment-tag pc-tag-yellow">02 / GIST ROOM</span>
                  </div>
                  <h3 className="pc-moment-title">The gist room</h3>
                  <p className="pc-moment-desc">
                    Drop into a live voice room with your group and just talk — no scheduling, no calendar invite.
                  </p>
                </div>

                {/* Card 3: Quiet check-in */}
                <div className="pc-moment">
                  <div className="pc-moment-visual">
                    <img
                      src="/images/anonymous-vote.svg"
                      alt="A private group vote placed in a ballot box"
                      className="pc-moment-img"
                      loading="lazy"
                    />
                  </div>
                  <div className="pc-moment-badge">
                    <span className="pc-mono pc-moment-tag pc-tag-coral">03 / ANONYMOUS</span>
                  </div>
                  <h3 className="pc-moment-title">The anonymous vote</h3>
                  <p className="pc-moment-desc">
                    Sometimes the group needs to speak freely. A vote turns it on together, no single person decides alone.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Quote Section */}
        <section className="pc-quote">
          <div className="pc-container">
            <div className="pc-quote-inner">
              <div className="pc-quote-icon">
                <svg viewBox="0 0 48 36" fill="none" className="w-12 h-9">
                  <path
                    d="M0 21.6C0 9.67 7.73 0 19.2 0V7.2C12.57 7.2 7.2 12.57 7.2 19.2H19.2V36H0V21.6ZM28.8 21.6C28.8 9.67 36.53 0 48 0V7.2C41.37 7.2 36 12.57 36 19.2H48V36H28.8V21.6Z"
                    fill="#0F8A5F"
                  />
                </svg>
              </div>
              <blockquote className="pc-quote-text">
                The best chats don't feel like apps. They feel like knocking on the right door.
              </blockquote>
              <div className="pc-quote-sig">
                <span className="pc-quote-dash"></span>
                <span className="pc-mono pc-quote-sig-text">the design brief, somewhere after midnight</span>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section className="pc-section" id="faq">
          <div className="pc-container">
            <p className="pc-kicker pc-mono">03 / GOOD QUESTIONS</p>
            <h2 className="pc-section-title">
              Before you <span className="pc-title-lilac">step inside.</span>
            </h2>
            <div className="pc-faq">
              <div className="pc-faq-list">
                <FAQItem
                  initialOpen={false}
                  q={`Is ${APP_NAME} available to use right now?`}
                  a={`Yes, ${APP_NAME} is completely ready and live! You can launch the full app immediately to chat with live replies, make calls, join broadcast channels, share status updates, and configure your privacy settings.`}
                />
                <FAQItem
                  q="What makes it different from a normal messenger?"
                  a={`${APP_NAME} is built around talking, not typing: send voice notes, vote to go anonymous together, and join a live Gist Room from every Channel.`}
                />
                <FAQItem
                  q="Can I make a group with my people?"
                  a="Yes. Start a Group, add the people you actually want to hear from, and give it a name that feels like yours."
                />
                <FAQItem
                  q="Is my conversation private?"
                  a="Your chats and groups are private by default. Anonymous Mode goes further: even during it, only you and our safety systems know who sent what — never the other members."
                />
              </div>
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="pc-final">
          <div className="pc-container">
            <div className="pc-final-inner">
              <div>
                <p className="pc-kicker pc-mono">YOUR NEXT FAVORITE ROOM</p>
                <h2 className="pc-final-headline">
                  Talk like you're <br />
                  <span className="pc-title-mint">actually there.</span>
                </h2>
                <p className="pc-final-copy">
                  {APP_NAME} is ready to carry around. Voice notes, live rooms, and groups
                  that protect anonymous voices — all in your pocket today.
                </p>
                <button onClick={openInstall} className="pc-button pc-button-primary" style={{ marginTop: '28px' }}>
                  <Download className="w-4 h-4" />
                  Get {APP_NAME}
                </button>
              </div>
              <div className="pc-final-aside">
                <p className="pc-final-aside-title">Bring one good person.</p>
                <p className="pc-final-aside-text">
                  The room works best when it starts small. Send them this page when you're ready.
                </p>
                <div className="pc-final-aside-heart">
                  <Heart className="w-4 h-4 text-[#0F8A5F]" />
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="pc-footer">
          <div className="pc-container">
            <div className="pc-footer-row">
              <a href="#top" className="pc-wordmark" style={{ fontSize: '1.05rem' }}>
                <img
                  src="/footer/footer-dark.svg"
                  alt={APP_NAME}
                  className="pc-wordmark-logo"
                />
              </a>
              <div className="pc-footer-links">
                <a href="#why" className="pc-nav-link">Why {APP_NAME}</a>
                <a href="#faq" className="pc-nav-link">FAQ</a>
                <a href="#top" className="pc-nav-link">Say hello</a>
              </div>
              <p className="pc-footer-copy pc-mono">© 2025 {APP_NAME.toLowerCase()} / made for the in-between</p>
            </div>
          </div>
        </footer>
      </div>

      {/* Install Dialog Modal */}
      {installOpen && (
        <div className="pc-install-overlay pc-theme-milk" onClick={() => setInstallOpen(false)}>
          <div className="pc-install-dialog" onClick={(e) => e.stopPropagation()}>
            <button className="pc-install-close" onClick={() => setInstallOpen(false)}>
              <X className="w-4 h-4" />
            </button>
            <p className="pc-kicker pc-mono">Take the room with you</p>
            <h2 className="pc-install-title">Choose your way in.</h2>
            <p className="pc-install-desc">
              {APP_NAME} is fully ready to use. Launch the complete application directly right now or install it on your device.
            </p>
            <div className="pc-install-grid">
              <button
                onClick={() => {
                  setInstallOpen(false);
                  onDownload();
                }}
                className="pc-install-option"
                data-testid="button-download-android"
              >
                <div>
                  <p className="pc-install-option-title">Launch {APP_NAME}</p>
                  <p className="pc-install-option-desc">Complete app · Instant access</p>
                </div>
                <span className="pc-install-go">Open app →</span>
              </button>
              <button
                onClick={() => {
                  setInstallOpen(false);
                  const link = document.createElement('a');
                  link.href = '/downloads/Chatimall.apk';
                  link.download = 'Chatimall.apk';
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                }}
                className="pc-install-option"
                data-testid="button-download-apk"
              >
                <div>
                  <p className="pc-install-option-title">Download Android APK</p>
                  <p className="pc-install-option-desc">Direct APK package · Instant file download</p>
                </div>
                <span className="pc-install-go">Download APK →</span>
              </button>
            </div>
            <div className="pc-install-qr">
              <div className="pc-qr-art"></div>
              <p className="pc-install-qr-text pc-mono">Scan QR to install on phone</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function FAQItem({ q, a, initialOpen = false }: { q: string; a: string; initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <div className="pc-faq-item">
      <button className="pc-faq-trigger" onClick={() => setOpen(!open)}>
        <span>{q}</span>
        {open ? (
          <X className="w-4 h-4 text-[#0F8A5F] pc-faq-toggle-icon transition-transform" />
        ) : (
          <ChevronDown className="w-4 h-4 text-[#0F8A5F] pc-faq-toggle-icon transition-transform" />
        )}
      </button>
      {open && <p className="pc-faq-answer">{a}</p>}
    </div>
  );
}

export default LandingPage;

// ==UserScript==
// @name         Auto YouTube Shorts Scroller
// @namespace    https://github.com/auto-shorts-scroller
// @version      2.1.0
// @description  Automatically scrolls to the next YouTube Short when one ends. Includes a sleek floating control panel with play/pause, delay settings, and skip controls.
// @author       Auto Shorts Scroller
// @match        https://www.youtube.com/shorts/*
// @match        https://www.youtube.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  // ─── Configuration (persisted via GM storage) ─────────────────────────────
  let CONFIG = {
    enabled:      GM_getValue('enabled',      true),
    delay:        GM_getValue('delay',        1500),   // ms after video ends before scrolling
    skipThreshold:GM_getValue('skipThreshold',0),      // % watched before skipping (0 = only on end)
    loopGuard:    GM_getValue('loopGuard',    true),   // prevent re-scrolling the same short
  };

  function saveConfig() {
    GM_setValue('enabled',       CONFIG.enabled);
    GM_setValue('delay',         CONFIG.delay);
    GM_setValue('skipThreshold', CONFIG.skipThreshold);
    GM_setValue('loopGuard',     CONFIG.loopGuard);
  }

  // ─── State ────────────────────────────────────────────────────────────────
  let lastScrolledShortId = null;
  let scrollTimeout        = null;
  let observer             = null;
  let videoObserver        = null;
  let currentVideo         = null;
  let progressInterval     = null;
  let uiProgressBar        = null;
  let uiCountdown          = null;
  let isPanelOpen          = false;

  // ─── Styles ───────────────────────────────────────────────────────────────
  GM_addStyle(`
    /* ── Floating toggle button ── */
    #ass-toggle {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 999999;
      width: 52px;
      height: 52px;
      border-radius: 50%;
      border: none;
      cursor: pointer;
      background: linear-gradient(135deg, #ff0040, #ff6b00);
      box-shadow: 0 4px 20px rgba(255, 0, 64, 0.45);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 22px;
      transition: transform 0.2s, box-shadow 0.2s;
      user-select: none;
    }
    #ass-toggle:hover  { transform: scale(1.1); box-shadow: 0 6px 28px rgba(255,0,64,.6); }
    #ass-toggle:active { transform: scale(0.95); }
    #ass-toggle.disabled {
      background: linear-gradient(135deg, #444, #222);
      box-shadow: 0 4px 14px rgba(0,0,0,.4);
    }

    /* ── Control panel ── */
    #ass-panel {
      position: fixed;
      bottom: 86px;
      right: 24px;
      z-index: 999998;
      width: 270px;
      background: #0d0d0d;
      border: 1px solid #2a2a2a;
      border-radius: 16px;
      padding: 18px;
      box-shadow: 0 16px 48px rgba(0,0,0,.7);
      font-family: 'Segoe UI', system-ui, sans-serif;
      color: #e8e8e8;
      transform-origin: bottom right;
      transform: scale(0.85) translateY(10px);
      opacity: 0;
      pointer-events: none;
      transition: transform 0.22s cubic-bezier(.34,1.56,.64,1), opacity 0.18s ease;
    }
    #ass-panel.open {
      transform: scale(1) translateY(0);
      opacity: 1;
      pointer-events: all;
    }

    /* header */
    #ass-panel .ass-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;
    }
    #ass-panel .ass-header .ass-logo {
      font-size: 18px;
    }
    #ass-panel .ass-header h3 {
      margin: 0;
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.03em;
      text-transform: uppercase;
      color: #fff;
      line-height: 1;
    }
    #ass-panel .ass-header small {
      font-size: 10px;
      color: #666;
      letter-spacing: 0.05em;
    }
    #ass-panel .ass-badge {
      margin-left: auto;
      background: #ff0040;
      color: #fff;
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.08em;
      padding: 2px 7px;
      border-radius: 20px;
      text-transform: uppercase;
    }
    #ass-panel .ass-badge.off { background: #333; color: #888; }

    /* divider */
    #ass-panel .ass-divider {
      border: none;
      border-top: 1px solid #1e1e1e;
      margin: 12px 0;
    }

    /* rows */
    #ass-panel .ass-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }
    #ass-panel .ass-label {
      font-size: 12px;
      color: #aaa;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    #ass-panel .ass-label span { font-size: 10px; color: #555; }

    /* toggle switch */
    .ass-switch {
      position: relative;
      width: 40px;
      height: 22px;
      flex-shrink: 0;
    }
    .ass-switch input { opacity: 0; width: 0; height: 0; }
    .ass-switch .slider {
      position: absolute;
      inset: 0;
      background: #2a2a2a;
      border-radius: 22px;
      cursor: pointer;
      transition: background 0.2s;
    }
    .ass-switch .slider:before {
      content: '';
      position: absolute;
      width: 16px; height: 16px;
      left: 3px; bottom: 3px;
      background: #666;
      border-radius: 50%;
      transition: transform 0.2s, background 0.2s;
    }
    .ass-switch input:checked + .slider { background: #ff0040; }
    .ass-switch input:checked + .slider:before { transform: translateX(18px); background: #fff; }

    /* number input */
    .ass-number {
      width: 70px;
      background: #1a1a1a;
      border: 1px solid #2e2e2e;
      border-radius: 8px;
      padding: 5px 8px;
      color: #fff;
      font-size: 12px;
      text-align: right;
      outline: none;
      transition: border-color 0.2s;
    }
    .ass-number:focus { border-color: #ff0040; }

    /* range slider */
    .ass-range {
      width: 100%;
      accent-color: #ff0040;
      margin-top: 4px;
      cursor: pointer;
    }

    /* action buttons */
    #ass-panel .ass-actions {
      display: flex;
      gap: 8px;
      margin-top: 4px;
    }
    #ass-panel .ass-btn {
      flex: 1;
      padding: 8px 0;
      border: none;
      border-radius: 8px;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.05em;
      cursor: pointer;
      text-transform: uppercase;
      transition: filter 0.15s, transform 0.1s;
    }
    #ass-panel .ass-btn:hover  { filter: brightness(1.2); }
    #ass-panel .ass-btn:active { transform: scale(0.96); }
    #ass-panel .ass-btn.primary   { background: #ff0040; color: #fff; }
    #ass-panel .ass-btn.secondary { background: #1e1e1e; color: #aaa; border: 1px solid #2e2e2e; }

    /* progress bar */
    #ass-panel .ass-progress-wrap {
      background: #1a1a1a;
      border-radius: 6px;
      height: 4px;
      overflow: hidden;
      margin-top: 14px;
    }
    #ass-panel .ass-progress-fill {
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, #ff0040, #ff6b00);
      border-radius: 6px;
      transition: width 0.3s linear;
    }
    #ass-panel .ass-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 6px;
    }
    #ass-panel .ass-footer small { font-size: 10px; color: #444; }
    #ass-panel .ass-countdown { font-size: 11px; color: #ff6b00; font-weight: 700; }
  `);

  // ─── Build UI ─────────────────────────────────────────────────────────────
  function buildUI() {
    // Floating button
    const btn = document.createElement('button');
    btn.id = 'ass-toggle';
    btn.title = 'Auto Shorts Scroller';
    btn.innerHTML = '⏭';
    if (!CONFIG.enabled) btn.classList.add('disabled');
    btn.addEventListener('click', togglePanel);
    document.body.appendChild(btn);

    // Panel
    const panel = document.createElement('div');
    panel.id = 'ass-panel';
    panel.innerHTML = `
      <div class="ass-header">
        <span class="ass-logo">⏭</span>
        <div>
          <h3>Auto Shorts Scroller</h3>
          <small>TAMPERMONKEY SCRIPT</small>
        </div>
        <span class="ass-badge ${CONFIG.enabled ? '' : 'off'}" id="ass-status-badge">
          ${CONFIG.enabled ? 'ON' : 'OFF'}
        </span>
      </div>

      <hr class="ass-divider">

      <!-- Master toggle -->
      <div class="ass-row">
        <div class="ass-label">
          Auto-scroll
          <span>Scroll when video ends</span>
        </div>
        <label class="ass-switch">
          <input type="checkbox" id="ass-enabled" ${CONFIG.enabled ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
      </div>

      <!-- Loop guard -->
      <div class="ass-row">
        <div class="ass-label">
          Loop guard
          <span>Prevent re-scrolling same Short</span>
        </div>
        <label class="ass-switch">
          <input type="checkbox" id="ass-loopguard" ${CONFIG.loopGuard ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
      </div>

      <hr class="ass-divider">

      <!-- Delay -->
      <div class="ass-row">
        <div class="ass-label">
          Scroll delay
          <span>Pause after video ends (ms)</span>
        </div>
        <input type="number" class="ass-number" id="ass-delay" value="${CONFIG.delay}" min="0" max="10000" step="100">
      </div>

      <!-- Skip threshold -->
      <div class="ass-label" style="margin-bottom:6px;">
        Skip threshold — <span id="ass-thresh-val">${CONFIG.skipThreshold}%</span>
        <span>Auto-scroll after watching this much (0 = end only)</span>
      </div>
      <input type="range" class="ass-range" id="ass-threshold" min="0" max="99" value="${CONFIG.skipThreshold}">

      <hr class="ass-divider">

      <!-- Action buttons -->
      <div class="ass-actions">
        <button class="ass-btn primary" id="ass-skip-btn">⏭ Skip Now</button>
        <button class="ass-btn secondary" id="ass-save-btn">💾 Save</button>
      </div>

      <!-- Progress / countdown -->
      <div class="ass-progress-wrap">
        <div class="ass-progress-fill" id="ass-progress"></div>
      </div>
      <div class="ass-footer">
        <small id="ass-status-text">Watching…</small>
        <span class="ass-countdown" id="ass-countdown"></span>
      </div>
    `;
    document.body.appendChild(panel);

    uiProgressBar = panel.querySelector('#ass-progress');
    uiCountdown   = panel.querySelector('#ass-countdown');

    // Wire events
    panel.querySelector('#ass-enabled').addEventListener('change', e => {
      CONFIG.enabled = e.target.checked;
      updateBadge();
      document.getElementById('ass-toggle').classList.toggle('disabled', !CONFIG.enabled);
      saveConfig();
      if (CONFIG.enabled) attachVideoListeners(); else detachVideoListeners();
    });

    panel.querySelector('#ass-loopguard').addEventListener('change', e => {
      CONFIG.loopGuard = e.target.checked; saveConfig();
    });

    panel.querySelector('#ass-delay').addEventListener('change', e => {
      CONFIG.delay = Math.max(0, parseInt(e.target.value) || 0); saveConfig();
    });

    panel.querySelector('#ass-threshold').addEventListener('input', e => {
      CONFIG.skipThreshold = parseInt(e.target.value);
      panel.querySelector('#ass-thresh-val').textContent = CONFIG.skipThreshold + '%';
    });
    panel.querySelector('#ass-threshold').addEventListener('change', () => saveConfig());

    panel.querySelector('#ass-skip-btn').addEventListener('click', () => {
      triggerScroll('manual');
    });

    panel.querySelector('#ass-save-btn').addEventListener('click', () => {
      saveConfig();
      const btn2 = panel.querySelector('#ass-save-btn');
      btn2.textContent = '✅ Saved!';
      setTimeout(() => btn2.textContent = '💾 Save', 1500);
    });
  }

  function togglePanel() {
    isPanelOpen = !isPanelOpen;
    document.getElementById('ass-panel').classList.toggle('open', isPanelOpen);
  }

  function updateBadge() {
    const badge = document.getElementById('ass-status-badge');
    if (!badge) return;
    badge.textContent = CONFIG.enabled ? 'ON' : 'OFF';
    badge.className = 'ass-badge' + (CONFIG.enabled ? '' : ' off');
  }

  function setStatusText(txt) {
    const el = document.getElementById('ass-status-text');
    if (el) el.textContent = txt;
  }

  // ─── Core: detect & watch Shorts video ───────────────────────────────────
  function isOnShorts() {
    return location.pathname.startsWith('/shorts/');
  }

  function getCurrentShortId() {
    const m = location.pathname.match(/\/shorts\/([^/?#]+)/);
    return m ? m[1] : null;
  }

  function findShortsVideo() {
    // The Shorts player video element
    return (
      document.querySelector('ytd-shorts video') ||
      document.querySelector('#shorts-container video') ||
      document.querySelector('ytd-reel-video-renderer video') ||
      document.querySelector('video.html5-main-video') ||
      document.querySelector('video')
    );
  }

  function scrollToNext(reason) {
    if (!isOnShorts()) return;
    const id = getCurrentShortId();
    if (CONFIG.loopGuard && id && id === lastScrolledShortId) {
      setStatusText('Already scrolled — loop guard active.');
      return;
    }
    lastScrolledShortId = id;
    setStatusText('Scrolling to next Short…');
    uiCountdown.textContent = '';

    // YouTube Shorts navigation — click the "next" button
    const nextBtn =
      document.querySelector('.navigation-button[aria-label="Next video"]') ||
      document.querySelector('ytd-shorts [aria-label="Next video"]') ||
      document.querySelector('ytd-shorts button.navigation-button:last-of-type') ||
      document.querySelector('#navigation-button-down button');

    if (nextBtn) {
      nextBtn.click();
    } else {
      // Fallback: simulate ArrowDown key (YouTube's keyboard shortcut)
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', keyCode: 40, bubbles: true }));
    }
  }

  function triggerScroll(reason) {
    if (!CONFIG.enabled) return;
    if (scrollTimeout) { clearTimeout(scrollTimeout); scrollTimeout = null; }
    if (CONFIG.delay > 0) {
      let remaining = CONFIG.delay;
      const tick = 100;
      uiCountdown.textContent = `${(remaining / 1000).toFixed(1)}s`;
      setStatusText('Video ended — scrolling soon…');
      const interval = setInterval(() => {
        remaining -= tick;
        uiCountdown.textContent = `${Math.max(0, remaining / 1000).toFixed(1)}s`;
        if (remaining <= 0) clearInterval(interval);
      }, tick);
      scrollTimeout = setTimeout(() => {
        clearInterval(interval);
        scrollToNext(reason);
      }, CONFIG.delay);
    } else {
      scrollToNext(reason);
    }
  }

  // ─── Video event listeners ────────────────────────────────────────────────
  function onVideoEnded() {
    triggerScroll('ended');
  }

  function onVideoTimeUpdate() {
    if (!currentVideo || !CONFIG.enabled) return;
    const { currentTime, duration } = currentVideo;
    if (!duration) return;

    const pct = (currentTime / duration) * 100;
    if (uiProgressBar) uiProgressBar.style.width = pct.toFixed(1) + '%';

    // Skip threshold check
    if (CONFIG.skipThreshold > 0 && pct >= CONFIG.skipThreshold && !scrollTimeout) {
      triggerScroll('threshold');
    }
  }

  function attachVideoListeners() {
    const video = findShortsVideo();
    if (!video || video === currentVideo) return;
    detachVideoListeners();

    currentVideo = video;
    currentVideo.addEventListener('ended',      onVideoEnded);
    currentVideo.addEventListener('timeupdate', onVideoTimeUpdate);
    setStatusText('Watching…');
    if (uiProgressBar) uiProgressBar.style.width = '0%';
    uiCountdown.textContent = '';
  }

  function detachVideoListeners() {
    if (!currentVideo) return;
    currentVideo.removeEventListener('ended',      onVideoEnded);
    currentVideo.removeEventListener('timeupdate', onVideoTimeUpdate);
    currentVideo = null;
  }

  // ─── Observe DOM for video / route changes ────────────────────────────────
  function observeDOM() {
    // Re-attach whenever a new video element appears (Shorts swaps <video>)
    videoObserver = new MutationObserver(() => {
      if (isOnShorts() && CONFIG.enabled) attachVideoListeners();
    });
    videoObserver.observe(document.body, { childList: true, subtree: true });
  }

  // Detect YouTube's SPA navigation (yt-navigate-finish / popstate)
  function onNavigate() {
    if (scrollTimeout) { clearTimeout(scrollTimeout); scrollTimeout = null; }
    uiCountdown.textContent = '';
    if (uiProgressBar) uiProgressBar.style.width = '0%';
    detachVideoListeners();
    if (isOnShorts() && CONFIG.enabled) {
      // Small delay for YouTube to render the new video element
      setTimeout(attachVideoListeners, 600);
    }
  }

  window.addEventListener('yt-navigate-finish', onNavigate);
  window.addEventListener('popstate',           onNavigate);

  // ─── Init ─────────────────────────────────────────────────────────────────
  function init() {
    if (document.getElementById('ass-panel')) return; // already injected
    buildUI();
    observeDOM();
    if (isOnShorts() && CONFIG.enabled) {
      setTimeout(attachVideoListeners, 800);
    }
  }

  // Wait for body
  if (document.body) {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }

})();

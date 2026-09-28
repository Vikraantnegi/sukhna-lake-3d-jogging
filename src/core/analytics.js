/* ------------------------------------------------------------------ *
 * Anonymous usage stats (PostHog), production only.
 *
 *   cookieless   persistence in memory: no cookies, no localStorage, so
 *                every visit is a new anonymous visitor and no consent
 *                banner is needed; no session recording, no autocapture,
 *                no surveys, no feature flags
 *   never        in dev, the playtest or the director (all dev-server
 *                runs), with ?notrack in the URL (the owner's own testing),
 *                in automated browsers or crawlers and link-preview bots,
 *                or with Do Not Track / Global Privacy Control on
 *   late         PostHog's script loads when the browser is idle after
 *                the page has loaded, so it never competes with the
 *                game's own download or its world build
 *   harmless     a blocked or failing script only means the queued
 *                events go nowhere: every call here is wrapped, and
 *                nothing in the game waits on it
 *
 * The project key is public by design (it ships in every page); it comes
 * from VITE_POSTHOG_KEY at build time (Vercel: Project Settings ->
 * Environment Variables).  Without it, analytics are simply off.
 * No personal data goes into any event.
 * ------------------------------------------------------------------ */

const KEY = import.meta.env.VITE_POSTHOG_KEY || '';
const HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://eu.i.posthog.com';

// crawlers, link-preview fetchers and headless browsers (most never run the page's scripts,
// but the ones that do would count as visits)
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|facebookcatalog|twitterbot|slackbot|discordbot|whatsapp|telegrambot|linkedinbot|embedly|headlesschrome|phantomjs|lighthouse|pagespeed/i;
const optedOut = () => {
  try {
    return new URLSearchParams(location.search).has('notrack') // (this page load only)
      || navigator.webdriver || (BOT.test(navigator.userAgent || '') && !/cubot/i.test(navigator.userAgent)) // (Cubot: a phone brand)
      || navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true;
  } catch { return true; }
};
const ON = import.meta.env.PROD && !!KEY && !optedOut();

const MAX_EVENTS = 600; // a runaway loop (or a blocked script's stub queue) can't grow without end
let sent = 0, loaded = false;
const early = []; // events from before the script is asked for

function load() {
  if (loaded) return;
  loaded = true;
  try {
    // PostHog's own snippet (posthog.com/docs/libraries/js): a stub that queues calls, and an
    // async <script> for the library, which replays the queue once it arrives
    /* eslint-disable */
    !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],Object.defineProperty(u,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e}}),Object.defineProperty(u.people,"toString",{configurable:!0,enumerable:!0,writable:!0,value:function(){return u.toString(1)+".people (stub)"}}),o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagResult isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
    /* eslint-enable */
    window.posthog.init(KEY, {
      api_host: HOST,
      defaults: '2026-05-30',
      persistence: 'memory',            // no cookies, no localStorage
      // a fresh random id for this page load only (what memory persistence means anyway; given
      // explicitly, PostHog doesn't warn about it in the console)
      bootstrap: { distinctID: crypto.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}` },
      person_profiles: 'identified_only', // and nobody is ever identified
      autocapture: false,
      capture_pageview: true,
      capture_pageleave: true,
      disable_session_recording: true,
      disable_surveys: true,
      advanced_disable_feature_flags: true,
      mask_all_text: true,
      mask_all_element_attributes: true,
    });
    // the campaign a visit came from (the short links in vercel.json: /x -> /?utm_source=x, ...):
    // PostHog reads these off the URL for its pageview; registered here, every event of the visit
    // carries them too (game_started, heartbeat, ...), which memory persistence wouldn't otherwise
    const campaign = {};
    for (const [k, v] of new URLSearchParams(location.search)) if (/^utm_(source|medium|campaign|content|term)$/.test(k) && v) campaign[k] = v.slice(0, 80);
    if (Object.keys(campaign).length) window.posthog.register(campaign);
    for (const [name, props] of early.splice(0)) window.posthog.capture(name, props);
  } catch { /* the game never depends on this */ }
}

if (ON) {
  const idle = () => (window.requestIdleCallback ? requestIdleCallback(load, { timeout: 5000 }) : setTimeout(load, 2000));
  if (document.readyState === 'complete') idle();
  else window.addEventListener('load', idle, { once: true });
}

/** One event (snake_case name, plain props: numbers, short strings, booleans; nothing personal). */
export function track(name, props = {}) {
  if (import.meta.env.DEV) (window.__analytics ||= []).push([name, props]); // (dev: what would be sent, for tests)
  if (!ON || sent >= MAX_EVENTS) return;
  sent++;
  try {
    if (!loaded) { if (early.length < 100) early.push([name, props]); return; }
    window.posthog?.capture?.(name, props);
  } catch { /* ignored */ }
}

/** 'phone', 'tablet' or 'desktop', from the pointer and the screen's short side. */
export function deviceType(touch) {
  if (!touch) return 'desktop';
  const short = Math.min(screen.width || innerWidth, screen.height || innerHeight);
  return short < 600 ? 'phone' : 'tablet';
}

/**
 * A heartbeat every 60 s of actual play (started, not paused, tab visible), so session
 * length can be measured without any persistent id.  `playing()` says whether play is on.
 */
export function heartbeat(playing, props = () => ({})) {
  if (!ON) return;
  let secs = 0, minutes = 0;
  setInterval(() => {
    try {
      if (document.hidden || !playing()) return;
      if (++secs >= 60) { secs = 0; track('heartbeat', { play_minutes: ++minutes, ...props() }); }
    } catch { /* ignored */ }
  }, 1000);
}

/**
 * Uncaught errors (a few per visit): message and script file name only, and only from this
 * site's own scripts.  Browser extensions throw into every page (a wallet's "Failed to connect
 * to MetaMask" from inpage.js, from chrome-extension://, moz-extension://,
 * safari-web-extension://...), as do other sites' scripts and inline or eval'd code with no
 * file at all; none of that is the game's, so none of it is sent.
 */
if (ON) {
  let errors = 0;
  const base = `${location.origin}/`;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // one of our scripts in a stack: "at f (https://site/assets/index-x.js:12:3)" or "f@https://site/assets/index-x.js:12:3"
  const OUR_FRAME = new RegExp(`${esc(base)}[^\\s()]*?\\.m?js(?:\\?[^\\s():]*)?:(\\d+)`);
  const ours = (file) => typeof file === 'string' && file.startsWith(base) && /\.m?js(?:[?#]|$)/.test(file);
  const fileName = (url) => url.split(/[?#]/)[0].split('/').pop().slice(0, 80);
  const report = (message, file, line) => {
    if (++errors > 5) return;
    track('error', { message: String(message || '').slice(0, 200), source: fileName(file), line: line || 0 });
  };
  window.addEventListener('error', (e) => { if (ours(e.filename)) report(e.message, e.filename, e.lineno); });
  window.addEventListener('unhandledrejection', (e) => {
    // a rejection carries no file of its own: report it only if its stack runs through our code
    const stack = typeof e.reason?.stack === 'string' ? e.reason.stack : '';
    const frame = stack.match(OUR_FRAME);
    if (frame) report(e.reason.message || String(e.reason), frame[0].replace(/:\d+$/, ''), +frame[1]);
  });
}

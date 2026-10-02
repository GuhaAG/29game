const fs = require('node:fs');
const { JSDOM } = require('jsdom');
const dom = new JSDOM(fs.readFileSync('design/applied.html', 'utf8'));
const document = dom.window.document;
document.documentElement.dataset.theme = 'dark';
document.title = '29 · Dark mode preview';
document.querySelector('.review-bar span').textContent = 'Dark mode preview · Sample game';
for (const header of document.querySelectorAll('.club-header')) {
  const controls = document.createElement('div');
  controls.className = 'header-controls';
  controls.append(header.querySelector('.club-private'));
  const toggle = document.createElement('button');
  toggle.className = 'theme-toggle';
  toggle.type = 'button';
  toggle.setAttribute('aria-label', 'Switch to light mode');
  toggle.title = 'Switch to light mode';
  toggle.innerHTML = '<svg class="sun-icon" aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg><svg class="moon-icon" aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z"/></svg>';
  controls.append(toggle);
  header.append(controls);
}
const style = document.createElement('style');
style.textContent = `
:root[data-theme="dark"] {
  color-scheme: dark;
  --bg:#111b17; --surface:#1b2922; --surface-alt:#25362c;
  --ink:#eeeade; --muted:#afbcaf; --line:#3a4c3f;
  --accent:#95cba7; --accent-ink:#112619;
  --danger:#ffa99b; --warning:#ecc789; --focus:#a3c9ff;
}
:root:not([data-theme="dark"]) { color-scheme:light; }
.header-controls { display:flex; align-items:center; gap:1.25rem; }
.theme-toggle { display:grid; place-items:center; width:44px; height:44px; padding:0; flex-shrink:0; background:transparent; color:var(--ink); border-color:transparent; border-radius:50%; }
.theme-toggle .sun-icon { display:none; }
[data-theme="dark"] .theme-toggle .sun-icon { display:block; }
[data-theme="dark"] .theme-toggle .moon-icon { display:none; }
[data-theme="dark"] button:not(.card):not([disabled]):hover { background:#304636; }
[data-theme="dark"] button.primary:not([disabled]):hover { background:#aeddbd; }
[data-theme="dark"] button[aria-pressed="true"]:not(.card):not(.theme-toggle) { color:var(--accent-ink); }
[data-theme="dark"] .status-line li:nth-last-child(-n+2),
[data-theme="dark"] .seat-list .is-you { background:#293e2e; }
[data-theme="dark"] .home-art { border-color:#2b3b30; box-shadow:inset 0 0 0 1px #d9c29345,0 16px 35px #0003; }
[data-theme="dark"] .table { border-color:#354539; box-shadow:inset 0 0 0 1px #d6bd8150,0 8px 25px #0003; }
.review-bar { background:var(--surface-alt); color:var(--ink); flex-wrap:wrap; }
.review-bar button { background:var(--surface); color:var(--ink); border-color:var(--line); }
@media(max-width:520px) {
  .header-controls { gap:.5rem; }
  .header-controls .club-private { display:none; }
}
`;
document.head.append(style);
const script = document.createElement('script');
script.textContent = `document.querySelectorAll('.theme-toggle').forEach(button=>button.onclick=()=>{
  const dark=document.documentElement.dataset.theme!=='dark';
  document.documentElement.dataset.theme=dark?'dark':'light';
  document.querySelectorAll('.theme-toggle').forEach(toggle=>{
    const label=dark?'Switch to light mode':'Switch to dark mode';
    toggle.setAttribute('aria-label',label);
    toggle.title=label;
  });
});`;
document.body.append(script);
fs.writeFileSync('design/dark-mode-preview.html', '<!doctype html>\n' + document.documentElement.outerHTML);
console.log('Created design/dark-mode-preview.html');

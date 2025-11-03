// scripts/extensions/third-party/EbbinghausHUD/index.js
(function () {
  const STORAGE_KEY = 'EbbinghausTrainerData_v3';
  let hud, timer;

  function read() {
    try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : null; }
    catch (_) { return null; }
  }

  function calc(db) {
    const sc = db?.Study_Control || {};
    const day = sc.Current_Day || 1, round = sc.Current_Round || 1;
    const key = 'Day_' + day;
    const b = db?.Vocabulary_Mastery?.[key] || {};
    const c = {
      L0: (b.Level_0_New || []).length,
      L1: (b.Level_1 || []).length,
      L2: (b.Level_2 || []).length,
      L3: (b.Level_3 || []).length,
      L4: (b.Level_4 || []).length,
      L5: (b.Level_5_Mastered_Today || []).length
    };
    const remaining = c.L0 + c.L1 + c.L2 + c.L3 + c.L4;
    const secPerItem = window.EbbHUD_SecPerItem || 6; // 估算速度
    const etaMin = Math.ceil((remaining * secPerItem) / 60);
    return { day, round, c, remaining, etaMin };
  }

  function mount() {
    if (hud) return;
    hud = document.createElement('div');
    hud.id = 'ebb-hud';
    hud.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483647;background:rgba(0,0,0,.78);color:#fff;padding:10px 12px;border-radius:14px;font:12px/1.4 system-ui;box-shadow:0 8px 22px rgba(0,0,0,.35);cursor:pointer;';
    hud.textContent = 'HUD…';
    hud.title = '点击折叠/展开';
    hud.addEventListener('click', () => {
      hud.dataset.min = hud.dataset.min === '1' ? '0' : '1';
      hud.style.opacity = hud.dataset.min === '1' ? '.35' : '1';
    });
    document.body.appendChild(hud);
  }

  function tick() {
    const db = read();
    if (!db) { if (hud) hud.textContent = 'HUD：未检测到词库'; return; }
    const s = calc(db);
    hud.innerHTML =
      `D${s.day}/R${s.round}｜剩${s.remaining}｜≈${s.etaMin}min<br>` +
      `L4:${s.c.L4} L3:${s.c.L3} L2:${s.c.L2} L1:${s.c.L1} L0:${s.c.L0}｜L5:${s.c.L5}`;
    if (s.etaMin > 120) { hud.style.filter = 'brightness(1.6)'; setTimeout(() => hud.style.filter = '', 600); }
  }

  function start() { mount(); tick(); clearInterval(timer); timer = setInterval(tick, 3000); }
  function stop() { clearInterval(timer); }

  start();
  window.EbbinghausHUD = { start, stop };
})();

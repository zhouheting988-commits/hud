// == Ebbinghaus HUD (ES5-compatible, standalone) ==
// 放到 public/scripts/extensions/third-party/hud/index.js
// 仅读取 localStorage，不改主插件；支持拖拽、折叠、长按/右键设置；记住位置与设置。

(function () {
  'use strict';

  // ---------- 默认与存储键 ----------
  var DEFAULTS = { secPerItem: 6, refreshSec: 3, zIndex: 2147483647 };
  var SETTINGS_KEY = 'EbbHUD.Settings';
  var POS_KEY = 'EbbHUD.Pos';
  var TRAIN_KEY = guessStorageKey();

  // ---------- 小工具 ----------
  function loadSettings() {
    try {
      var raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return copy(DEFAULTS);
      var p = JSON.parse(raw);
      return {
        secPerItem: Number(p.secPerItem) || DEFAULTS.secPerItem,
        refreshSec: Math.max(1, Number(p.refreshSec) || DEFAULTS.refreshSec),
        zIndex: Number(p.zIndex) || DEFAULTS.zIndex
      };
    } catch (e) { return copy(DEFAULTS); }
  }
  function saveSettings(s) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) {} }

  function loadPos() {
    try {
      var raw = localStorage.getItem(POS_KEY);
      if (!raw) return { right: 12, bottom: 12 };
      var p = JSON.parse(raw);
      return { right: Number(p.right) || 12, bottom: Number(p.bottom) || 12 };
    } catch (e) { return { right: 12, bottom: 12 }; }
  }
  function savePos(p) { try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch (e) {} }

  function copy(obj) { return JSON.parse(JSON.stringify(obj)); }

  function guessStorageKey() {
    try {
      if (localStorage.getItem('EbbinghausTrainerData_v3')) return 'EbbinghausTrainerData_v3';
      var i, k;
      for (i = 0; i < localStorage.length; i++) {
        k = localStorage.key(i);
        if (/^EbbinghausTrainerData/.test(k)) return k;
      }
    } catch (e) {}
    return 'EbbinghausTrainerData_v3';
  }

  function readTrainData() {
    try {
      var raw = localStorage.getItem(TRAIN_KEY);
      if (!raw) {
        TRAIN_KEY = guessStorageKey();
        raw = localStorage.getItem(TRAIN_KEY);
      }
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  // 计算今日快照
  function calcSnapshot(db, secPerItem) {
    if (!db) return { text: 'HUD：未检测到词库', danger: false };

    var sc = db.Study_Control || {};
    var day = sc.Current_Day || 1;
    var round = sc.Current_Round || 1;
    var key = 'Day_' + day;
    var vm = (db.Vocabulary_Mastery && db.Vocabulary_Mastery[key]) ? db.Vocabulary_Mastery[key] : null;

    if (!vm) {
      return {
        text: 'D' + day + '/R' + round + '｜未检测到今日词桶\nL4:0 L3:0 L2:0 L1:0 L0:0｜L5:0',
        danger: false
      };
    }

    var c = {
      L0: (vm.Level_0_New || []).length,
      L1: (vm.Level_1 || []).length,
      L2: (vm.Level_2 || []).length,
      L3: (vm.Level_3 || []).length,
      L4: (vm.Level_4 || []).length,
      L5: (vm.Level_5_Mastered_Today || []).length
    };
    var remaining = c.L0 + c.L1 + c.L2 + c.L3 + c.L4;
    var sec = Math.max(1, secPerItem || 6);
    var etaMin = Math.ceil((remaining * sec) / 60);

    var line1 = 'D' + day + '/R' + round + '｜剩' + remaining + '｜≈' + etaMin + 'min';
    var line2 = 'L4:' + c.L4 + ' L3:' + c.L3 + ' L2:' + c.L2 + ' L1:' + c.L1 + ' L0:' + c.L0 + '｜L5:' + c.L5;
    return { text: line1 + '\n' + line2, danger: etaMin > 120 };
  }

  // ---------- DOM ----------
  var hud = null, timer = null, settings = loadSettings(), dragging = false;

  function injectStyle(zIndex) {
    if (document.getElementById('ebb-hud-style')) return;
    var css =
      '@keyframes ebb-blink{50%{filter:brightness(1.65)}}' +
      '#ebb-hud{position:fixed;right:12px;bottom:12px;z-index:' + zIndex +
      ';background:rgba(0,0,0,.78);color:#fff;padding:10px 12px;border-radius:14px;font:12px/1.45 system-ui,-apple-system,Segoe UI,Roboto,Arial;box-shadow:0 8px 22px rgba(0,0,0,.35);user-select:none;white-space:pre;cursor:grab;transition:opacity .2s ease;}' +
      '#ebb-hud[data-min="1"]{opacity:.35}';
    var s = document.createElement('style');
    s.id = 'ebb-hud-style';
    s.type = 'text/css';
    s.appendChild(document.createTextNode(css));
    document.head.appendChild(s);
  }

  function mount() {
    if (hud) return;
    injectStyle(settings.zIndex);

    hud = document.createElement('div');
    hud.id = 'ebb-hud';
    hud.style.zIndex = String(settings.zIndex);
    hud.textContent = 'HUD…';

    var pos = loadPos();
    hud.style.right = (pos.right || 12) + 'px';
    hud.style.bottom = (pos.bottom || 12) + 'px';

    // 点击：折叠/展开（Alt+Click 打开设置）
    hud.addEventListener('click', function (e) {
      if (dragging) return;
      if (e && e.altKey) return openSettings();
      hud.setAttribute('data-min', hud.getAttribute('data-min') === '1' ? '0' : '1');
    });

    // 右键：设置
    hud.addEventListener('contextmenu', function (e) { e.preventDefault(); openSettings(); });

    // 拖拽（鼠标）
    var startX = 0, startY = 0, startRight = 0, startBottom = 0;
    function onMouseMove(e) {
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 3) dragging = true;
      var r = Math.max(6, startRight - dx);
      var b = Math.max(6, startBottom - dy);
      hud.style.right = r + 'px';
      hud.style.bottom = b + 'px';
    }
    function onMouseUp() {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      if (dragging) {
        savePos({ right: parseInt(hud.style.right, 10) || 12, bottom: parseInt(hud.style.bottom, 10) || 12 });
        setTimeout(function () { dragging = false; }, 50);
      }
      hud.style.cursor = 'grab';
    }
    hud.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      dragging = false;
      hud.style.cursor = 'grabbing';
      startX = e.clientX; startY = e.clientY;
      startRight = parseInt(hud.style.right, 10) || 12;
      startBottom = parseInt(hud.style.bottom, 10) || 12;
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });

    // 拖拽（触摸 + 长按设置）
    var pressTimer = null, longPressed = false;
    hud.addEventListener('touchstart', function (e) {
      dragging = false; longPressed = false;
      var t = e.touches && e.touches[0] ? e.touches[0] : { clientX: 0, clientY: 0 };
      startX = t.clientX; startY = t.clientY;
      startRight = parseInt(hud.style.right, 10) || 12;
      startBottom = parseInt(hud.style.bottom, 10) || 12;
      pressTimer = setTimeout(function () { longPressed = true; openSettings(); }, 600);
    }, { passive: true });

    hud.addEventListener('touchmove', function (e) {
      var t = e.touches && e.touches[0] ? e.touches[0] : { clientX: 0, clientY: 0 };
      var dx = t.clientX - startX;
      var dy = t.clientY - startY;
      if (Math.abs(dx) + Math.abs(dy) > 4) {
        dragging = true;
        clearTimeout(pressTimer);
        var r = Math.max(6, startRight - dx);
        var b = Math.max(6, startBottom - dy);
        hud.style.right = r + 'px';
        hud.style.bottom = b + 'px';
      }
    }, { passive: true });

    hud.addEventListener('touchend', function () { clearTimeout(pressTimer); });

    document.body.appendChild(hud);
  }

  function openSettings() {
    var s = loadSettings();
    var sec = prompt('每题估算秒数？', String(s.secPerItem));
    if (sec !== null && sec !== '') s.secPerItem = Math.max(1, Number(sec) || s.secPerItem);
    var ref = prompt('刷新间隔秒？', String(s.refreshSec));
    if (ref !== null && ref !== '') s.refreshSec = Math.max(1, Number(ref) || s.refreshSec);
    var z = prompt('z-index（层级）？', String(s.zIndex));
    if (z !== null && z !== '') s.zIndex = Number(z) || s.zIndex;
    saveSettings(s);
    settings = s;
    if (hud) hud.style.zIndex = String(settings.zIndex);
    restartTimer();
  }

  // ---------- 刷新循环 ----------
  function tick() {
    try {
      var db = readTrainData();
      var v = calcSnapshot(db, settings.secPerItem);
      if (!hud) return;
      hud.textContent = v.text;
      if (v.danger) {
        hud.style.animation = 'ebb-blink .8s 2';
        setTimeout(function () { hud.style.animation = ''; }, 1600);
      }
    } catch (e) {
      if (hud) hud.textContent = 'HUD：解析失败';
    }
  }

  function restartTimer() {
    if (timer) clearInterval(timer);
    var ms = Math.max(1, settings.refreshSec) * 1000;
    timer = setInterval(tick, ms);
  }

  function start() { mount(); tick(); restartTimer(); }
  function stop() { if (timer) clearInterval(timer); }

  // ---------- 启动 ----------
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  // 调试接口
  window.EbbinghausHUD = {
    start: start, stop: stop,
    setStorageKey: function (k) { TRAIN_KEY = k; tick(); },
    set: function (opts) {
      if (!opts) return;
      var s = loadSettings();
      if (opts.secPerItem != null) s.secPerItem = Math.max(1, Number(opts.secPerItem) || s.secPerItem);
      if (opts.refreshSec != null) s.refreshSec = Math.max(1, Number(opts.refreshSec) || s.refreshSec);
      if (opts.zIndex != null) s.zIndex = Number(opts.zIndex) || s.zIndex;
      saveSettings(s); settings = s;
      if (hud && opts.zIndex != null) hud.style.zIndex = String(settings.zIndex);
      restartTimer();
    }
  };
})();

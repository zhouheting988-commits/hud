// == Ebbinghaus HUD (ES5 + UMD fallback) ==
// 路径：public/scripts/extensions/third-party/hud/index.js
(function (root, factory) {
  if (typeof define === 'function' && define.amd) { define([], factory); }
  else if (typeof module === 'object' && module.exports) { module.exports = factory(); }
  else {
    var api = factory();
    try {
      if (root.registerExtension) root.registerExtension('hud', api);
      else if (root.registerPlugin) root.registerPlugin('hud', api);
    } catch (e) {}
    // 无宿主注册函数 → 直接自启动
    api.start && api.start();
  }
})(this, function () {
  'use strict';

  var DEFAULTS = { secPerItem: 6, refreshSec: 3, zIndex: 2147483647 };
  var SETTINGS_KEY = 'EbbHUD.Settings';
  var POS_KEY = 'EbbHUD.Pos';

  function copy(o){ return JSON.parse(JSON.stringify(o)); }
  function loadSettings(){ try{var r=localStorage.getItem(SETTINGS_KEY); if(!r) return copy(DEFAULTS);
    var p=JSON.parse(r); return { secPerItem:Number(p.secPerItem)||DEFAULTS.secPerItem,
    refreshSec:Math.max(1,Number(p.refreshSec)||DEFAULTS.refreshSec),
    zIndex:Number(p.zIndex)||DEFAULTS.zIndex }; }catch(e){ return copy(DEFAULTS); } }
  function saveSettings(s){ try{ localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }catch(e){} }
  function loadPos(){ try{var r=localStorage.getItem(POS_KEY); if(!r) return {right:12,bottom:12};
    var p=JSON.parse(r); return { right:Number(p.right)||12, bottom:Number(p.bottom)||12 }; }catch(e){ return {right:12,bottom:12}; } }
  function savePos(p){ try{ localStorage.setItem(POS_KEY, JSON.stringify(p)); }catch(e){} }

  function guessStorageKey(){
    try{
      if (localStorage.getItem('EbbinghausTrainerData_v3')) return 'EbbinghausTrainerData_v3';
      for (var i=0;i<localStorage.length;i++){
        var k = localStorage.key(i);
        if (/^EbbinghausTrainerData/.test(k)) return k;
      }
    }catch(e){}
    return 'EbbinghausTrainerData_v3';
  }
  var TRAIN_KEY = guessStorageKey();

  function readTrainData(){
    try{
      var raw = localStorage.getItem(TRAIN_KEY);
      if (!raw){ TRAIN_KEY = guessStorageKey(); raw = localStorage.getItem(TRAIN_KEY); }
      return raw ? JSON.parse(raw) : null;
    }catch(e){ return null; }
  }

  function calcSnapshot(db, secPerItem){
    if (!db) return { text:'HUD：未检测到词库', danger:false };
    var sc = db.Study_Control || {};
    var day = sc.Current_Day || 1, round = sc.Current_Round || 1;
    var key = 'Day_'+day;
    var b = db.Vocabulary_Mastery && db.Vocabulary_Mastery[key];
    if (!b){
      return { text:'D'+day+'/R'+round+'｜未检测到今日词桶\nL4:0 L3:0 L2:0 L1:0 L0:0｜L5:0', danger:false };
    }
    var c = {
      L0:(b.Level_0_New||[]).length, L1:(b.Level_1||[]).length, L2:(b.Level_2||[]).length,
      L3:(b.Level_3||[]).length, L4:(b.Level_4||[]).length, L5:(b.Level_5_Mastered_Today||[]).length
    };
    var remaining = c.L0+c.L1+c.L2+c.L3+c.L4;
    var eta = Math.ceil((remaining * Math.max(1, secPerItem||6))/60);
    return {
      text: 'D'+day+'/R'+round+'｜剩'+remaining+'｜≈'+eta+'min\n' +
            'L4:'+c.L4+' L3:'+c.L3+' L2:'+c.L2+' L1:'+c.L1+' L0:'+c.L0+'｜L5:'+c.L5,
      danger: eta > 120
    };
  }

  var hud=null, timer=null, settings=loadSettings(), dragging=false;

  function injectStyle(z){
    if (document.getElementById('ebb-hud-style')) return;
    var css='@keyframes ebb-blink{50%{filter:brightness(1.65)}}' +
      '#ebb-hud{position:fixed;right:12px;bottom:12px;z-index:'+z+
      ';background:rgba(0,0,0,.78);color:#fff;padding:10px 12px;border-radius:14px;font:12px/1.45 system-ui,-apple-system,Segoe UI,Roboto,Arial;box-shadow:0 8px 22px rgba(0,0,0,.35);user-select:none;white-space:pre;cursor:grab;transition:opacity .2s}' +
      '#ebb-hud[data-min=\"1\"]{opacity:.35}';
    var s=document.createElement('style'); s.id='ebb-hud-style'; s.type='text/css';
    s.appendChild(document.createTextNode(css)); document.head.appendChild(s);
  }

  function mount(){
    if (hud) return;
    injectStyle(settings.zIndex);
    hud=document.createElement('div'); hud.id='ebb-hud'; hud.textContent='HUD…';
    hud.style.zIndex=String(settings.zIndex);
    var pos=loadPos(); hud.style.right=(pos.right||12)+'px'; hud.style.bottom=(pos.bottom||12)+'px';

    hud.addEventListener('click', function(e){
      if (dragging) return;
      if (e && e.altKey) return openSettings();
      hud.setAttribute('data-min', hud.getAttribute('data-min')==='1' ? '0' : '1');
    });
    hud.addEventListener('contextmenu', function(e){ e.preventDefault(); openSettings(); });

    var startX=0,startY=0,startRight=0,startBottom=0;
    function onMouseMove(e){
      var dx=e.clientX-startX, dy=e.clientY-startY; if (Math.abs(dx)+Math.abs(dy)>3) dragging=true;
      var r=Math.max(6,startRight-dx), b=Math.max(6,startBottom-dy);
      hud.style.right=r+'px'; hud.style.bottom=b+'px';
    }
    function onMouseUp(){
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      if (dragging){ savePos({ right:parseInt(hud.style.right,10)||12, bottom:parseInt(hud.style.bottom,10)||12 }); setTimeout(function(){dragging=false;},50); }
      hud.style.cursor='grab';
    }
    hud.addEventListener('mousedown', function(e){
      if (e.button!==0) return; dragging=false; hud.style.cursor='grabbing';
      startX=e.clientX; startY=e.clientY; startRight=parseInt(hud.style.right,10)||12; startBottom=parseInt(hud.style.bottom,10)||12;
      document.addEventListener('mousemove', onMouseMove); document.addEventListener('mouseup', onMouseUp);
    });

    var pressTimer=null;
    hud.addEventListener('touchstart', function(e){
      dragging=false; var t=e.touches&&e.touches[0]?e.touches[0]:{clientX:0,clientY:0};
      startX=t.clientX; startY=t.clientY; startRight=parseInt(hud.style.right,10)||12; startBottom=parseInt(hud.style.bottom,10)||12;
      pressTimer=setTimeout(function(){ openSettings(); },600);
    }, {passive:true});
    hud.addEventListener('touchmove', function(e){
      var t=e.touches&&e.touches[0]?e.touches[0]:{clientX:0,clientY:0};
      var dx=t.clientX-startX, dy=t.clientY-startY;
      if (Math.abs(dx)+Math.abs(dy)>4){ clearTimeout(pressTimer); dragging=true;
        var r=Math.max(6,startRight-dx), b=Math.max(6,startBottom-dy);
        hud.style.right=r+'px'; hud.style.bottom=b+'px';
      }
    }, {passive:true});
    hud.addEventListener('touchend', function(){ clearTimeout(pressTimer); });

    document.body.appendChild(hud);
  }

  function openSettings(){
    var s=loadSettings();
    var sec=prompt('每题估算秒数？', String(s.secPerItem)); if (sec!==null && sec!=='') s.secPerItem=Math.max(1, Number(sec)||s.secPerItem);
    var ref=prompt('刷新间隔秒？', String(s.refreshSec)); if (ref!==null && ref!=='') s.refreshSec=Math.max(1, Number(ref)||s.refreshSec);
    var z=prompt('z-index？', String(s.zIndex)); if (z!==null && z!=='') s.zIndex=Number(z)||s.zIndex;
    saveSettings(s); settings=s; if (hud) hud.style.zIndex=String(settings.zIndex); restartTimer();
  }

  function tick(){
    try{
      var db=readTrainData(); var v=calcSnapshot(db, settings.secPerItem);
      if (!hud) return; hud.textContent=v.text;
      if (v.danger){ hud.style.animation='ebb-blink .8s 2'; setTimeout(function(){ hud.style.animation=''; },1600); }
    }catch(e){ if (hud) hud.textContent='HUD：解析失败'; }
  }

  function restartTimer(){ if (timer) clearInterval(timer); var ms=Math.max(1, settings.refreshSec)*1000; timer=setInterval(tick, ms); }
  function start(){ if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', function(){ mount(); tick(); restartTimer(); }, {once:true});
                    else { mount(); tick(); restartTimer(); } }
  function stop(){ if (timer) clearInterval(timer); }

  return { start:start, stop:stop, setStorageKey:function(k){ TRAIN_KEY=k; tick(); }, set:function(o){ if(!o)return;
    var s=loadSettings();
    if (o.secPerItem!=null) s.secPerItem=Math.max(1, Number(o.secPerItem)||s.secPerItem);
    if (o.refreshSec!=null) s.refreshSec=Math.max(1, Number(o.refreshSec)||s.refreshSec);
    if (o.zIndex!=null) s.zIndex=Number(o.zIndex)||s.zIndex;
    saveSettings(s); settings=s; if (hud && o.zIndex!=null) hud.style.zIndex=String(settings.zIndex); restartTimer(); } };
});

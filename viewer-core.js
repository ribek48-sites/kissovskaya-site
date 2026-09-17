/*
 * Общая механика просмотра работ: увеличение фотографии и удержание фокуса
 * клавиатуры внутри открытой модалки.
 *
 * Зачем отдельный файл: просмотр живёт в двух местах — лайтбокс главной
 * (встроенный скрипт index.html, работает по данным gallery.json) и viewer.js
 * страниц разделов (работает по разметке сетки). Сами лайтбоксы разные, а
 * механика увеличения у них была одна и та же в двух копиях: находка чинилась
 * дважды и однажды была починена только в одной (щипок увеличивал не ту область).
 *
 * Подключать ДО обоих потребителей: на страницах разделов через defer (порядок
 * defer-скриптов сохраняется), на главной — обычным тегом перед встроенным
 * скриптом, потому что встроенный выполняется раньше любого defer.
 */
(function (global) {
  'use strict';

  /* ================== Увеличение фотографии ==================
   * Один палец при масштабе 1 не делает ничего — это оставляет жест свободным
   * для надстроек (у перекрытий им двигают границу «до/после»).
   * onChange зовётся после каждого изменения масштаба: им компенсируют размер
   * элементов, которые не должны расти вместе с фотографией.
   */
  function makeZoom(stage, zoomOutBtn, zoomInBtn, onChange) {
    var s = 1, tx = 0, ty = 0, boxW = 0, boxH = 0, c0x = 0, c0y = 0;
    var dragging = false, pointers = {}, pinch = null, panStart = null, lastTap = 0;
    var STEP = Math.pow(4, 1 / 3);  // три шага дают ровно ×4

    function updateBtns() {
      if (zoomOutBtn) zoomOutBtn.disabled = (s <= 1);
      if (zoomInBtn)  zoomInBtn.disabled  = (s >= 4);
    }

    /* offsetWidth, а не getBoundingClientRect: он не учитывает transform,
       поэтому размер можно мерить в любом масштабе. Замер по факту загрузки —
       до неё сцена нулевой ширины, и границы сдвига оказались бы бессмысленны.
       c0x/c0y — центр НЕТРАНСФОРМИРОВАННОЙ рамки, снимается только при s===1
       (иначе сам замер зависел бы от текущего масштаба). Держим его в памяти,
       а не читаем заново в zoomAt — см. комментарий там про причину. */
    function measure() {
      boxW = stage.offsetWidth;
      boxH = stage.offsetHeight;
      if (s === 1) {
        var r = stage.getBoundingClientRect();
        c0x = r.left + r.width / 2;
        c0y = r.top + r.height / 2;
      }
    }

    function clampPan() {
      if (s <= 1 || !boxW) return;
      var mx = boxW * (s - 1) / 2, my = boxH * (s - 1) / 2;
      tx = Math.max(-mx, Math.min(mx, tx));
      ty = Math.max(-my, Math.min(my, ty));
    }

    function apply() {
      clampPan();
      updateBtns();
      if (s === 1) {
        stage.style.transform = '';
        stage.style.overflow  = 'hidden';
      } else {
        stage.style.transform = 'translate(' + tx.toFixed(1) + 'px,' + ty.toFixed(1) + 'px) scale(' + s.toFixed(3) + ')';
        stage.style.overflow  = 'visible';
      }
      if (onChange) onChange(s, dragging);
    }

    function reset() {
      s = 1; tx = 0; ty = 0;
      pointers = {}; pinch = null; panStart = null;
      apply();
    }

    /* Раньше здесь читался stage.getBoundingClientRect() — текущий отрисованный
       прямоугольник. В щипке двумя пальцами это ломалось: перед каждым вызовом
       s/tx/ty отматываются назад к состоянию начала жеста (см. pointermove
       ниже), а DOM в этот момент ещё хранит transform ПРЕДЫДУЩЕГО кадра —
       формула мешала «отмотанные» переменные с ещё не отмотанным DOM, и с
       каждым движением пальца ошибка накапливалась (особенно после того как
       clampPan уже прижимал сдвиг к границе на предыдущем кадре — испорченное
       значение подставлялось как «текущее» на следующем). Теперь anchor
       считается только через c0x/c0y (статический центр, не зависит от DOM) и
       текущие s/tx/ty из замыкания — формула самодостаточна и даёт тот же
       результат, что и раньше, во всех местах кроме сломанного щипка. */
    function zoomAt(mx, my, ns) {
      ns = Math.max(1, Math.min(4, ns));
      if (ns > 3.999) ns = 4;
      if (ns < 1.001) ns = 1;
      var ratio = ns / s;
      var ntx = (mx - c0x) * (1 - ratio) + ratio * tx;
      var nty = (my - c0y) * (1 - ratio) + ratio * ty;
      tx = ntx; ty = nty; s = ns;
      if (s <= 1) { s = 1; tx = 0; ty = 0; }
    }

    function zoomCenter(f) {
      var r = stage.getBoundingClientRect();
      zoomAt(r.left + r.width / 2, r.top + r.height / 2, s * f);
      apply();
    }

    function dist2(a, b) {
      var dx = a.x - b.x, dy = a.y - b.y;
      return Math.sqrt(dx * dx + dy * dy);
    }

    stage.style.touchAction = 'none';

    /* Два пальца никогда не касаются экрана в один момент — один опускается
       чуть раньше другого. Если сразу считать первый палец панорамой, его
       случайное дрожание за эти миллисекунды портит tx/ty ДО того как
       опустится второй палец и начнётся настоящий щипок — увеличение потом
       стартует не от того места, где стоят пальцы. Пауза даёт второму пальцу
       время присоединиться; мыши это не касается — там гонки нет. */
    var PAN_GRACE_MS = 100;

    stage.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      stage.setPointerCapture(e.pointerId);
      pointers[e.pointerId] = {x: e.clientX, y: e.clientY};
      var ids = Object.keys(pointers);
      if (ids.length === 2) {
        var p1 = pointers[ids[0]], p2 = pointers[ids[1]];
        pinch = {dist: dist2(p1, p2), s0: s, tx0: tx, ty0: ty,
                 mx: (p1.x + p2.x) / 2, my: (p1.y + p2.y) / 2};
        dragging = false;
      } else {
        dragging = true;
        panStart = {px: e.clientX, py: e.clientY, tx: tx, ty: ty,
                    t: e.timeStamp, touch: e.pointerType === 'touch'};
      }
    });

    stage.addEventListener('pointermove', function (e) {
      if (!pointers[e.pointerId]) return;
      pointers[e.pointerId] = {x: e.clientX, y: e.clientY};
      var ids = Object.keys(pointers);
      if (ids.length >= 2 && pinch) {
        var p1 = pointers[ids[0]], p2 = pointers[ids[1]];
        var nd = dist2(p1, p2), nmx = (p1.x + p2.x) / 2, nmy = (p1.y + p2.y) / 2;
        s = pinch.s0; tx = pinch.tx0; ty = pinch.ty0;
        zoomAt(pinch.mx, pinch.my, pinch.s0 * nd / pinch.dist);
        tx += nmx - pinch.mx;
        ty += nmy - pinch.my;
        apply();
      } else if (ids.length === 1 && dragging && panStart && s > 1 &&
                 (!panStart.touch || e.timeStamp - panStart.t > PAN_GRACE_MS)) {
        tx = panStart.tx + e.clientX - panStart.px;
        ty = panStart.ty + e.clientY - panStart.py;
        apply();
      }
    });

    stage.addEventListener('pointerup', function (e) {
      delete pointers[e.pointerId];
      var rem = Object.keys(pointers);
      if (!rem.length) {
        dragging = false; pinch = null; panStart = null;
      } else if (rem.length === 1 && pinch) {
        pinch = null;
        var rp = pointers[rem[0]];
        panStart = {px: rp.x, py: rp.y, tx: tx, ty: ty,
                    t: e.timeStamp, touch: e.pointerType === 'touch'};
        dragging = true;
      }
      if (onChange) onChange(s, dragging);
    });

    stage.addEventListener('pointercancel', function (e) {
      delete pointers[e.pointerId];
      if (!Object.keys(pointers).length) {
        dragging = false; pinch = null; panStart = null;
      }
    });

    stage.addEventListener('wheel', function (e) {
      e.preventDefault();
      zoomAt(e.clientX, e.clientY, s * (e.deltaY < 0 ? 1.2 : 1 / 1.2));
      apply();
    }, {passive: false});

    /* Двойной клик или тап — сброс увеличения */
    stage.addEventListener('click', function () {
      var now = Date.now();
      if (now - lastTap < 300) reset();
      lastTap = now;
    });

    stage.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    /* Кнопки: клик = один шаг, удержание 500 мс = сразу до предела */
    function attachHold(btn, stepFactor, extreme) {
      if (!btn) return;
      btn.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        var fired = false;
        var t = setTimeout(function () { fired = true; zoomCenter(extreme / s); }, 500);
        function end(ev) {
          clearTimeout(t);
          btn.removeEventListener('pointerup',     end);
          btn.removeEventListener('pointercancel', end);
          if (!fired && ev.type === 'pointerup') zoomCenter(stepFactor);
        }
        btn.addEventListener('pointerup',     end);
        btn.addEventListener('pointercancel', end);
      });
    }
    attachHold(zoomInBtn,  STEP,     4);
    attachHold(zoomOutBtn, 1 / STEP, 1);

    window.addEventListener('resize', measure);
    window.addEventListener('orientationchange', measure);

    return {reset: reset, measure: measure, getScale: function () { return s; }};
  }

  /* ================== Фокус клавиатуры в модалке ==================
   * Открытая модалка перекрывает страницу затемнением, но Tab по-прежнему
   * уходил на ссылки под ним: человек, listающий работы с клавиатуры, терял
   * место и нажимал на невидимое. Держим фокус внутри, а при закрытии
   * возвращаем на плитку, с которой пришли, — иначе он падает на <body> и
   * следующий Tab начинает обход страницы заново.
   */
  function makeFocusTrap(modal) {
    var SELECTOR = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
    var lastActive = null;

    function focusable() {
      /* getClientRects, а не offsetParent: у элемента с position:fixed
         offsetParent всегда null, и такая кнопка выпала бы из цикла, хотя видна. */
      return Array.prototype.filter.call(modal.querySelectorAll(SELECTOR), function (el) {
        return el.getClientRects().length > 0;
      });
    }

    modal.addEventListener('keydown', function (e) {
      if (e.key !== 'Tab') return;
      var items = focusable();
      if (!items.length) return;
      var first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    });

    return {
      activate: function () {
        lastActive = document.activeElement;
        modal.setAttribute('aria-modal', 'true');
        var items = focusable();
        if (items.length) items[0].focus();
      },
      release: function () {
        modal.removeAttribute('aria-modal');
        if (lastActive && lastActive.focus) lastActive.focus();
        lastActive = null;
      }
    };
  }

  global.KissViewer = {makeZoom: makeZoom, makeFocusTrap: makeFocusTrap};
})(window);

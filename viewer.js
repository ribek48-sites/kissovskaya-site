/*
 * Просмотр фотографий на страницах разделов: /grafika, /chb-realizm, /akvarel,
 * /perekrytie.
 *
 * Два режима в одном файле — включается тот, для которого на странице есть разметка:
 *   1. Обычные работы: лайтбокс с листанием, счётчиком и увеличением.
 *   2. Перекрытия: две фотографии под ползунком «до/после».
 * Общее у них — увеличение и удержание фокуса клавиатуры; и то и другое взято из
 * viewer-core.js, которым пользуется ещё и лайтбокс главной страницы.
 *
 * Зачем отдельным файлом, а не внутри шаблона: страницы собирает Python, и его
 * f-строка требует удваивать каждую фигурную скобку JS. В отдельном файле работает
 * node --check, подсветка синтаксиса и осмысленный diff.
 */
(function () {
  'use strict';

  /* Механика увеличения и фокус-ловушка живут в viewer-core.js — тем же кодом
     пользуется лайтбокс главной страницы. Файл подключается перед этим. */
  var makeZoom = window.KissViewer && window.KissViewer.makeZoom;
  var makeFocusTrap = window.KissViewer && window.KissViewer.makeFocusTrap;
  if (!makeZoom || !makeFocusTrap) return;

  /* ================== Общая история ==================
   * Одна запись в истории на открытую модалку: кнопка «назад» (на телефоне — свайп
   * от края) закрывает просмотр, а не уводит со страницы.
   */
  var _popping = false;
  var _closers = [];

  function pushHistory() { if (!_popping) history.pushState({viewer: true}, ''); }
  function popHistory()  { if (!_popping) history.back(); }

  window.addEventListener('popstate', function () {
    _popping = true;
    _closers.forEach(function (close) { close(); });
    _popping = false;
  });

  /* Свайп по горизонтали листает работы. Пинч (два пальца и больше) игнорируем —
     это увеличение, а не листание. */
  function attachSwipe(el, isZoomed, onPrev, onNext) {
    var startX = 0, maxFingers = 0;
    el.addEventListener('touchstart', function (e) {
      maxFingers = Math.max(maxFingers, e.touches.length);
      if (e.touches.length === 1) startX = e.changedTouches[0].clientX;
    }, {passive: true});
    el.addEventListener('touchmove', function (e) {
      maxFingers = Math.max(maxFingers, e.touches.length);
    }, {passive: true});
    el.addEventListener('touchend', function (e) {
      if (e.touches.length > 0) return;
      var many = maxFingers > 1;
      maxFingers = 0;
      if (many || isZoomed()) return;
      var dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) > 50) { if (dx < 0) onNext(); else onPrev(); }
    }, {passive: true});
  }

  function goal(metrika) {
    if (typeof ym === 'function' && metrika) ym(metrika, 'reachGoal', 'view_works');
  }

  /* ================== Режим 1: обычные работы ================== */
  function initPhotoViewer(grid) {
    var modal = document.getElementById('gallery-modal');
    var photo = document.getElementById('modal-photo');
    var img   = document.getElementById('modal-img');
    if (!modal || !photo || !img) return false;

    var counter  = document.getElementById('modal-counter');
    var closeBtn = document.getElementById('modal-close');
    var prevBtn  = document.getElementById('modal-prev');
    var nextBtn  = document.getElementById('modal-next');
    var metrika  = parseInt(modal.getAttribute('data-metrika'), 10);

    /* Список берём из самой сетки: адреса и подписи уже лежат в разметке,
       дублировать их отдельными данными незачем. */
    var links = Array.prototype.slice.call(grid.querySelectorAll('.works-link'));
    if (!links.length) return false;

    var zoom = makeZoom(photo, document.getElementById('modal-zoom-out'),
                               document.getElementById('modal-zoom-in'));
    var focusTrap = makeFocusTrap(modal);
    var idx = 0;

    function isOpen() { return modal.classList.contains('open'); }
    function pad(n) { return n < 10 ? '0' + n : String(n); }

    function show(i) {
      idx = ((i % links.length) + links.length) % links.length;  /* листаем по кругу */
      var link = links[idx];
      var pic  = link.querySelector('img');
      zoom.reset();
      img.src = link.getAttribute('href');
      img.alt = pic ? pic.getAttribute('alt') : '';
      if (counter) counter.textContent = pad(idx + 1) + ' / ' + pad(links.length);
      zoom.measure();
    }

    function open(i) {
      show(i);
      if (!isOpen()) pushHistory();
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      zoom.measure();
      focusTrap.activate();
      goal(metrika);
    }

    function close() {
      if (!isOpen()) return;
      zoom.reset();
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      focusTrap.release();
      popHistory();
    }

    img.addEventListener('load', zoom.measure);

    grid.addEventListener('click', function (e) {
      var link = e.target.closest ? e.target.closest('.works-link') : null;
      if (!link) return;
      var i = links.indexOf(link);
      if (i < 0) return;
      e.preventDefault();
      open(i);
    });

    if (closeBtn) closeBtn.addEventListener('click', close);
    if (prevBtn)  prevBtn.addEventListener('click', function () { show(idx - 1); });
    if (nextBtn)  nextBtn.addEventListener('click', function () { show(idx + 1); });
    modal.addEventListener('click', function (e) { if (e.target === modal) close(); });
    modal.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    attachSwipe(modal, function () { return zoom.getScale() > 1; },
                function () { show(idx - 1); }, function () { show(idx + 1); });

    document.addEventListener('keydown', function (e) {
      if (!isOpen()) return;
      if (e.key === 'Escape')     { close();       return; }
      if (e.key === 'ArrowLeft')  { show(idx - 1); return; }
      if (e.key === 'ArrowRight') { show(idx + 1); }
    });

    _closers.push(close);
    return true;
  }

  /* ================== Режим 2: перекрытия ================== */
  function initPairViewer(grid) {
    var dataEl = document.getElementById('pairs-data');
    var modal  = document.getElementById('pair-modal');
    if (!dataEl || !modal) return false;

    var data;
    try {
      data = JSON.parse(dataEl.textContent);
    } catch (err) {
      return false;  /* битые данные — оставляем страницу на обычных ссылках */
    }
    var PAIRS   = (data && data.pairs) || [];
    var metrika = data && data.metrika;
    if (!PAIRS.length) return false;

    var stage     = document.getElementById('pair-stage');
    var imgAfter  = document.getElementById('pair-img-after');
    var imgBefore = document.getElementById('pair-img-before');
    var divider   = document.getElementById('pair-divider');
    var handle    = modal.querySelector('.pair-handle');
    var counter   = document.getElementById('pair-counter');
    var closeBtn  = document.getElementById('pair-close');
    var prevBtn   = document.getElementById('pair-prev');
    var nextBtn   = document.getElementById('pair-next');
    if (!stage || !imgAfter || !imgBefore || !divider) return false;

    /* Ползунок и его ручка не должны расти вместе с фотографией: иначе при
       четырёхкратном увеличении ручка занимает пол-экрана и хвататься не за что. */
    var zoom = makeZoom(stage, document.getElementById('pair-zoom-out'),
                               document.getElementById('pair-zoom-in'),
      function (s, dragging) {
        divider.style.width = (2 / s) + 'px';
        if (handle) handle.style.transform = 'translate(-50%, -50%) scale(' + (1 / s) + ')';
        stage.style.cursor = s === 1 ? 'col-resize' : (dragging ? 'grabbing' : 'grab');
      });

    var focusTrap = makeFocusTrap(modal);
    var idx = 0;
    var stageDrag = false, handleDrag = false;

    function isOpen() { return modal.classList.contains('open'); }

    function setSlider(pct) {
      pct = Math.max(5, Math.min(95, pct));
      imgBefore.style.clipPath = 'inset(0 ' + (100 - pct) + '% 0 0)';
      divider.style.left = pct + '%';
    }

    /* Прямоугольник сцены учитывает текущее увеличение, поэтому доля считается
       верно и на увеличенной фотографии: преобразование сохраняет пропорции. */
    function pctFromEvent(e) {
      var r = stage.getBoundingClientRect();
      return 100 * (e.clientX - r.left) / r.width;
    }

    /* width/height ставим до src: браузер узнаёт пропорции сразу и резервирует
       место, иначе сцена до загрузки файла имеет нулевой размер. */
    function setPhoto(el, photo) {
      if (photo.w && photo.h) { el.width = photo.w; el.height = photo.h; }
      el.alt = photo.alt || '';
      el.src = photo.src;
    }

    function show(i) {
      var pair = PAIRS[i];
      if (!pair) return;
      idx = i;
      zoom.reset();
      setPhoto(imgAfter,  pair.after);
      setPhoto(imgBefore, pair.before);
      setSlider(50);
      if (counter) counter.textContent = (i + 1) + ' / ' + PAIRS.length;
      if (prevBtn) prevBtn.disabled = (i === 0);
      if (nextBtn) nextBtn.disabled = (i === PAIRS.length - 1);
      zoom.measure();
    }

    function open(i) {
      if (!PAIRS[i]) return;
      show(i);
      if (!isOpen()) pushHistory();
      modal.classList.add('open');
      modal.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      zoom.measure();
      focusTrap.activate();
      goal(metrika);
    }

    /* Листание не считается новым просмотром работ и не кладёт запись в историю:
       иначе одна открытая модалка накрутила бы цель и заставила жать «назад»
       столько раз, сколько пар пролистано. */
    function goTo(i) {
      if (i < 0 || i >= PAIRS.length) return;
      show(i);
    }

    function close() {
      if (!isOpen()) return;
      zoom.reset();
      modal.classList.remove('open');
      modal.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      focusTrap.release();
      popHistory();
    }

    /* Пока фотография не увеличена, границу двигает касание в любом месте кадра —
       так быстрее всего сравнить «до» и «после». Увеличенную фотографию тот же
       жест перемещает (этим занимается makeZoom), поэтому границу там двигают
       за ползунок: он ловит касание сам и не пускает событие дальше. */
    stage.addEventListener('pointerdown', function (e) {
      if (handleDrag) return;
      stageDrag = true;
      if (zoom.getScale() === 1) setSlider(pctFromEvent(e));
    });
    stage.addEventListener('pointermove', function (e) {
      if (stageDrag && !handleDrag && zoom.getScale() === 1) setSlider(pctFromEvent(e));
    });
    stage.addEventListener('pointerup',     function () { stageDrag = false; });
    stage.addEventListener('pointercancel', function () { stageDrag = false; });

    divider.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      e.stopPropagation();  /* иначе сцена начнёт перемещать фотографию */
      divider.setPointerCapture(e.pointerId);
      handleDrag = true;
    });
    divider.addEventListener('pointermove', function (e) {
      if (handleDrag) setSlider(pctFromEvent(e));
    });
    function endHandleDrag() { handleDrag = false; }
    divider.addEventListener('pointerup', endHandleDrag);
    divider.addEventListener('pointercancel', endHandleDrag);

    imgAfter.addEventListener('load', zoom.measure);

    if (closeBtn) closeBtn.addEventListener('click', close);
    if (prevBtn)  prevBtn.addEventListener('click', function () { goTo(idx - 1); });
    if (nextBtn)  nextBtn.addEventListener('click', function () { goTo(idx + 1); });
    modal.addEventListener('click', function (e) { if (e.target === modal) close(); });
    modal.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    grid.addEventListener('click', function (e) {
      var fig = e.target.closest ? e.target.closest('.works-item[data-pair-index]') : null;
      if (!fig) return;  /* нет пары — пусть отрабатывает обычная ссылка на файл */
      var i = parseInt(fig.getAttribute('data-pair-index'), 10);
      if (isNaN(i) || !PAIRS[i]) return;
      e.preventDefault();
      open(i);
    });

    document.addEventListener('keydown', function (e) {
      if (!isOpen()) return;
      if (e.key === 'Escape')     { close();       return; }
      if (e.key === 'ArrowLeft')  { goTo(idx - 1); return; }
      if (e.key === 'ArrowRight') { goTo(idx + 1); }
    });

    _closers.push(close);
    return true;
  }

  var grid = document.getElementById('photo-grid');
  if (!grid) return;
  if (!initPairViewer(grid)) initPhotoViewer(grid);
})();

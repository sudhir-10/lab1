/* ==========================================================================
   Variation E — "Glassmorphic Aurora"
   Detail page logic: reads ?id= from the URL, renders the full book record
   (about, quote, publication table, themes, rating), a compare-toggle
   button, prev/next navigation, a "more in this genre" strip, and drives
   the shared floating Compare Tray + comparison modal (localStorage key
   "aurora-compare", duplicated here since this project has no shared
   module file — matches the pattern used across the sibling variants).
   Plain script, no modules — must run from file://.
   ========================================================================== */

(function () {
  "use strict";

  /* ------------------------------------------------------------------ */
  /* Constants                                                            */
  /* ------------------------------------------------------------------ */

  var COMPARE_KEY = "aurora-compare";
  var COMPARE_MAX = 3;
  var TOAST_MS = 2600;
  var RELATED_LIMIT = 8;

  var STAR_SVG =
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
    '<path d="M12 2.5l2.95 6.28 6.93.72-5.17 4.73 1.44 6.83L12 17.77l-6.15 3.29 1.44-6.83-5.17-4.73 6.93-.72L12 2.5z"/></svg>';

  var PLUS_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true">' +
    '<line x1="12" y1="5" x2="12" y2="19" stroke-linecap="round"></line>' +
    '<line x1="5" y1="12" x2="19" y2="12" stroke-linecap="round"></line></svg>';

  var CHECK_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true">' +
    '<path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round"></path></svg>';

  /* ------------------------------------------------------------------ */
  /* DOM references                                                        */
  /* ------------------------------------------------------------------ */

  var detailRoot = document.getElementById("bookDetail");
  var headerNote = document.getElementById("headerNote");
  var relatedSection = document.getElementById("relatedSection");
  var relatedTitle = document.getElementById("relatedTitle");
  var relatedStrip = document.getElementById("relatedStrip");

  var compareTray = document.getElementById("compareTray");
  var trayCovers = document.getElementById("trayCovers");
  var trayCount = document.getElementById("trayCount");
  var trayClearBtn = document.getElementById("trayClearBtn");
  var trayCompareBtn = document.getElementById("trayCompareBtn");
  var compareToast = document.getElementById("compareToast");
  var compareModalOverlay = document.getElementById("compareModalOverlay");
  var compareModal = document.getElementById("compareModal");
  var compareModalBody = document.getElementById("compareModalBody");
  var compareModalClose = document.getElementById("compareModalClose");

  var toastTimer = null;
  var lastFocusedBeforeModal = null;
  var dataYearMin = 0;
  var dataYearMax = 0;

  /* ------------------------------------------------------------------ */
  /* localStorage helpers (mirrors js/main.js)                            */
  /* ------------------------------------------------------------------ */

  function safeGetItem(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function safeSetItem(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch (e) {
      return false;
    }
  }

  function getCompareList() {
    var raw = safeGetItem(COMPARE_KEY);
    if (!raw) {
      return [];
    }
    try {
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(function (id) {
        return typeof id === "string";
      }) : [];
    } catch (e) {
      return [];
    }
  }

  function setCompareList(ids) {
    return safeSetItem(COMPARE_KEY, JSON.stringify(ids));
  }

  function isComparing(id) {
    return getCompareList().indexOf(id) !== -1;
  }

  function findBook(id) {
    if (typeof BOOKS === "undefined") {
      return null;
    }
    return BOOKS.find(function (b) {
      return b.id === id;
    }) || null;
  }

  function computeYearRange() {
    if (typeof BOOKS === "undefined") {
      return;
    }
    var years = BOOKS.filter(function (b) {
      return typeof b.year === "number";
    }).map(function (b) {
      return b.year;
    });
    dataYearMin = years.length ? Math.min.apply(null, years) : 0;
    dataYearMax = years.length ? Math.max.apply(null, years) : 0;
  }

  /* ------------------------------------------------------------------ */
  /* Toast                                                                */
  /* ------------------------------------------------------------------ */

  function showToast(message) {
    if (!compareToast) {
      return;
    }
    compareToast.textContent = message;
    compareToast.classList.add("is-visible");
    if (toastTimer) {
      window.clearTimeout(toastTimer);
    }
    toastTimer = window.setTimeout(function () {
      compareToast.classList.remove("is-visible");
    }, TOAST_MS);
  }

  /* ------------------------------------------------------------------ */
  /* Compare toggle (add/remove, enforcing max of 3)                      */
  /* ------------------------------------------------------------------ */

  function toggleCompare(id) {
    var list = getCompareList();
    var index = list.indexOf(id);

    if (index !== -1) {
      list.splice(index, 1);
      setCompareList(list);
      refreshCompareUI();
      return true;
    }

    if (list.length >= COMPARE_MAX) {
      showToast("Compare tray is full — remove a book to add another (max " + COMPARE_MAX + ").");
      return false;
    }

    list.push(id);
    var ok = setCompareList(list);
    if (!ok) {
      showToast("Couldn't save your selection. Storage may be unavailable.");
    }
    refreshCompareUI();
    return true;
  }

  /* ------------------------------------------------------------------ */
  /* Resolve the requested book                                           */
  /* ------------------------------------------------------------------ */

  var params = new URLSearchParams(window.location.search);
  var requestedId = params.get("id");

  var book = null;
  if (typeof BOOKS !== "undefined" && requestedId) {
    book = BOOKS.find(function (b) {
      return b.id === requestedId;
    }) || null;
  }

  /* ------------------------------------------------------------------ */
  /* Shared helpers                                                        */
  /* ------------------------------------------------------------------ */

  function isPresent(value) {
    return value !== null && value !== undefined && value !== "";
  }

  function getNeighbours(currentBook) {
    if (typeof BOOKS === "undefined" || BOOKS.length <= 1) {
      return null;
    }
    var index = BOOKS.findIndex(function (b) {
      return b.id === currentBook.id;
    });
    if (index === -1) {
      return null;
    }
    return {
      prev: BOOKS[(index - 1 + BOOKS.length) % BOOKS.length],
      next: BOOKS[(index + 1) % BOOKS.length]
    };
  }

  function attachCoverImage(coverEl, forBook) {
    if (!forBook.cover) {
      return;
    }
    var img = document.createElement("img");
    img.className = "cover-img";
    img.src = forBook.cover;
    img.alt = "Cover of " + forBook.title;
    img.loading = "lazy";
    img.addEventListener("error", function () {
      img.remove();
    });
    coverEl.appendChild(img);
  }

  function buildCoverEl(forBook, extraClass) {
    var cover = document.createElement("div");
    cover.className = "book-cover" + (extraClass ? " " + extraClass : "");
    cover.style.setProperty("--cover-a", forBook.coverFrom);
    cover.style.setProperty("--cover-b", forBook.coverTo);

    attachCoverImage(cover, forBook);

    var coverTitle = document.createElement("p");
    coverTitle.className = "cover-title";
    coverTitle.textContent = forBook.title;

    var coverAuthor = document.createElement("p");
    coverAuthor.className = "cover-author";
    coverAuthor.textContent = forBook.author;

    cover.appendChild(coverTitle);
    cover.appendChild(coverAuthor);
    return cover;
  }

  /* ------------------------------------------------------------------ */
  /* Rendering — not found                                                 */
  /* ------------------------------------------------------------------ */

  function renderNotFound() {
    document.title = "Book not found — Aurora";
    if (headerNote) {
      headerNote.textContent = "Not found";
    }
    detailRoot.innerHTML =
      '<section class="not-found glass">' +
      "<h1>Book not found</h1>" +
      "<p>We couldn't find a book matching that link. It may have been moved or the address mistyped.</p>" +
      '<a class="btn btn-primary" href="index.html">Browse the collection</a>' +
      "</section>";
  }

  /* ------------------------------------------------------------------ */
  /* Rendering — main detail                                               */
  /* ------------------------------------------------------------------ */

  function renderDetail(theBook) {
    document.title = theBook.title + " — Aurora";
    if (headerNote) {
      headerNote.textContent = theBook.genre;
    }

    var fragment = document.createDocumentFragment();

    var layout = document.createElement("div");
    layout.className = "detail-layout glass";
    layout.appendChild(buildCoverColumn(theBook));
    layout.appendChild(buildInfoColumn(theBook));
    fragment.appendChild(layout);

    var neighbours = getNeighbours(theBook);
    if (neighbours) {
      fragment.appendChild(buildPager(neighbours));
    }

    detailRoot.appendChild(fragment);

    if (neighbours) {
      bindKeyboardNav(neighbours);
    }

    renderRelated(theBook);
  }

  function buildCoverColumn(theBook) {
    var coverCol = document.createElement("div");
    coverCol.className = "detail-cover-col";

    coverCol.appendChild(buildCoverEl(theBook, "detail-cover"));

    if (typeof theBook.rating === "number") {
      var rating = document.createElement("span");
      rating.className = "rating detail-rating";
      rating.innerHTML = STAR_SVG;
      rating.appendChild(document.createTextNode(" " + theBook.rating.toFixed(1) + " / 5"));
      coverCol.appendChild(rating);
    }

    coverCol.appendChild(buildCompareButton(theBook));

    return coverCol;
  }

  function buildCompareButton(theBook) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-primary btn-block";

    function refresh() {
      var comparing = isComparing(theBook.id);
      var full = getCompareList().length >= COMPARE_MAX;
      btn.setAttribute("aria-pressed", comparing ? "true" : "false");
      btn.innerHTML =
        (comparing ? CHECK_SVG : PLUS_SVG) +
        "<span>" + (comparing ? "In compare tray" : "Add to compare") + "</span>";
      btn.disabled = full && !comparing;
    }

    btn.addEventListener("click", function () {
      toggleCompare(theBook.id);
      refresh();
    });

    refresh();
    btn._refresh = refresh;
    return btn;
  }

  function buildInfoColumn(theBook) {
    var info = document.createElement("div");
    info.className = "detail-info";

    var eyebrow = document.createElement("p");
    eyebrow.className = "eyebrow";
    eyebrow.textContent = theBook.genre;
    info.appendChild(eyebrow);

    var title = document.createElement("h1");
    title.className = "detail-title";
    title.textContent = theBook.title;
    info.appendChild(title);

    if (isPresent(theBook.subtitle)) {
      var subtitle = document.createElement("p");
      subtitle.className = "detail-subtitle";
      subtitle.textContent = theBook.subtitle;
      info.appendChild(subtitle);
    }

    var author = document.createElement("p");
    author.className = "detail-author";
    author.appendChild(document.createTextNode("by "));
    var strong = document.createElement("strong");
    strong.textContent = theBook.author;
    author.appendChild(strong);
    if (isPresent(theBook.year)) {
      author.appendChild(document.createTextNode(" · " + theBook.year));
    }
    info.appendChild(author);

    info.appendChild(buildAboutSection(theBook));

    if (theBook.quote && isPresent(theBook.quote.text)) {
      info.appendChild(buildQuoteSection(theBook));
    }

    info.appendChild(buildMetaSection(theBook));

    if (theBook.tags && theBook.tags.length > 0) {
      info.appendChild(buildTagsSection(theBook));
    }

    return info;
  }

  function buildAboutSection(theBook) {
    var section = document.createElement("section");
    section.className = "detail-section";

    var heading = document.createElement("h2");
    heading.className = "section-title";
    heading.textContent = "About this book";
    section.appendChild(heading);

    (theBook.blurb || []).forEach(function (paragraph) {
      var p = document.createElement("p");
      p.className = "blurb";
      p.textContent = paragraph;
      section.appendChild(p);
    });

    return section;
  }

  function buildQuoteSection(theBook) {
    var section = document.createElement("section");
    section.className = "detail-section";

    var heading = document.createElement("h2");
    heading.className = "section-title";
    heading.textContent = "From the book";
    section.appendChild(heading);

    var quote = document.createElement("blockquote");
    quote.className = "pull-quote";
    quote.appendChild(document.createTextNode(theBook.quote.text));

    if (isPresent(theBook.quote.source)) {
      var cite = document.createElement("cite");
      cite.textContent = "— " + theBook.quote.source;
      quote.appendChild(cite);
    }

    section.appendChild(quote);
    return section;
  }

  function buildMetaSection(theBook) {
    var section = document.createElement("section");
    section.className = "detail-section";

    var heading = document.createElement("h2");
    heading.className = "section-title";
    heading.textContent = "Publication details";
    section.appendChild(heading);

    var metaGrid = document.createElement("div");
    metaGrid.className = "meta-grid";

    var fields = [
      ["Published", isPresent(theBook.year) ? String(theBook.year) : null],
      ["Pages", isPresent(theBook.pages) ? theBook.pages.toLocaleString() : null],
      ["Genre", theBook.genre],
      ["Publisher", isPresent(theBook.publisher) ? theBook.publisher : null],
      ["Language", theBook.language],
      ["ISBN", isPresent(theBook.isbn) ? theBook.isbn : null],
      ["Rating", typeof theBook.rating === "number" ? theBook.rating.toFixed(1) + " / 5" : null]
    ];

    fields.forEach(function (field) {
      if (!isPresent(field[1])) {
        return;
      }
      var item = document.createElement("div");
      item.className = "meta-item";

      var label = document.createElement("span");
      label.className = "meta-label";
      label.textContent = field[0];

      var value = document.createElement("p");
      value.className = "meta-value";
      value.textContent = field[1];

      item.appendChild(label);
      item.appendChild(value);
      metaGrid.appendChild(item);
    });

    section.appendChild(metaGrid);
    return section;
  }

  function buildTagsSection(theBook) {
    var section = document.createElement("section");
    section.className = "detail-section";

    var heading = document.createElement("h2");
    heading.className = "section-title";
    heading.textContent = "Themes";
    section.appendChild(heading);

    var list = document.createElement("ul");
    list.className = "tag-list";

    theBook.tags.forEach(function (tag) {
      var li = document.createElement("li");
      li.className = "tag";
      li.textContent = tag;
      list.appendChild(li);
    });

    section.appendChild(list);
    return section;
  }

  /* ------------------------------------------------------------------ */
  /* Related books ("more in this genre")                                 */
  /* ------------------------------------------------------------------ */

  function renderRelated(theBook) {
    if (!relatedSection || !relatedStrip || typeof BOOKS === "undefined") {
      return;
    }

    var related = BOOKS.filter(function (b) {
      return b.genre === theBook.genre && b.id !== theBook.id;
    }).slice(0, RELATED_LIMIT);

    if (!related.length) {
      relatedSection.hidden = true;
      return;
    }

    relatedTitle.textContent = "More in " + theBook.genre;

    var fragment = document.createDocumentFragment();
    related.forEach(function (relatedBook) {
      fragment.appendChild(buildRelatedCard(relatedBook));
    });

    relatedStrip.replaceChildren(fragment);
    relatedSection.hidden = false;
  }

  function buildRelatedCard(relatedBook) {
    var item = document.createElement("li");
    item.className = "book-card";

    var link = document.createElement("a");
    link.className = "book-card-link";
    link.href = "book.html?id=" + encodeURIComponent(relatedBook.id);
    link.setAttribute("aria-label", relatedBook.title + " by " + relatedBook.author);

    link.appendChild(buildCoverEl(relatedBook));

    var body = document.createElement("div");
    body.className = "book-card-body";

    var title = document.createElement("h3");
    title.className = "book-title";
    title.textContent = relatedBook.title;

    var author = document.createElement("p");
    author.className = "book-author";
    author.textContent = relatedBook.author;

    body.appendChild(title);
    body.appendChild(author);
    link.appendChild(body);
    item.appendChild(link);

    return item;
  }

  /* ------------------------------------------------------------------ */
  /* Previous / next pager                                                 */
  /* ------------------------------------------------------------------ */

  function buildPager(neighbours) {
    var nav = document.createElement("nav");
    nav.className = "pager";
    nav.setAttribute("aria-label", "Book navigation");

    nav.appendChild(buildPagerLink("prev", neighbours.prev));
    nav.appendChild(buildPagerLink("next", neighbours.next));

    return nav;
  }

  function buildPagerLink(direction, neighbour) {
    var isPrev = direction === "prev";

    var link = document.createElement("a");
    link.className = "pager-link glass " + (isPrev ? "pager-prev" : "pager-next");
    link.href = "book.html?id=" + encodeURIComponent(neighbour.id);
    link.setAttribute("aria-label", (isPrev ? "Previous" : "Next") + " book: " + neighbour.title);

    link.innerHTML = isPrev
      ? '<svg aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">' +
        '<path d="M19 12H5M5 12L12 19M5 12L12 5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      : '<svg aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">' +
        '<path d="M5 12H19M19 12L12 5M19 12L12 19" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    var text = document.createElement("span");
    text.className = "pager-text";

    var label = document.createElement("span");
    label.className = "pager-label";
    label.textContent = isPrev ? "Previous" : "Next";

    var pagerTitle = document.createElement("span");
    pagerTitle.className = "pager-title";
    pagerTitle.textContent = neighbour.title;

    text.appendChild(label);
    text.appendChild(pagerTitle);
    link.appendChild(text);

    return link;
  }

  function bindKeyboardNav(neighbours) {
    document.addEventListener("keydown", function (event) {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
        return;
      }
      var target = event.target;
      var tag = target && target.tagName;
      if ((target && target.isContentEditable) || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
        return;
      }
      if (!compareModalOverlay.hidden) {
        return;
      }
      if (event.key === "ArrowLeft") {
        window.location.href = "book.html?id=" + encodeURIComponent(neighbours.prev.id);
      } else if (event.key === "ArrowRight") {
        window.location.href = "book.html?id=" + encodeURIComponent(neighbours.next.id);
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Compare tray rendering (shared with js/main.js)                      */
  /* ------------------------------------------------------------------ */

  function refreshCompareUI() {
    renderTray();
    if (book) {
      var btn = detailRoot.querySelector(".btn-block");
      if (btn && typeof btn._refresh === "function") {
        btn._refresh();
      }
    }
  }

  function renderTray() {
    if (!compareTray) {
      return;
    }
    var list = getCompareList();

    if (list.length === 0) {
      compareTray.hidden = true;
      return;
    }
    compareTray.hidden = false;

    trayCovers.replaceChildren();
    list.forEach(function (id) {
      var b = findBook(id);
      if (!b) {
        return;
      }
      var item = document.createElement("div");
      item.className = "tray-cover-item";
      item.style.setProperty("--cover-a", b.coverFrom);
      item.style.setProperty("--cover-b", b.coverTo);

      if (b.cover) {
        var img = document.createElement("img");
        img.src = b.cover;
        img.alt = "";
        img.loading = "lazy";
        img.addEventListener("error", function () {
          img.remove();
        });
        item.appendChild(img);
      }

      var removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "tray-cover-remove";
      removeBtn.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true" width="10" height="10">' +
        '<line x1="18" y1="6" x2="6" y2="18" stroke-linecap="round"></line>' +
        '<line x1="6" y1="6" x2="18" y2="18" stroke-linecap="round"></line></svg>';
      removeBtn.setAttribute("aria-label", "Remove " + b.title + " from compare tray");
      removeBtn.addEventListener("click", function () {
        toggleCompare(b.id);
      });

      item.appendChild(removeBtn);
      trayCovers.appendChild(item);
    });

    trayCount.textContent = list.length + " of " + COMPARE_MAX + " selected";
    trayCompareBtn.disabled = list.length < 2;
    trayCompareBtn.title = list.length < 2 ? "Select at least 2 books to compare" : "";
  }

  /* ------------------------------------------------------------------ */
  /* Compare modal (shared with js/main.js)                               */
  /* ------------------------------------------------------------------ */

  function buildCompareCover(theBook) {
    var cover = document.createElement("div");
    cover.className = "compare-cover";
    cover.style.setProperty("--cover-a", theBook.coverFrom);
    cover.style.setProperty("--cover-b", theBook.coverTo);
    if (theBook.cover) {
      var img = document.createElement("img");
      img.src = theBook.cover;
      img.alt = "Cover of " + theBook.title;
      img.loading = "lazy";
      img.addEventListener("error", function () {
        img.remove();
      });
      cover.appendChild(img);
    }
    return cover;
  }

  function makeBarCell(valueText, percent) {
    var cell = document.createElement("div");
    cell.className = "compare-cell";

    var value = document.createElement("p");
    value.className = "compare-value";
    value.textContent = valueText;
    cell.appendChild(value);

    var track = document.createElement("div");
    track.className = "compare-bar-track";
    var fill = document.createElement("div");
    fill.className = "compare-bar-fill";
    fill.style.width = Math.max(0, Math.min(100, percent)) + "%";
    track.appendChild(fill);
    cell.appendChild(track);

    return cell;
  }

  function makeLabelCell(text) {
    var cell = document.createElement("div");
    cell.className = "compare-cell compare-label-cell";
    cell.textContent = text;
    return cell;
  }

  function renderCompareModal() {
    var ids = getCompareList();
    var books = ids.map(findBook).filter(Boolean);

    if (books.length < 2) {
      compareModalBody.replaceChildren();
      var msg = document.createElement("p");
      msg.className = "compare-empty-msg";
      msg.textContent = "Select at least 2 books in the tray to compare them side by side.";
      compareModalBody.appendChild(msg);
      return;
    }

    var maxPages = Math.max.apply(null, books.map(function (b) {
      return typeof b.pages === "number" ? b.pages : 0;
    }).concat([1]));

    var scroll = document.createElement("div");
    scroll.className = "compare-scroll";
    var gridEl = document.createElement("div");
    gridEl.className = "compare-grid";
    gridEl.style.gridTemplateColumns = "150px repeat(" + books.length + ", minmax(160px, 1fr))";

    gridEl.appendChild(document.createElement("div"));
    books.forEach(function (b) {
      var cell = document.createElement("div");
      cell.className = "compare-cell compare-cover-cell";
      cell.appendChild(buildCompareCover(b));
      gridEl.appendChild(cell);
    });

    gridEl.appendChild(document.createElement("div"));
    books.forEach(function (b) {
      var cell = document.createElement("div");
      cell.className = "compare-cell compare-title-cell";
      var h3 = document.createElement("h3");
      h3.textContent = b.title;
      var p = document.createElement("p");
      p.textContent = b.author;
      cell.appendChild(h3);
      cell.appendChild(p);
      gridEl.appendChild(cell);
    });

    gridEl.appendChild(makeLabelCell("Rating"));
    books.forEach(function (b) {
      var rating = typeof b.rating === "number" ? b.rating : 0;
      var pct = (rating / 5) * 100;
      gridEl.appendChild(makeBarCell(rating ? rating.toFixed(1) + " / 5" : "Not rated", pct));
    });

    gridEl.appendChild(makeLabelCell("Year"));
    var yearSpan = dataYearMax - dataYearMin || 1;
    books.forEach(function (b) {
      var year = b.year;
      var pct = typeof year === "number" ? ((year - dataYearMin) / yearSpan) * 100 : 0;
      gridEl.appendChild(makeBarCell(typeof year === "number" ? String(year) : "Unknown", pct));
    });

    gridEl.appendChild(makeLabelCell("Pages"));
    books.forEach(function (b) {
      var pages = typeof b.pages === "number" ? b.pages : 0;
      var pct = (pages / maxPages) * 100;
      gridEl.appendChild(makeBarCell(pages ? pages.toLocaleString() + " pp" : "Unknown", pct));
    });

    gridEl.appendChild(makeLabelCell("Genre"));
    books.forEach(function (b) {
      var cell = document.createElement("div");
      cell.className = "compare-cell";
      var chip = document.createElement("span");
      chip.className = "compare-chip";
      chip.textContent = b.genre;
      cell.appendChild(chip);
      gridEl.appendChild(cell);
    });

    gridEl.appendChild(makeLabelCell("Language"));
    books.forEach(function (b) {
      var cell = document.createElement("div");
      cell.className = "compare-cell";
      cell.textContent = b.language || "Unknown";
      gridEl.appendChild(cell);
    });

    gridEl.appendChild(document.createElement("div"));
    books.forEach(function (b) {
      var cell = document.createElement("div");
      cell.className = "compare-cell compare-remove-cell";
      var removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "compare-remove-btn";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", function () {
        toggleCompare(b.id);
        renderCompareModal();
      });
      cell.appendChild(removeBtn);
      gridEl.appendChild(cell);
    });

    scroll.appendChild(gridEl);
    compareModalBody.replaceChildren(scroll);
  }

  function getFocusable(container) {
    return Array.prototype.filter.call(
      container.querySelectorAll('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])'),
      function (el) {
        return el.offsetParent !== null;
      }
    );
  }

  function trapFocus(event) {
    if (event.key !== "Tab") {
      return;
    }
    var focusable = getFocusable(compareModal);
    if (!focusable.length) {
      return;
    }
    var first = focusable[0];
    var last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function onModalKeydown(event) {
    if (event.key === "Escape") {
      closeCompareModal();
    } else {
      trapFocus(event);
    }
  }

  function openCompareModal() {
    if (getCompareList().length < 2) {
      return;
    }
    renderCompareModal();
    lastFocusedBeforeModal = document.activeElement;
    compareModalOverlay.hidden = false;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onModalKeydown);
    window.setTimeout(function () {
      compareModalClose.focus();
    }, 0);
  }

  function closeCompareModal() {
    compareModalOverlay.hidden = true;
    document.body.style.overflow = "";
    document.removeEventListener("keydown", onModalKeydown);
    if (lastFocusedBeforeModal && typeof lastFocusedBeforeModal.focus === "function") {
      lastFocusedBeforeModal.focus();
    }
  }

  function bindCompareEvents() {
    if (trayClearBtn) {
      trayClearBtn.addEventListener("click", function () {
        setCompareList([]);
        refreshCompareUI();
      });
    }
    if (trayCompareBtn) {
      trayCompareBtn.addEventListener("click", openCompareModal);
    }
    if (compareModalClose) {
      compareModalClose.addEventListener("click", closeCompareModal);
    }
    if (compareModalOverlay) {
      compareModalOverlay.addEventListener("click", function (event) {
        if (event.target === compareModalOverlay) {
          closeCompareModal();
        }
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Boot                                                                  */
  /* ------------------------------------------------------------------ */

  computeYearRange();
  bindCompareEvents();
  renderTray();

  if (!book) {
    renderNotFound();
  } else {
    renderDetail(book);
  }
})();

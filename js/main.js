/* ==========================================================================
   Variation E — "Glassmorphic Aurora"
   Home page logic: search, sort, single-select genre filter, live result
   count, empty state, and the floating Compare Tray + comparison modal
   (persisted in localStorage under "aurora-compare").
   Plain script, no modules — must run from file://.
   ========================================================================== */

(function () {
  "use strict";

  /* ------------------------------------------------------------------ */
  /* Constants                                                            */
  /* ------------------------------------------------------------------ */

  var SEARCH_DEBOUNCE_MS = 180;
  var COMPARE_KEY = "aurora-compare";
  var COMPARE_MAX = 3;
  var TOAST_MS = 2600;

  var STAR_SVG =
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
    '<path d="M12 2.5l2.9 6.3 6.9.8-5.1 4.7 1.4 6.8-6.1-3.5-6.1 3.5 1.4-6.8-5.1-4.7 6.9-.8z"/>' +
    "</svg>";

  var PLUS_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true">' +
    '<line x1="12" y1="5" x2="12" y2="19" stroke-linecap="round"></line>' +
    '<line x1="5" y1="12" x2="19" y2="12" stroke-linecap="round"></line></svg>';

  var CHECK_SVG =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true">' +
    '<path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round"></path></svg>';

  /* ------------------------------------------------------------------ */
  /* DOM references                                                       */
  /* ------------------------------------------------------------------ */

  var grid = document.getElementById("bookGrid");
  var headerNote = document.getElementById("headerNote");
  var resultCount = document.getElementById("resultCount");
  var searchInput = document.getElementById("searchInput");
  var searchClear = document.getElementById("searchClear");
  var sortSelect = document.getElementById("sortSelect");
  var genreFilter = document.getElementById("genreFilter");

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

  /* ------------------------------------------------------------------ */
  /* State                                                                */
  /* ------------------------------------------------------------------ */

  var state = {
    search: "",
    genre: "All",
    sortBy: "title-asc"
  };

  var searchDebounceTimer = null;
  var toastTimer = null;
  var lastFocusedBeforeModal = null;
  var dataYearMin = 0;
  var dataYearMax = 0;

  /* ------------------------------------------------------------------ */
  /* localStorage helpers                                                 */
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
      return true; // now removed
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
  /* Cover rendering                                                       */
  /* ------------------------------------------------------------------ */

  function attachCoverImage(coverEl, book) {
    if (!book.cover) {
      return;
    }
    var img = document.createElement("img");
    img.className = "cover-img";
    img.src = book.cover;
    img.alt = "";
    img.loading = "lazy";
    img.addEventListener("error", function () {
      if (img.parentNode) {
        img.parentNode.removeChild(img);
      }
    });
    coverEl.insertBefore(img, coverEl.firstChild);
  }

  function buildCover(book) {
    var cover = document.createElement("div");
    cover.className = "book-cover";
    cover.style.setProperty("--cover-a", book.coverFrom);
    cover.style.setProperty("--cover-b", book.coverTo);

    var coverTitle = document.createElement("p");
    coverTitle.className = "cover-title";
    coverTitle.textContent = book.title;

    var coverAuthor = document.createElement("p");
    coverAuthor.className = "cover-author";
    coverAuthor.textContent = book.author;

    cover.appendChild(coverTitle);
    cover.appendChild(coverAuthor);
    attachCoverImage(cover, book);
    return cover;
  }

  /* ------------------------------------------------------------------ */
  /* Genre pills                                                          */
  /* ------------------------------------------------------------------ */

  function buildFacetData() {
    var genreCounts = {};
    var years = [];
    BOOKS.forEach(function (book) {
      genreCounts[book.genre] = (genreCounts[book.genre] || 0) + 1;
      if (book.year !== null && book.year !== undefined) {
        years.push(book.year);
      }
    });
    dataYearMin = years.length ? Math.min.apply(null, years) : 0;
    dataYearMax = years.length ? Math.max.apply(null, years) : 0;

    var genres = Object.keys(genreCounts).sort(function (a, b) {
      return a.localeCompare(b);
    });
    return { genres: genres, genreCounts: genreCounts };
  }

  function renderGenrePills(facetData) {
    if (!genreFilter) {
      return;
    }
    var fragment = document.createDocumentFragment();

    function makePill(label, value, count) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pill";
      btn.setAttribute("aria-pressed", value === state.genre ? "true" : "false");
      btn.textContent = count !== undefined ? label + " (" + count + ")" : label;
      btn.addEventListener("click", function () {
        state.genre = value;
        Array.prototype.forEach.call(genreFilter.children, function (child) {
          child.setAttribute("aria-pressed", "false");
        });
        btn.setAttribute("aria-pressed", "true");
        renderResults();
      });
      return btn;
    }

    fragment.appendChild(makePill("All genres", "All", BOOKS.length));
    facetData.genres.forEach(function (genre) {
      fragment.appendChild(makePill(genre, genre, facetData.genreCounts[genre]));
    });

    genreFilter.appendChild(fragment);
  }

  /* ------------------------------------------------------------------ */
  /* Filtering, sorting                                                    */
  /* ------------------------------------------------------------------ */

  function matchesSearch(book, needle) {
    if (book.title.toLowerCase().indexOf(needle) !== -1) {
      return true;
    }
    if (book.author.toLowerCase().indexOf(needle) !== -1) {
      return true;
    }
    if (
      book.tags &&
      book.tags.some(function (tag) {
        return tag.toLowerCase().indexOf(needle) !== -1;
      })
    ) {
      return true;
    }
    return false;
  }

  function matchesFilters(book) {
    if (state.search && !matchesSearch(book, state.search)) {
      return false;
    }
    if (state.genre !== "All" && book.genre !== state.genre) {
      return false;
    }
    return true;
  }

  function numOrNegInfinity(value) {
    return value === null || value === undefined ? -Infinity : value;
  }

  var sortComparators = {
    "title-asc": function (a, b) {
      return a.title.localeCompare(b.title);
    },
    "year-desc": function (a, b) {
      return numOrNegInfinity(b.year) - numOrNegInfinity(a.year);
    },
    "rating-desc": function (a, b) {
      return numOrNegInfinity(b.rating) - numOrNegInfinity(a.rating);
    },
    "pages-desc": function (a, b) {
      return numOrNegInfinity(b.pages) - numOrNegInfinity(a.pages);
    }
  };

  function computeResults() {
    var filtered = BOOKS.filter(matchesFilters);
    var comparator = sortComparators[state.sortBy] || sortComparators["title-asc"];
    filtered.sort(comparator);
    return filtered;
  }

  /* ------------------------------------------------------------------ */
  /* Card rendering                                                        */
  /* ------------------------------------------------------------------ */

  function createCompareToggle(book) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "compare-toggle";

    function refresh() {
      var comparing = isComparing(book.id);
      var full = getCompareList().length >= COMPARE_MAX;
      btn.setAttribute("aria-pressed", comparing ? "true" : "false");
      btn.innerHTML = comparing ? CHECK_SVG : PLUS_SVG;
      btn.setAttribute(
        "aria-label",
        (comparing ? "Remove " : "Add ") + book.title + (comparing ? " from" : " to") + " compare tray"
      );
      if (full && !comparing) {
        btn.setAttribute("aria-disabled", "true");
        btn.title = "Compare tray is full (max " + COMPARE_MAX + ")";
      } else {
        btn.removeAttribute("aria-disabled");
        btn.removeAttribute("title");
      }
    }

    btn.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      toggleCompare(book.id);
      refresh();
    });

    refresh();
    btn._refresh = refresh;
    return btn;
  }

  function createBookCard(book) {
    var item = document.createElement("li");
    item.className = "book-card";

    var link = document.createElement("a");
    link.className = "book-card-link";
    link.href = "book.html?id=" + encodeURIComponent(book.id);

    var label = book.title + " by " + book.author + ", " + book.genre;
    if (book.rating !== null && book.rating !== undefined) {
      label += ", rated " + book.rating + " out of 5";
    }
    link.setAttribute("aria-label", label);

    link.appendChild(buildCover(book));

    var body = document.createElement("div");
    body.className = "book-card-body";

    var title = document.createElement("h2");
    title.className = "book-title";
    title.textContent = book.title;

    var author = document.createElement("p");
    author.className = "book-author";
    author.textContent =
      book.year !== null && book.year !== undefined ? book.author + " · " + book.year : book.author;

    var meta = document.createElement("div");
    meta.className = "book-meta";

    var badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = book.genre;
    meta.appendChild(badge);

    if (book.rating !== null && book.rating !== undefined) {
      var rating = document.createElement("span");
      rating.className = "rating";
      rating.innerHTML = STAR_SVG;
      rating.appendChild(document.createTextNode(book.rating.toFixed(1)));
      meta.appendChild(rating);
    }

    body.appendChild(title);
    body.appendChild(author);
    body.appendChild(meta);

    link.appendChild(body);
    item.appendChild(link);
    item.appendChild(createCompareToggle(book));

    return item;
  }

  function createEmptyState() {
    var item = document.createElement("li");
    item.className = "empty-state";
    item.innerHTML =
      "<strong>No matches</strong><p>Try a different search term or pick another genre.</p>";
    return item;
  }

  /* ------------------------------------------------------------------ */
  /* Rendering pipeline                                                    */
  /* ------------------------------------------------------------------ */

  function updateResultCount(count) {
    if (!resultCount) {
      return;
    }
    resultCount.replaceChildren();
    var mark = document.createElement("mark");
    mark.textContent = String(count);
    resultCount.appendChild(mark);
    resultCount.appendChild(document.createTextNode(" book" + (count === 1 ? "" : "s") + " found"));
  }

  function renderResults() {
    var results = computeResults();
    var fragment = document.createDocumentFragment();

    if (results.length === 0) {
      fragment.appendChild(createEmptyState());
    } else {
      results.forEach(function (book) {
        fragment.appendChild(createBookCard(book));
      });
    }

    grid.replaceChildren(fragment);
    updateResultCount(results.length);
  }

  /* ------------------------------------------------------------------ */
  /* Search toolbar                                                       */
  /* ------------------------------------------------------------------ */

  function toggleClearButton() {
    if (!searchClear || !searchInput) {
      return;
    }
    searchClear.classList.toggle("is-visible", searchInput.value.length > 0);
  }

  function runSearch() {
    state.search = searchInput.value.trim().toLowerCase();
    renderResults();
  }

  /* ------------------------------------------------------------------ */
  /* Compare tray rendering                                               */
  /* ------------------------------------------------------------------ */

  function refreshCompareUI() {
    renderTray();
    refreshVisibleToggles();
  }

  function refreshVisibleToggles() {
    if (!grid) {
      return;
    }
    Array.prototype.forEach.call(grid.querySelectorAll(".compare-toggle"), function (btn) {
      if (typeof btn._refresh === "function") {
        btn._refresh();
      }
    });
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
      var book = findBook(id);
      if (!book) {
        return;
      }
      var item = document.createElement("div");
      item.className = "tray-cover-item";
      item.style.setProperty("--cover-a", book.coverFrom);
      item.style.setProperty("--cover-b", book.coverTo);

      if (book.cover) {
        var img = document.createElement("img");
        img.src = book.cover;
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
      removeBtn.setAttribute("aria-label", "Remove " + book.title + " from compare tray");
      removeBtn.addEventListener("click", function () {
        toggleCompare(book.id);
      });

      item.appendChild(removeBtn);
      trayCovers.appendChild(item);
    });

    trayCount.textContent = list.length + " of " + COMPARE_MAX + " selected";
    trayCompareBtn.disabled = list.length < 2;
    trayCompareBtn.title = list.length < 2 ? "Select at least 2 books to compare" : "";
  }

  /* ------------------------------------------------------------------ */
  /* Compare modal                                                        */
  /* ------------------------------------------------------------------ */

  function buildCompareCover(book) {
    var cover = document.createElement("div");
    cover.className = "compare-cover";
    cover.style.setProperty("--cover-a", book.coverFrom);
    cover.style.setProperty("--cover-b", book.coverTo);
    if (book.cover) {
      var img = document.createElement("img");
      img.src = book.cover;
      img.alt = "Cover of " + book.title;
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

    // Cover row
    gridEl.appendChild(document.createElement("div"));
    books.forEach(function (book) {
      var cell = document.createElement("div");
      cell.className = "compare-cell compare-cover-cell";
      cell.appendChild(buildCompareCover(book));
      gridEl.appendChild(cell);
    });

    // Title/author row
    gridEl.appendChild(document.createElement("div"));
    books.forEach(function (book) {
      var cell = document.createElement("div");
      cell.className = "compare-cell compare-title-cell";
      var h3 = document.createElement("h3");
      h3.textContent = book.title;
      var p = document.createElement("p");
      p.textContent = book.author;
      cell.appendChild(h3);
      cell.appendChild(p);
      gridEl.appendChild(cell);
    });

    // Rating row
    gridEl.appendChild(makeLabelCell("Rating"));
    books.forEach(function (book) {
      var rating = typeof book.rating === "number" ? book.rating : 0;
      var pct = (rating / 5) * 100;
      gridEl.appendChild(makeBarCell(rating ? rating.toFixed(1) + " / 5" : "Not rated", pct));
    });

    // Year row
    gridEl.appendChild(makeLabelCell("Year"));
    var yearSpan = dataYearMax - dataYearMin || 1;
    books.forEach(function (book) {
      var year = book.year;
      var pct = typeof year === "number" ? ((year - dataYearMin) / yearSpan) * 100 : 0;
      gridEl.appendChild(makeBarCell(typeof year === "number" ? String(year) : "Unknown", pct));
    });

    // Pages row
    gridEl.appendChild(makeLabelCell("Pages"));
    books.forEach(function (book) {
      var pages = typeof book.pages === "number" ? book.pages : 0;
      var pct = (pages / maxPages) * 100;
      gridEl.appendChild(makeBarCell(pages ? pages.toLocaleString() + " pp" : "Unknown", pct));
    });

    // Genre row
    gridEl.appendChild(makeLabelCell("Genre"));
    books.forEach(function (book) {
      var cell = document.createElement("div");
      cell.className = "compare-cell";
      var chip = document.createElement("span");
      chip.className = "compare-chip";
      chip.textContent = book.genre;
      cell.appendChild(chip);
      gridEl.appendChild(cell);
    });

    // Language row
    gridEl.appendChild(makeLabelCell("Language"));
    books.forEach(function (book) {
      var cell = document.createElement("div");
      cell.className = "compare-cell";
      cell.textContent = book.language || "Unknown";
      gridEl.appendChild(cell);
    });

    // Remove row
    gridEl.appendChild(document.createElement("div"));
    books.forEach(function (book) {
      var cell = document.createElement("div");
      cell.className = "compare-cell compare-remove-cell";
      var removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "compare-remove-btn";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", function () {
        toggleCompare(book.id);
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

  /* ------------------------------------------------------------------ */
  /* Event bindings                                                        */
  /* ------------------------------------------------------------------ */

  function bindEvents() {
    if (searchInput) {
      searchInput.addEventListener("input", function () {
        toggleClearButton();
        if (searchDebounceTimer) {
          window.clearTimeout(searchDebounceTimer);
        }
        searchDebounceTimer = window.setTimeout(runSearch, SEARCH_DEBOUNCE_MS);
      });
      searchInput.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
          searchInput.value = "";
          toggleClearButton();
          runSearch();
          searchInput.focus();
        }
      });
    }

    if (searchClear) {
      searchClear.addEventListener("click", function () {
        searchInput.value = "";
        toggleClearButton();
        runSearch();
        searchInput.focus();
      });
    }

    if (sortSelect) {
      sortSelect.addEventListener("change", function () {
        state.sortBy = sortSelect.value;
        renderResults();
      });
    }

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

  function init() {
    if (typeof BOOKS === "undefined" || !BOOKS.length) {
      if (headerNote) {
        headerNote.textContent = "Catalogue unavailable";
      }
      grid.replaceChildren();
      var errorItem = document.createElement("li");
      errorItem.className = "empty-state";
      errorItem.innerHTML = "<strong>Could not load the catalogue.</strong>";
      grid.appendChild(errorItem);
      return;
    }

    if (headerNote) {
      headerNote.textContent = BOOKS.length + " titles in the collection";
    }

    var facetData = buildFacetData();
    renderGenrePills(facetData);

    bindEvents();
    renderResults();
    renderTray();
  }

  init();
})();

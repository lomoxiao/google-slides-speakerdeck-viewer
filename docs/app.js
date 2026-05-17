const INITIAL_PAGE_COUNT = 1;
const PREFETCH_PAGE_COUNT = 3;
const GALLERY_PAGE_SIZE = 3;
const MOBILE_GALLERY_PAGE_SIZE = 5;
const BUILD_ID = "github-pages-api-mvp-20260509";

const state = {
  presentations: [],
  filteredPresentations: [],
  currentPresentation: null,
  currentPageIndex: 0,
  isSlideshowMode: false,
  isReading: false,
  speechRate: 1.0,
  pendingUrls: [],
  pollingTimer: null,
  knownIds: new Set(),
  isRequestingGeneration: false,
  isRefreshingPresentations: false,
  touchStartX: null,
  touchStartY: null,
  pageWindowRequests: {},
  prefetchQueue: {},
  isPrefetching: false,
  generationMode: "url",
  isGenerationPanelOpen: false,
  isSearchOpen: false,
  pendingStatusTimer: null,
  isNoteSheetOpen: false,
  galleryPageIndex: 0,
  isMobileLayout: false,
  controlsIdleTimer: null,
  toastTimer: null,
  fullscreenRequestId: 0,
  viewerTouchStartX: null,
  viewerTouchStartY: null,
  viewerTouchStartTarget: null,
  isAutoImmersive: false
};

const samplePresentations = [
  createSamplePresentation("product-strategy-2026", "Product Strategy 2026", "https://example.com/product-strategy", "2026-04-29T00:00:00Z", "f7f8fa", "222831", 8),
  createSamplePresentation("design-review", "Design Review: Quiet Interfaces", "https://example.com/design-review", "2026-04-24T09:30:00Z", "f2f0ec", "2f3437", 12),
  createSamplePresentation("market-research", "Market Research Notes", "https://example.com/market-research", "2026-04-20T15:10:00Z", "eef3f0", "24312b", 10),
  createSamplePresentation("quarterly-planning", "Quarterly Planning Deck https://example.com/quarterly-planning", "", "2026-04-12T12:00:00Z", "f5f1f1", "332a2a", 6)
];

const apiClient = {
  getConfig: function() {
    return window.SLIDE_VIEWER_CONFIG || {};
  },

  hasApiUrl: function() {
    return Boolean(this.getConfig().GAS_API_URL);
  },

  get: function(action, params) {
    const config = this.getConfig();
    const url = new URL(config.GAS_API_URL);
    url.searchParams.set("action", action);
    if (config.CLIENT_KEY) {
      url.searchParams.set("clientKey", config.CLIENT_KEY);
    }
    Object.keys(params || {}).forEach(function(key) {
      if (params[key] !== undefined && params[key] !== null) {
        url.searchParams.set(key, String(params[key]));
      }
    });
    return fetch(url.toString(), { method: "GET" }).then(parseApiResponse);
  },

  post: function(action, payload) {
    const config = this.getConfig();
    return fetch(config.GAS_API_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(Object.assign({}, payload || {}, {
        action: action,
        clientKey: config.CLIENT_KEY || ""
      }))
    }).then(parseApiResponse);
  }
};

function parseApiResponse(response) {
  if (!response.ok) {
    throw new Error("API request failed: HTTP " + response.status);
  }
  return response.json().then(function(result) {
    if (!result || !result.ok) {
      const message = result && result.error && result.error.message
        ? result.error.message
        : "API request failed.";
      throw new Error(message);
    }
    return result.data;
  });
}

function init() {
  updateResponsiveMode();
  bindEvents();
  updateDebugPanel();
  prefillGenerationFromNewsParams();
  loadPresentations();
}

function bindEvents() {
  document.getElementById("searchInput").addEventListener("input", function(event) {
    filterPresentations(event.target.value);
  });

  document.getElementById("generationToggle").addEventListener("click", toggleGenerationPanel);
  document.getElementById("generationCloseButton").addEventListener("click", function() {
    setGenerationPanelOpen(false);
  });
  document.getElementById("generationSheetBackdrop").addEventListener("click", function() {
    setGenerationPanelOpen(false);
  });
  document.getElementById("searchToggle").addEventListener("click", toggleSearchPanel);
  document.getElementById("mobileLibraryButton").addEventListener("click", showMobileLibraryHome);
  document.getElementById("mobileSearchButton").addEventListener("click", function() {
    setSearchPanelOpen(true);
  });
  document.getElementById("searchCloseButton").addEventListener("click", function() {
    setSearchPanelOpen(false);
  });
  document.getElementById("searchSheetBackdrop").addEventListener("click", function() {
    setSearchPanelOpen(false);
  });
  document.getElementById("searchClearButton").addEventListener("click", function() {
    document.getElementById("searchInput").value = "";
    filterPresentations("");
    if (state.isSearchOpen) {
      document.getElementById("searchInput").focus();
    }
  });
  document.getElementById("refreshButton").addEventListener("click", refreshPresentationsNow);
  document.getElementById("mobileRefreshButton").addEventListener("click", refreshPresentationsNow);
  document.getElementById("mobileCreateButton").addEventListener("click", function() {
    setGenerationPanelOpen(true);
  });
  document.getElementById("mobileNoteButton").addEventListener("click", function() {
    setNoteSheetOpen(true);
  });
  document.getElementById("noteSheetCloseButton").addEventListener("click", function() {
    setNoteSheetOpen(false);
  });
  document.getElementById("noteSheetBackdrop").addEventListener("click", function() {
    setNoteSheetOpen(false);
  });

  document.querySelectorAll(".mode-tab").forEach(function(button) {
    button.addEventListener("click", function() {
      setGenerationMode(button.dataset.mode || "url");
    });
  });

  document.getElementById("galleryPrevButton").addEventListener("click", function() {
    changeGalleryPage(-1);
  });

  document.getElementById("galleryNextButton").addEventListener("click", function() {
    changeGalleryPage(1);
  });

  document.getElementById("generationPanel").addEventListener("submit", function(event) {
    event.preventDefault();
    requestGeneration();
  });

  const slideFrame = document.getElementById("slideFrame");
  slideFrame.addEventListener("touchstart", function(event) {
    if (!state.currentPresentation || !event.changedTouches.length) return;
    state.touchStartX = event.changedTouches[0].clientX;
    state.touchStartY = event.changedTouches[0].clientY;
  }, { passive: true });

  slideFrame.addEventListener("touchend", function(event) {
    if (!state.currentPresentation || state.touchStartX === null || !event.changedTouches.length) return;
    const dx = event.changedTouches[0].clientX - state.touchStartX;
    const dy = event.changedTouches[0].clientY - state.touchStartY;
    state.touchStartX = null;
    state.touchStartY = null;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
    if (dx < 0) nextPage();
    if (dx > 0) prevPage();
  }, { passive: true });

  const viewer = document.getElementById("viewerView");
  viewer.addEventListener("touchstart", handleViewerTouchStart, { passive: true });
  viewer.addEventListener("touchend", handleViewerTouchEnd, { passive: true });
  ["click", "mousemove"].forEach(function(eventName) {
    viewer.addEventListener(eventName, function(event) {
      if (eventName === "click" && isCoarsePointer()) return;
      wakeViewerControls();
    }, { passive: true });
  });

  document.addEventListener("keydown", function(event) {
    if (event.key === "Escape" && state.isGenerationPanelOpen) {
      setGenerationPanelOpen(false);
      return;
    }
    if (event.key === "Escape" && state.isSearchOpen) {
      setSearchPanelOpen(false);
      return;
    }
    if (!state.currentPresentation) return;
    if (event.key === "ArrowRight") nextPage();
    if (event.key === "ArrowLeft") prevPage();
    if (event.key === "Escape") {
      if (state.isNoteSheetOpen) {
        setNoteSheetOpen(false);
      } else if (state.isGenerationPanelOpen) {
        setGenerationPanelOpen(false);
      } else if (isViewerImmersive()) {
        exitViewerFullscreen();
      } else {
        showGallery();
      }
    }
    wakeViewerControls();
  });

  document.addEventListener("fullscreenchange", handleFullscreenChange);
  document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
  document.addEventListener("fullscreenerror", handleFullscreenError);
  document.addEventListener("webkitfullscreenerror", handleFullscreenError);
  window.addEventListener("orientationchange", handleViewportChange);
  window.addEventListener("resize", handleViewportChange);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", handleViewportChange);
  }
}

function loadPresentations() {
  showLoading(true);
  hideError();

  if (isGasRuntime()) {
    apiClient.get("listPresentations")
      .then(function(presentations) {
        setPresentations(presentations || []);
      })
      .catch(function(error) {
        showLoading(false);
        showError(error && error.message ? error.message : String(error));
      });
    return;
  }

  window.setTimeout(function() {
    setPresentations(samplePresentations);
  }, 350);
}

function setPresentations(presentations) {
  state.presentations = sortPresentations(presentations || []);
  state.filteredPresentations = filterPresentationList(document.getElementById("searchInput").value);
  state.galleryPageIndex = 0;
  state.knownIds = new Set(state.presentations.map(function(presentation) {
    return presentation.id;
  }));
  showLoading(false);
  renderGallery();
}

function refreshPresentationsNow() {
  if (state.isRefreshingPresentations) return;

  state.isRefreshingPresentations = true;
  hideError();
  setRefreshButtonsLoading(true);

  const complete = function() {
    state.isRefreshingPresentations = false;
    setRefreshButtonsLoading(false);
  };

  if (isGasRuntime()) {
    apiClient.get("listPresentations", { refresh: "1" })
      .then(function(presentations) {
        mergePresentationMeta(presentations || []);
        complete();
      })
      .catch(function() {
        showError("最新化に失敗しました。時間をおいて再度お試しください。");
        complete();
      });
    return;
  }

  window.setTimeout(function() {
    mergePresentationMeta(samplePresentations);
    complete();
  }, 350);
}

function setRefreshButtonsLoading(isLoading) {
  ["refreshButton", "mobileRefreshButton"].forEach(function(id) {
    const button = document.getElementById(id);
    if (!button) return;
    if (isLoading) {
      button.disabled = true;
      button.dataset.label = button.textContent;
      button.textContent = "最新化中...";
      return;
    }
    button.disabled = false;
    button.textContent = button.dataset.label || (id === "refreshButton" ? "↻ 最新化" : "最新化");
    delete button.dataset.label;
  });
}

function renderGallery() {
  const gallery = document.getElementById("gallery");
  gallery.innerHTML = "";
  hideError();
  renderGenerationStatusPanel();

  const items = state.filteredPresentations;
  const pageCount = getGalleryPageCount(items.length);
  state.galleryPageIndex = Math.min(state.galleryPageIndex, Math.max(pageCount - 1, 0));
  const pageSize = getGalleryPageSize();
  const start = state.galleryPageIndex * pageSize;
  const visibleItems = items.slice(start, start + pageSize);

  visibleItems.forEach(function(item, index) {
    const displayRank = start + index;
    gallery.appendChild(createPresentationCard(item, displayRank));
  });

  if (!state.filteredPresentations.length) {
    showEmpty("表示できるスライドがありません", "検索条件を変えるか、Drive の対象フォルダを確認してください。");
    renderGalleryPager(items.length);
    return;
  }

  hideEmpty();
  renderGalleryPager(items.length);
  hydrateGalleryThumbnails(visibleItems, true);
  warmHiddenPresentationThumbnails(visibleItems);
}

function createPresentationCard(presentation, displayRank) {
  const card = document.createElement("button");
  const isFeatured = displayRank % getGalleryPageSize() === 0;
  card.type = "button";
  card.className = "slide-card" + (isFeatured ? " is-featured" : " is-secondary");
  card.onclick = function() {
    openPresentation(presentation.id);
  };

  card.innerHTML =
    '<div class="card-thumb">' +
      imageMarkup(presentation.thumbnailUrl, presentation.title) +
    '</div>' +
    '<div class="card-body">' +
      (isFeatured ? '<span class="card-kicker">最新スライド</span>' : '') +
      '<h2 class="card-title">' + escapeHtml(presentation.title) + '</h2>' +
      '<div class="meta">' +
        '<span>' + formatDate(presentation.updatedAt) + '</span>' +
        '<span>' + Number(presentation.pageCount || (presentation.pages || []).length || 0) + '枚</span>' +
      '</div>' +
      renderSourceSlot(presentation) +
      '<span class="open-cue">開く</span>' +
    '</div>';

  return card;
}

function renderSourceSlot(presentation) {
  return presentation.sourceLabel
    ? '<div class="source-slot">' + escapeHtml(presentation.sourceLabel) + '</div>'
    : '';
}

function getGalleryPageCount(total) {
  return Math.max(1, Math.ceil(total / getGalleryPageSize()));
}

function getGalleryPageSize() {
  return isMobileViewport() ? MOBILE_GALLERY_PAGE_SIZE : GALLERY_PAGE_SIZE;
}

function renderGalleryPager(total) {
  const pager = document.getElementById("galleryPager");
  const pagerText = document.getElementById("galleryPagerText");
  const indicator = document.getElementById("galleryPageIndicator");
  const pageCount = getGalleryPageCount(total);
  const query = document.getElementById("searchInput").value.trim();
  const pageText = total
    ? (query ? total + "件" : "Page " + (state.galleryPageIndex + 1) + " / " + pageCount)
    : "";

  pager.hidden = total <= getGalleryPageSize();
  pagerText.textContent = pageText;
  indicator.textContent = pageText;
  document.getElementById("galleryPrevButton").disabled = state.galleryPageIndex <= 0;
  document.getElementById("galleryNextButton").disabled = state.galleryPageIndex >= pageCount - 1;
}

function changeGalleryPage(delta) {
  const total = state.filteredPresentations.length;
  const pageCount = getGalleryPageCount(total);
  state.galleryPageIndex = Math.max(0, Math.min(state.galleryPageIndex + delta, pageCount - 1));
  renderGallery();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function warmHiddenPresentationThumbnails(visibleItems) {
  if (!isGasRuntime()) return;
  const visibleIds = new Set(visibleItems.filter(function(item) {
    return typeof item !== "string";
  }).map(function(item) {
    return item.id;
  }));
  const missing = state.filteredPresentations.some(function(presentation) {
    return !visibleIds.has(presentation.id) && !presentation.thumbnailUrl;
  });
  if (!missing) return;
  window.setTimeout(function() {
    if (isGasRuntime()) {
      hydrateGalleryThumbnails(
        state.filteredPresentations.filter(function(presentation) {
          return !visibleIds.has(presentation.id) && !presentation.thumbnailUrl;
        }),
        false
      );
    }
  }, 250);
}

function hydrateGalleryThumbnails(items, shouldRender) {
  if (!isGasRuntime()) return;
  const targets = items.filter(function(item) {
    return typeof item !== "string" && item.id && !item.thumbnailUrl && !item.isThumbnailLoading;
  });
  targets.slice(0, shouldRender ? getGalleryPageSize() : 6).forEach(function(presentation) {
    presentation.isThumbnailLoading = true;
    apiClient.get("getFirstThumbnail", { presentationId: presentation.id })
      .then(function(meta) {
        presentation.isThumbnailLoading = false;
        mergeSinglePresentationMeta(meta);
        if (shouldRender) {
          renderGallery();
        } else {
          scheduleRemainingThumbnailHydration();
        }
      })
      .catch(function() {
        presentation.isThumbnailLoading = false;
      });
  });
}

function scheduleRemainingThumbnailHydration() {
  window.setTimeout(function() {
    hydrateGalleryThumbnails(
      state.filteredPresentations.filter(function(presentation) {
        return !presentation.thumbnailUrl;
      }),
      false
    );
  }, 250);
}

function mergeSinglePresentationMeta(meta) {
  if (!meta || !meta.id) return;
  state.presentations = state.presentations.map(function(item) {
    if (item.id !== meta.id) return item;
    return Object.assign({}, item, meta, { pages: item.pages || meta.pages || [] });
  });
  state.filteredPresentations = filterPresentationList(document.getElementById("searchInput").value);
}

function renderGenerationStatusPanel() {
  const panel = document.getElementById("generationStatusPanel");
  if (!state.pendingUrls.length) {
    panel.hidden = true;
    panel.innerHTML = "";
    stopPendingStatusTimer();
    return;
  }

  panel.hidden = false;
  panel.innerHTML =
    '<div class="status-panel-head">' +
      '<div><strong>Slackへ送信済み</strong><span>完了通知はSlackをご確認ください。</span></div>' +
      '<span>' + state.pendingUrls.length + '件</span>' +
    '</div>' +
    state.pendingUrls.map(function(item) {
      const status = getPendingStatus(item);
      return '<article class="pending-row">' +
        '<div class="pending-dot is-' + status.kind + '"></div>' +
        '<div>' +
          '<h2>' + escapeHtml(item.label) + '</h2>' +
          '<p>' + escapeHtml(status.text + (item.trackingId ? " / " + item.trackingId : "")) + '</p>' +
        '</div>' +
        '<time>' + formatElapsed(item.createdAt) + '</time>' +
      '</article>';
    }).join("");
}

function getPendingStatus(item) {
  return { kind: "sent", text: "Slack送信済み" };
}

function startPendingStatusTimer() {
  if (state.pendingStatusTimer) return;
  state.pendingStatusTimer = window.setInterval(renderGenerationStatusPanel, 1000);
}

function stopPendingStatusTimer() {
  if (!state.pendingStatusTimer) return;
  window.clearInterval(state.pendingStatusTimer);
  state.pendingStatusTimer = null;
}

function formatElapsed(startedAt) {
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  if (seconds < 60) return seconds + "秒前";
  return Math.floor(seconds / 60) + "分前";
}

function openPresentation(presentationId) {
  const presentation = state.presentations.find(function(item) {
    return item.id === presentationId;
  });

  if (!presentation) {
    showError("指定されたスライドが見つかりませんでした。");
    return;
  }

  state.currentPresentation = presentation;
  state.currentPageIndex = 0;
  state.pageWindowRequests = {};
  state.prefetchQueue = {};
  state.isPrefetching = false;
  document.getElementById("galleryView").classList.remove("is-visible");
  document.getElementById("viewerView").classList.add("is-visible");
  ensurePagePlaceholders(presentation);
  renderViewerShell();
  applyAutoImmersiveMode();

  if (isGasRuntime()) {
    renderViewer();
    loadPageWindow(presentationId, 0, INITIAL_PAGE_COUNT, true);
  } else {
    presentation.pages = presentation.localPages || presentation.pages || [];
    renderViewer();
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function ensurePagePlaceholders(presentation) {
  const pageCount = Number(presentation.pageCount || (presentation.pages || []).length || 0);
  if (!presentation.pages || presentation.pages.length !== pageCount || presentation.pages.some(function(page) { return !page; })) {
    const existing = presentation.pages || [];
    presentation.pages = [];
    for (let index = 0; index < pageCount; index += 1) {
      presentation.pages[index] = existing[index] || createPagePlaceholder(index, presentation);
    }
  }
}

function createPagePlaceholder(index, presentation) {
  const isFirstPagePreview = index === 0 && presentation && presentation.thumbnailUrl;
  return {
    pageObjectId: '',
    pageNumber: index + 1,
    imageUrl: isFirstPagePreview ? presentation.thumbnailUrl : '',
    speakerNote: '',
    hasSpeakerNote: false,
    isPreview: Boolean(isFirstPagePreview),
    isLoaded: false
  };
}

function loadPageWindow(presentationId, startIndex, count, isPriority) {
  const presentation = state.currentPresentation;
  if (!presentation || presentation.id !== presentationId) return;

  const pageCount = Number(presentation.pageCount || 0);
  if (!pageCount) return;

  const safeStart = Math.max(0, Math.min(startIndex, pageCount - 1));
  const safeCount = Math.max(1, Math.min(count, pageCount - safeStart));
  const requestKey = presentationId + ':' + safeStart + ':' + safeCount;

  if (state.pageWindowRequests[requestKey]) return;
  if (!hasUnloadedPage(presentation, safeStart, safeCount)) return;

  state.pageWindowRequests[requestKey] = true;

  if (isPriority) {
    showPageLoadingIfCurrentWindow(safeStart, safeCount);
  }

  apiClient.get("getPageWindow", {
    presentationId: presentationId,
    startIndex: safeStart,
    count: safeCount
  })
    .then(function(result) {
      delete state.pageWindowRequests[requestKey];
      mergePageWindow(presentationId, result);
      if (isPriority) {
        renderViewer();
      }
      queueRemainingPrefetch(presentationId);
    })
    .catch(function(error) {
      delete state.pageWindowRequests[requestKey];
      if (isPriority) {
        showViewerError(error && error.message ? error.message : String(error));
      }
    });
}

function mergePageWindow(presentationId, result) {
  const presentation = state.currentPresentation && state.currentPresentation.id === presentationId
    ? state.currentPresentation
    : state.presentations.find(function(item) { return item.id === presentationId; });

  if (!presentation || !result) return;

  presentation.pageCount = result.pageCount || presentation.pageCount;
  ensurePagePlaceholders(presentation);

  (result.pages || []).forEach(function(page, offset) {
    const index = Number(result.startIndex || 0) + offset;
    presentation.pages[index] = Object.assign({}, page, { isLoaded: true });
  });

  const stored = state.presentations.find(function(item) {
    return item.id === presentationId;
  });
  if (stored && stored !== presentation) {
    stored.pages = presentation.pages;
  }

  if (state.currentPresentation && state.currentPresentation.id === presentationId) {
    renderViewer();
  }
}

function hasUnloadedPage(presentation, startIndex, count) {
  for (let index = startIndex; index < startIndex + count; index += 1) {
    if (!presentation.pages[index] || !presentation.pages[index].isLoaded) {
      return true;
    }
  }
  return false;
}

function showPageLoadingIfCurrentWindow(startIndex, count) {
  const current = state.currentPageIndex;
  if (current < startIndex || current >= startIndex + count) return;
  showViewerLoading();
}

function queueRemainingPrefetch(presentationId) {
  const presentation = state.currentPresentation;
  if (!presentation || presentation.id !== presentationId || !isGasRuntime()) return;
  const pageCount = Number(presentation.pageCount || 0);

  for (let index = 0; index < pageCount; index += PREFETCH_PAGE_COUNT) {
    if (hasUnloadedPage(presentation, index, PREFETCH_PAGE_COUNT)) {
      state.prefetchQueue[presentationId + ':' + index] = {
        presentationId: presentationId,
        startIndex: index,
        count: PREFETCH_PAGE_COUNT
      };
    }
  }

  runNextPrefetch();
}

function runNextPrefetch() {
  if (state.isPrefetching || !isGasRuntime()) return;
  const keys = Object.keys(state.prefetchQueue);
  if (!keys.length) return;

  const key = keys[0];
  const next = state.prefetchQueue[key];
  delete state.prefetchQueue[key];
  state.isPrefetching = true;

  apiClient.get("getPageWindow", {
    presentationId: next.presentationId,
    startIndex: next.startIndex,
    count: next.count
  })
    .then(function(result) {
      state.isPrefetching = false;
      mergePageWindow(next.presentationId, result);
      runNextPrefetch();
    })
    .catch(function() {
      state.isPrefetching = false;
      runNextPrefetch();
    });
}

function renderViewerShell() {
  const presentation = state.currentPresentation;
  if (!presentation) return;
  document.getElementById("viewerTitle").textContent = presentation.title;
  renderSourceLink();
  renderSpeakerNote();
}

function renderViewer() {
  const presentation = state.currentPresentation;
  if (!presentation) return;
  ensurePagePlaceholders(presentation);

  const pages = presentation.pages || [];
  const page = pages[state.currentPageIndex];
  const total = Number(presentation.pageCount || pages.length || 0);

  renderViewerShell();
  document.getElementById("pageIndicator").textContent = total
    ? "Page " + (state.currentPageIndex + 1) + " / " + total
    : "No pages";
  document.getElementById("mobilePageIndicator").textContent = total
    ? (state.currentPageIndex + 1) + " / " + total
    : "";

  document.getElementById("prevButton").disabled = state.currentPageIndex <= 0;
  document.getElementById("nextButton").disabled = state.currentPageIndex >= total - 1;

  const slideFrame = document.getElementById("slideFrame");
  if (page && (page.isLoaded || page.imageUrl)) {
    slideFrame.innerHTML = imageMarkup(page.imageUrl, presentation.title + " page " + page.pageNumber);
    if (!page.isLoaded && isGasRuntime()) {
      loadPageWindow(presentation.id, state.currentPageIndex, INITIAL_PAGE_COUNT, true);
    }
  } else if (page) {
    slideFrame.innerHTML = '<div class="viewer-message"><div><div class="loader" aria-hidden="true"></div><strong>ページを読み込んでいます</strong><span>このページを優先取得しています。</span></div></div>';
    if (isGasRuntime()) {
      loadPageWindow(presentation.id, state.currentPageIndex, INITIAL_PAGE_COUNT, true);
    }
  } else {
    slideFrame.innerHTML = '<div class="image-fallback">ページ画像がありません</div>';
  }

  renderPageStrip();
  renderSpeakerNote();
}

function showViewerLoading() {
  document.getElementById("pageIndicator").textContent = "ページを読み込んでいます";
  document.getElementById("prevButton").disabled = true;
  document.getElementById("nextButton").disabled = true;
  document.getElementById("slideFrame").innerHTML =
    '<div class="viewer-message"><div><div class="loader" aria-hidden="true"></div><strong>ページを読み込んでいます</strong><span>サムネイルとスピーカーノートを取得中です。</span></div></div>';
  document.getElementById("pageStrip").innerHTML = "";
  renderSpeakerNote("ページ読み込み後に表示します。");
}

function showViewerError(message) {
  document.getElementById("pageIndicator").textContent = "ページ読み込み失敗";
  document.getElementById("slideFrame").innerHTML =
    '<div class="viewer-message is-error"><div><strong>ページを読み込めませんでした</strong><span>' + escapeHtml(message) + '</span></div></div>';
  document.getElementById("pageStrip").innerHTML = "";
  renderSpeakerNote("ページを読み込めなかったため、ノートを表示できません。");
}

function renderPageStrip() {
  const pageStrip = document.getElementById("pageStrip");
  const pages = state.currentPresentation ? state.currentPresentation.pages || [] : [];
  pageStrip.innerHTML = "";

  pages.forEach(function(page, index) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "thumb-button" + (index === state.currentPageIndex ? " is-active" : "");
    button.setAttribute("aria-label", "Page " + page.pageNumber);
    button.onclick = function() {
      goToPage(index);
    };
    button.innerHTML = page.isLoaded || page.imageUrl
      ? imageMarkup(page.imageUrl, "Page " + page.pageNumber)
      : '<div class="image-fallback">Page ' + page.pageNumber + '</div>';
    pageStrip.appendChild(button);
  });
}

function renderSpeakerNote(fallbackMessage) {
  const noteContent = document.getElementById("speakerNoteContent");
  const mobileNoteContent = document.getElementById("mobileNoteContent");
  const pages = state.currentPresentation ? state.currentPresentation.pages || [] : [];
  const page = pages[state.currentPageIndex];
  let text = "";

  if (fallbackMessage) {
    text = fallbackMessage;
    noteContent.textContent = text;
    mobileNoteContent.textContent = text;
    return;
  }

  if (page && !page.isLoaded) {
    text = "このページのスピーカーノートを読み込んでいます。";
    noteContent.textContent = text;
    mobileNoteContent.textContent = text;
    return;
  }

  if (page && page.hasSpeakerNote) {
    text = page.speakerNote || "";
    noteContent.textContent = text;
    mobileNoteContent.textContent = text;
    return;
  }

  text = "このページにはスピーカーノートがありません。";
  noteContent.textContent = text;
  mobileNoteContent.textContent = text;
}

function renderSourceLink() {
  const sourceLink = document.getElementById("sourceLink");
  sourceLink.innerHTML = "";
}

function goToPage(index) {
  const presentation = state.currentPresentation;
  const pages = presentation ? presentation.pages || [] : [];
  if (index < 0 || index >= pages.length) return;
  state.currentPageIndex = index;
  renderViewer();
  if (isGasRuntime() && presentation && (!pages[index] || !pages[index].isLoaded)) {
    loadPageWindow(presentation.id, index, INITIAL_PAGE_COUNT, true);
  }
}

function nextPage() {
  goToPage(state.currentPageIndex + 1);
}

function prevPage() {
  goToPage(state.currentPageIndex - 1);
}

function filterPresentations(keyword) {
  state.filteredPresentations = filterPresentationList(keyword);
  state.galleryPageIndex = 0;
  renderGallery();
}

function filterPresentationList(keyword) {
  const query = String(keyword || "").trim().toLowerCase();
  return state.presentations.filter(function(presentation) {
    const haystack = [presentation.title, presentation.description].join(" ").toLowerCase();
    return haystack.indexOf(query) !== -1;
  });
}

function showGallery() {
  exitViewerFullscreen();
  setNoteSheetOpen(false);
  state.currentPresentation = null;
  state.currentPageIndex = 0;
  state.pageWindowRequests = {};
  state.prefetchQueue = {};
  state.isPrefetching = false;
  document.getElementById("viewerView").classList.remove("is-visible");
  document.getElementById("galleryView").classList.add("is-visible");
}

function showMobileLibraryHome() {
  setSearchPanelOpen(false);
  setGenerationPanelOpen(false);
  const searchInput = document.getElementById("searchInput");
  if (searchInput.value) {
    searchInput.value = "";
    filterPresentations("");
  } else {
    state.galleryPageIndex = 0;
    renderGallery();
  }
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function setNoteSheetOpen(isOpen) {
  state.isNoteSheetOpen = isOpen;
  const sheet = document.getElementById("mobileNoteSheet");
  const backdrop = document.getElementById("noteSheetBackdrop");
  sheet.hidden = !isOpen;
  backdrop.hidden = !isOpen;
  document.body.classList.toggle("note-sheet-open", isOpen);
  if (isOpen) {
    renderSpeakerNote();
  }
}

function toggleSlideshow() {
  state.isSlideshowMode = !state.isSlideshowMode;
}

function toggleViewerFullscreen() {
  const viewer = document.getElementById("viewerView");
  const fullscreenElement = getFullscreenElement();

  if (fullscreenElement || isViewerImmersive()) {
    state.isAutoImmersive = false;
    exitViewerFullscreen();
    return;
  }

  state.fullscreenRequestId += 1;
  const requestId = state.fullscreenRequestId;
  enterViewerImmersive({ auto: false, wakeControls: true });

  const requestFullscreen = viewer.requestFullscreen ||
    viewer.webkitRequestFullscreen ||
    viewer.webkitRequestFullScreen ||
    viewer.msRequestFullscreen;
  if (requestFullscreen) {
    try {
      const result = requestFullscreen.call(viewer, { navigationUI: "hide" });
      if (result && result.catch) {
        result
          .then(function() {
            if (requestId === state.fullscreenRequestId) {
              document.body.classList.add("viewer-native-fullscreen");
              document.body.classList.remove("viewer-fullscreen-unavailable");
              syncFullscreenButton();
            }
          })
          .catch(function() {
            markFullscreenUnavailable();
          });
      } else {
        window.setTimeout(function() {
          if (requestId !== state.fullscreenRequestId) return;
          if (getFullscreenElement()) {
            document.body.classList.add("viewer-native-fullscreen");
            document.body.classList.remove("viewer-fullscreen-unavailable");
          } else {
            markFullscreenUnavailable();
          }
          syncFullscreenButton();
        }, 350);
      }
    } catch (error) {
      markFullscreenUnavailable();
    }
  } else {
    markFullscreenUnavailable();
  }
}

function exitViewerFullscreen() {
  state.fullscreenRequestId += 1;
  state.isAutoImmersive = false;
  clearViewerControlsTimer();
  hideViewerToast();
  document.body.classList.remove("viewer-immersive", "viewer-native-fullscreen", "viewer-fullscreen-unavailable", "viewer-controls-idle", "viewer-fullscreen");

  const fullscreenElement = getFullscreenElement();
  const exitFullscreen = document.exitFullscreen ||
    document.webkitExitFullscreen ||
    document.webkitCancelFullScreen ||
    document.msExitFullscreen;

  if (fullscreenElement && exitFullscreen) {
    try {
      const result = exitFullscreen.call(document);
      if (result && result.catch) {
        result.catch(function() {});
      }
    } catch (error) {}
  }

  syncFullscreenButton();
}

function handleFullscreenChange() {
  const isNativeFullscreen = Boolean(getFullscreenElement());
  document.body.classList.toggle("viewer-native-fullscreen", isNativeFullscreen);
  if (isViewerImmersive() && isNativeFullscreen) {
    document.body.classList.remove("viewer-fullscreen-unavailable");
  }
  if (!isNativeFullscreen && document.body.classList.contains("viewer-native-fullscreen")) {
    document.body.classList.remove("viewer-native-fullscreen");
  }
  updateViewerViewportHeight();
  syncFullscreenButton();
}

function handleFullscreenError() {
  if (isViewerImmersive()) {
    markFullscreenUnavailable();
  }
}

function handleViewportChange() {
  updateViewerViewportHeight();
  updateResponsiveMode();
  updateDebugPanel();
  if (state.isGenerationPanelOpen) {
    document.getElementById("generationSheetBackdrop").hidden = !isMobileViewport();
    document.body.classList.toggle("generation-sheet-open", isMobileViewport());
  }
  if (state.isSearchOpen) {
    document.getElementById("searchSheetBackdrop").hidden = !isMobileViewport();
    document.body.classList.toggle("search-sheet-open", isMobileViewport());
  }
  applyAutoImmersiveMode();
  showOrientationHint();
}

function updateViewerViewportHeight() {
  const height = window.visualViewport && window.visualViewport.height
    ? window.visualViewport.height
    : window.innerHeight;
  document.documentElement.style.setProperty("--viewer-height", Math.max(1, Math.round(height)) + "px");
}

function getFullscreenElement() {
  return document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.webkitFullScreenElement ||
    document.msFullscreenElement ||
    null;
}

function isViewerImmersive() {
  return document.body.classList.contains("viewer-immersive");
}

function isLandscapeViewport() {
  const width = window.visualViewport && window.visualViewport.width
    ? window.visualViewport.width
    : window.innerWidth;
  const height = window.visualViewport && window.visualViewport.height
    ? window.visualViewport.height
    : window.innerHeight;
  if (width && height && width !== height) {
    return width > height;
  }
  return window.matchMedia && window.matchMedia("(orientation: landscape)").matches;
}

function shouldAutoEnterImmersive() {
  const viewer = document.getElementById("viewerView");
  return Boolean(
    state.currentPresentation &&
    viewer &&
    viewer.classList.contains("is-visible") &&
    isMobileViewport() &&
    isLandscapeViewport()
  );
}

function enterViewerImmersive(options) {
  const settings = options || {};
  state.isAutoImmersive = Boolean(settings.auto);
  document.body.classList.add("viewer-immersive");
  document.body.classList.remove("viewer-fullscreen-unavailable");
  updateViewerViewportHeight();
  syncFullscreenButton();
  if (settings.wakeControls) {
    wakeViewerControls();
  } else {
    document.body.classList.add("viewer-controls-idle");
  }
  showOrientationHint();
}

function applyAutoImmersiveMode() {
  if (shouldAutoEnterImmersive()) {
    if (!isViewerImmersive()) {
      enterViewerImmersive({ auto: true, wakeControls: true });
    }
    return;
  }

  if (state.isAutoImmersive && isViewerImmersive()) {
    exitViewerFullscreen();
  }
}

function markFullscreenUnavailable() {
  document.body.classList.add("viewer-fullscreen-unavailable");
  document.body.classList.remove("viewer-native-fullscreen");
  showViewerToast("\u30d6\u30e9\u30a6\u30b6\u5236\u7d04\u306b\u3088\u308a\u5b8c\u5168\u5168\u753b\u9762\u3067\u306f\u3042\u308a\u307e\u305b\u3093\u3002\u8868\u793a\u9818\u57df\u3092\u6700\u5927\u5316\u3057\u3066\u3044\u307e\u3059\u3002");
  syncFullscreenButton();
}

function showOrientationHint() {
  if (!isViewerImmersive()) return;
  const isPortrait = window.matchMedia && window.matchMedia("(orientation: portrait)").matches;
  if (isPortrait && isCoarsePointer()) {
    showViewerToast("\u6a2a\u5411\u304d\u306b\u3059\u308b\u3068\u3001\u30b9\u30e9\u30a4\u30c9\u3068\u30ce\u30fc\u30c8\u3092\u4e26\u3079\u3066\u898b\u3089\u308c\u307e\u3059\u3002");
  }
}

function isCoarsePointer() {
  return window.matchMedia && window.matchMedia("(hover: none) and (pointer: coarse)").matches;
}

function showViewerToast(message) {
  const toast = document.getElementById("viewerToast");
  if (!toast) return;
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(function() {
    toast.hidden = true;
  }, 3200);
}

function hideViewerToast() {
  const toast = document.getElementById("viewerToast");
  window.clearTimeout(state.toastTimer);
  if (toast) {
    toast.hidden = true;
  }
}

function handleViewerTouchStart(event) {
  if (!state.currentPresentation || !event.changedTouches.length) return;
  state.viewerTouchStartX = event.changedTouches[0].clientX;
  state.viewerTouchStartY = event.changedTouches[0].clientY;
  state.viewerTouchStartTarget = event.target;
}

function handleViewerTouchEnd(event) {
  if (!state.currentPresentation || state.viewerTouchStartX === null || !event.changedTouches.length) return;

  const startTarget = state.viewerTouchStartTarget;
  const dx = event.changedTouches[0].clientX - state.viewerTouchStartX;
  const dy = event.changedTouches[0].clientY - state.viewerTouchStartY;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);

  state.viewerTouchStartX = null;
  state.viewerTouchStartY = null;
  state.viewerTouchStartTarget = null;

  if (startTarget && startTarget.closest && startTarget.closest(".mobile-viewer-bar, .viewer-head, button, a, input, textarea")) {
    return;
  }
  if (absX >= 40 && absX > absY) {
    return;
  }
  if (dy >= 36 && absY > absX * 1.2) {
    wakeViewerControls();
  }
}

function wakeViewerControls() {
  if (!isViewerImmersive() && !(state.currentPresentation && isMobileViewport())) return;
  document.body.classList.remove("viewer-controls-idle");
  clearViewerControlsTimer();
  state.controlsIdleTimer = window.setTimeout(function() {
    if (isViewerImmersive() || (state.currentPresentation && isMobileViewport())) {
      document.body.classList.add("viewer-controls-idle");
    }
  }, 2600);
}

function clearViewerControlsTimer() {
  window.clearTimeout(state.controlsIdleTimer);
  state.controlsIdleTimer = null;
}

function syncFullscreenButton() {
  const button = document.getElementById("fullscreenButton");
  if (!button) return;

  const isFullscreen = Boolean(getFullscreenElement()) || isViewerImmersive();
  button.textContent = isFullscreen ? "\u89e3\u9664" : "\u5168\u753b\u9762";
  button.setAttribute("aria-pressed", isFullscreen ? "true" : "false");
}

function toggleGenerationPanel() {
  setGenerationPanelOpen(!state.isGenerationPanelOpen);
}

function setGenerationPanelOpen(isOpen) {
  if (isOpen && isMobileViewport()) {
    setSearchPanelOpen(false);
  }
  state.isGenerationPanelOpen = isOpen;
  const panel = document.getElementById("generationPanel");
  const toggle = document.getElementById("generationToggle");
  const backdrop = document.getElementById("generationSheetBackdrop");
  panel.hidden = !isOpen;
  backdrop.hidden = !isOpen || !isMobileViewport();
  document.body.classList.toggle("generation-sheet-open", isOpen && isMobileViewport());
  const generationDetails = document.getElementById("generationDetails");
  if (generationDetails && isOpen && isMobileViewport()) {
    generationDetails.open = false;
  }
  toggle.textContent = isOpen ? "閉じる" : "スライド生成";
  toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
  updateDebugPanel();
}

function setGenerationMode(mode) {
  state.generationMode = mode === "research" ? "research" : "url";
  const isResearch = state.generationMode === "research";
  document.getElementById("urlFields").hidden = isResearch;
  document.getElementById("researchFields").hidden = !isResearch;
  document.querySelectorAll(".mode-tab").forEach(function(button) {
    const active = button.dataset.mode === state.generationMode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  setGenerationMessage("");
}

function toggleSearchPanel() {
  setSearchPanelOpen(!state.isSearchOpen);
}

function setSearchPanelOpen(isOpen) {
  if (isOpen && isMobileViewport()) {
    setGenerationPanelOpen(false);
  }
  state.isSearchOpen = isOpen;
  const backdrop = document.getElementById("searchSheetBackdrop");
  document.body.classList.toggle("mobile-search-open", state.isSearchOpen);
  document.body.classList.toggle("search-sheet-open", state.isSearchOpen && isMobileViewport());
  backdrop.hidden = !state.isSearchOpen || !isMobileViewport();
  document.getElementById("searchToggle").setAttribute("aria-expanded", state.isSearchOpen ? "true" : "false");
  if (state.isSearchOpen && !isMobileViewport()) {
    window.setTimeout(function() {
      document.getElementById("searchInput").focus();
    }, 80);
  }
  updateDebugPanel();
}

function isMobileViewport() {
  const isIPhoneLike = isIPhoneLikeViewport();
  const visualWidth = window.visualViewport && window.visualViewport.width
    ? window.visualViewport.width
    : window.innerWidth;
  const layoutWidth = Math.min(
    visualWidth || Number.POSITIVE_INFINITY,
    document.documentElement.clientWidth || Number.POSITIVE_INFINITY,
    window.innerWidth || Number.POSITIVE_INFINITY
  );
  const coarsePointer = window.matchMedia && window.matchMedia("(hover: none), (pointer: coarse)").matches;
  return isIPhoneLike || layoutWidth <= 900 || (coarsePointer && layoutWidth <= 1180);
}

function isIPhoneLikeViewport() {
  const ua = navigator.userAgent || "";
  return /iPhone|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
}

function updateResponsiveMode() {
  const enabled = isMobileViewport();
  const changed = state.isMobileLayout !== enabled;
  state.isMobileLayout = enabled;
  document.documentElement.classList.toggle("mobile-layout", enabled);
  document.body.classList.toggle("mobile-layout", enabled);
  document.getElementById("searchSheetBackdrop").hidden = !state.isSearchOpen || !enabled;
  document.body.classList.toggle("search-sheet-open", state.isSearchOpen && enabled);
  const generationDetails = document.getElementById("generationDetails");
  if (generationDetails && changed) {
    generationDetails.open = !enabled;
  }
  if (changed && state.filteredPresentations.length) {
    state.galleryPageIndex = 0;
    renderGallery();
  }
}

function updateDebugPanel() {
  const panel = document.getElementById("debugPanel");
  if (!panel) return;
  const shouldShow = new URLSearchParams(window.location.search).get("debug") === "1";
  panel.hidden = !shouldShow;
  if (!shouldShow) return;

  const readStyle = function(selector) {
    const element = document.querySelector(selector);
    if (!element) return selector + ": not found";
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return [
      selector,
      "font=" + style.fontSize,
      "line=" + style.lineHeight,
      "height=" + Math.round(rect.height * 10) / 10 + "px",
      "minHeight=" + style.minHeight,
      "display=" + style.display
    ].join(" | ");
  };

  const viewportMeta = document.querySelector('meta[name="viewport"]');
  const visualSize = window.visualViewport
    ? Math.round(window.visualViewport.width) + "x" + Math.round(window.visualViewport.height)
    : "n/a";
  const lines = [
    "build=" + BUILD_ID,
    "bodyBuild=" + (document.body.dataset.build || ""),
    "url=" + window.location.href,
    "viewportMeta=" + (viewportMeta ? viewportMeta.getAttribute("content") : ""),
    "inner=" + window.innerWidth + "x" + window.innerHeight,
    "visual=" + visualSize,
    "docClient=" + document.documentElement.clientWidth + "x" + document.documentElement.clientHeight,
    "ua=" + navigator.userAgent,
    "mobile=" + isMobileViewport(),
    "bodyClass=" + document.body.className,
    "htmlClass=" + document.documentElement.className,
    readStyle(".generation-head h2"),
    readStyle(".mode-tab"),
    readStyle(".field-box"),
    readStyle(".field-box span"),
    readStyle(".field-box input"),
    readStyle(".generation-details summary"),
    readStyle(".primary-button"),
    readStyle(".search-title-row h2"),
    readStyle(".search-box"),
    readStyle(".search-box input"),
    readStyle(".search-clear")
  ];
  panel.innerHTML = "<strong>Slide Library debug</strong>" + escapeHtml(lines.join("\n"));
}

function requestGeneration() {
  const payloadResult = collectGenerationPayload();

  setGenerationMessage("");
  if (!payloadResult.ok) {
    setGenerationMessage(payloadResult.message, true);
    return;
  }

  const payload = payloadResult.payload;
  const pendingLabel = createPendingLabel(payload);
  setGenerationSubmitting(true);

  if (isGasRuntime()) {
    apiClient.post("requestGeneration", payload)
      .then(function(result) {
        onGenerationRequested(pendingLabel, result && result.trackingId);
      })
      .catch(function(error) {
        setGenerationSubmitting(false);
        removePendingCard(pendingLabel);
        setGenerationMessage(error && error.message ? error.message : String(error), true);
      });
    return;
  }

  window.setTimeout(function() {
    onGenerationRequested(pendingLabel, "local_preview");
    window.setTimeout(function() {
      completeLocalGeneration(pendingLabel);
    }, 2500);
  }, 500);
}

function collectGenerationPayload() {
  const payload = {
    mode: state.generationMode,
    urls: [],
    researchPrompt: "",
    audience: document.getElementById("audienceInput").value.trim(),
    focus: document.getElementById("focusInput").value.trim(),
    pages: document.getElementById("pagesInput").value.trim()
  };

  if (state.generationMode === "research") {
    payload.researchPrompt = document.getElementById("researchPromptInput").value.trim();
    if (!payload.researchPrompt) {
      return { ok: false, message: "調査プロンプトを入力してください。" };
    }
  } else {
    payload.urls = [1, 2, 3].map(function(index) {
      return document.getElementById("urlInput" + index).value.trim();
    }).filter(Boolean);
    if (!payload.urls.length) {
      return { ok: false, message: "URLを1件以上入力してください。" };
    }
    if (payload.urls.length > 3) {
      return { ok: false, message: "URLは最大3件まで指定できます。" };
    }
    if (payload.urls.some(function(url) { return !/^https?:\/\/\S+/i.test(url); })) {
      return { ok: false, message: "URLは http:// または https:// で始まる形式で入力してください。" };
    }
  }

  if (payload.pages && !/^\d+$/.test(payload.pages)) {
    return { ok: false, message: "目標スライド数は整数で入力してください。" };
  }

  return {
    ok: true,
    payload: {
      mode: payload.mode,
      urls: payload.urls,
      researchPrompt: payload.researchPrompt,
      audience: payload.audience,
      focus: payload.focus,
      pages: payload.pages ? Number(payload.pages) : undefined
    }
  };
}

function createPendingLabel(payload) {
  if (payload.researchPrompt) {
    return "リサーチ: " + payload.researchPrompt;
  }
  return payload.urls.join(", ");
}

function onGenerationRequested(label, trackingId) {
  setGenerationSubmitting(false);
  setGenerationMessage("生成依頼をSlackへ送信しました。完了通知はSlackをご確認ください。");
  clearGenerationInputs();
  addPendingCard(label, trackingId);
  if (isMobileViewport()) {
    setGenerationPanelOpen(false);
  }
  startPolling();
}

function clearGenerationInputs() {
  ["urlInput1", "urlInput2", "urlInput3", "researchPromptInput"].forEach(function(id) {
    const node = document.getElementById(id);
    if (node) node.value = "";
  });
}

function setGenerationSubmitting(isSubmitting) {
  state.isRequestingGeneration = isSubmitting;
  const button = document.getElementById("generationButton");
  button.disabled = isSubmitting;
  button.textContent = isSubmitting ? "送信中..." : "生成を依頼";
}

function setGenerationMessage(message, isError) {
  const messageNode = document.getElementById("generationMessage");
  messageNode.textContent = message || "";
  messageNode.classList.toggle("is-error", Boolean(isError));
}

function prefillGenerationFromNewsParams() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("from") !== "news") return;

  const keyword = params.get("keyword") || "";
  const prompt = params.get("prompt") || "";
  const url = params.get("url") || "";
  const title = params.get("title") || "";
  const source = params.get("source") || "";
  const summary = params.get("summary") || "";

  const urlInput = document.getElementById("urlInput1");
  const focusInput = document.getElementById("focusInput");
  const researchPromptInput = document.getElementById("researchPromptInput");

  if (urlInput && url) {
    urlInput.value = url;
  }
  if (focusInput && keyword) {
    focusInput.value = keyword;
  }
  if (researchPromptInput && (keyword || prompt || summary)) {
    const researchParts = [];
    if (keyword) researchParts.push(keyword);
    if (prompt) researchParts.push(prompt);
    let researchText = researchParts.join(" - ");
    if (summary) {
      researchText += (researchText ? "\n\n" : "") + "参照記事要約:\n" + summary;
    }
    researchPromptInput.value = researchText.trim();
  }

  setGenerationMode(url ? "url" : "research");
  setGenerationPanelOpen(true);

  if (title || source) {
    setGenerationMessage("参照元: " + [title, source].filter(Boolean).join(" / "));
  }

  const cleanUrl = window.location.pathname + window.location.hash;
  window.history.replaceState({}, "", cleanUrl);
}

function addPendingCard(url, trackingId) {
  if (!state.pendingUrls.some(function(item) { return item.label === url; })) {
    state.pendingUrls.unshift({
      label: url,
      trackingId: trackingId || "",
      createdAt: Date.now()
    });
  }
  state.galleryPageIndex = 0;
  startPendingStatusTimer();
  renderGallery();
}

function removePendingCard(url) {
  state.pendingUrls = state.pendingUrls.filter(function(item) {
    return item.label !== url;
  });
  renderGallery();
  if (!state.pendingUrls.length) {
    stopPolling();
  }
}

function startPolling() {
  if (state.pollingTimer) return;
  const interval = Number(apiClient.getConfig().REFRESH_INTERVAL_MS || 30000);
  state.pollingTimer = window.setInterval(refreshPresentationsMeta, interval);
}

function stopPolling() {
  if (!state.pollingTimer) return;
  window.clearInterval(state.pollingTimer);
  state.pollingTimer = null;
}

function refreshPresentationsMeta() {
  if (!state.pendingUrls.length) {
    stopPolling();
    return;
  }

  if (isGasRuntime()) {
    apiClient.get("listPresentations", { refresh: "1" })
      .then(function(presentations) {
        mergePresentationMeta(presentations || []);
      })
      .catch(function(error) {
        setGenerationMessage(error && error.message ? error.message : String(error), true);
      });
  }
}

function mergePresentationMeta(presentations) {
  const incoming = sortPresentations(presentations);
  const newItems = incoming.filter(function(presentation) {
    return !state.knownIds.has(presentation.id);
  });

  state.presentations = incoming.map(function(meta) {
    const existing = state.presentations.find(function(item) {
      return item.id === meta.id;
    });
    return existing
      ? Object.assign({}, meta, {
          thumbnailUrl: meta.thumbnailUrl || existing.thumbnailUrl || "",
          thumbnailFetchedAt: meta.thumbnailFetchedAt || existing.thumbnailFetchedAt || "",
          pages: existing.pages && existing.pages.length ? existing.pages : meta.pages
        })
      : meta;
  });

  state.knownIds = new Set(state.presentations.map(function(presentation) {
    return presentation.id;
  }));

  if (newItems.length && state.pendingUrls.length) {
    state.pendingUrls.splice(0, Math.min(newItems.length, state.pendingUrls.length));
  }

  state.filteredPresentations = filterPresentationList(document.getElementById("searchInput").value);
  state.galleryPageIndex = 0;
  renderGallery();
  if (!state.pendingUrls.length) {
    stopPolling();
  }
}

function completeLocalGeneration(url) {
  const generated = createSamplePresentation(
    "generated-" + Date.now(),
    "Generated Slides",
    url,
    new Date().toISOString(),
    "edf4f2",
    "1f3d34",
    5
  );
  mergePresentationMeta(state.presentations.concat([generated]));
}

function showLoading(isVisible) {
  document.getElementById("loadingState").classList.toggle("is-visible", isVisible);
  if (isVisible) {
    renderGallerySkeleton();
  }
}

function renderGallerySkeleton() {
  const gallery = document.getElementById("gallery");
  if (!gallery || gallery.children.length) return;
  const count = getGalleryPageSize();
  gallery.innerHTML = Array.from({ length: count }).map(function(_, index) {
    return '<article class="slide-card skeleton-card' + (index === 0 ? ' is-featured' : ' is-secondary') + '">' +
      '<div class="card-thumb"></div>' +
      '<div class="card-body"><div class="skeleton-line is-title"></div><div class="skeleton-line"></div></div>' +
    '</article>';
  }).join("");
}

function showError(message) {
  const errorState = document.getElementById("errorState");
  errorState.innerHTML = '<div><strong>読み込みに失敗しました</strong><span>' + escapeHtml(message) + '</span></div>';
  errorState.classList.add("is-visible");
}

function hideError() {
  document.getElementById("errorState").classList.remove("is-visible");
}

function showEmpty(title, message) {
  const emptyState = document.getElementById("emptyState");
  emptyState.innerHTML = '<div><strong>' + escapeHtml(title) + '</strong><span>' + escapeHtml(message) + '</span></div>';
  emptyState.classList.add("is-visible");
}

function hideEmpty() {
  document.getElementById("emptyState").classList.remove("is-visible");
}

function imageMarkup(src, alt) {
  if (!src) return '<div class="image-fallback">画像を表示できません</div>';
  return '<img src="' + escapeHtml(src) + '" alt="' + escapeHtml(alt) + '" loading="lazy" onerror="this.replaceWith(createImageFallback())">';
}

function createImageFallback() {
  const fallback = document.createElement("div");
  fallback.className = "image-fallback";
  fallback.textContent = "画像を表示できません";
  return fallback;
}

function createSamplePresentation(id, title, sourceUrl, updatedAt, bg, fg, count) {
  const pages = createSamplePages(title, bg, fg, count);
  return {
    id: id,
    title: title,
    description: sourceUrl ? "Source: " + sourceUrl : "",
    updatedAt: updatedAt,
    updatedAtMillis: String(new Date(updatedAt).getTime()),
    thumbnailUrl: pages.length ? pages[0].imageUrl : "",
    pageCount: pages.length,
    pages: pages,
    localPages: pages
  };
}

function createSamplePages(label, bg, fg, count) {
  const pages = [];
  for (let index = 1; index <= count; index += 1) {
    const hasNote = index % 2 === 1;
    pages.push({
      pageObjectId: "sample-" + label.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-" + index,
      pageNumber: index,
      imageUrl: createSlideDataUrl(label, index, bg, fg),
      speakerNote: hasNote
        ? "Page " + index + " speaker note.\\nConfirm the key message, then move to the next page."
        : "",
      hasSpeakerNote: hasNote,
      isLoaded: true
    });
  }
  return pages;
}

function createSlideDataUrl(label, pageNumber, bg, fg) {
  const safeLabel = escapeHtml(label);
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">' +
    '<rect width="1280" height="720" fill="#' + bg + '"/>' +
    '<rect x="72" y="64" width="1136" height="592" rx="8" fill="#ffffff" opacity="0.74"/>' +
    '<line x1="132" y1="548" x2="1148" y2="548" stroke="#' + fg + '" stroke-opacity="0.16" stroke-width="2"/>' +
    '<text x="132" y="178" fill="#' + fg + '" font-family="Arial, sans-serif" font-size="34" opacity="0.58">Google Slides Viewer</text>' +
    '<text x="132" y="330" fill="#' + fg + '" font-family="Arial, sans-serif" font-size="66" font-weight="700">' + safeLabel + '</text>' +
    '<text x="132" y="420" fill="#' + fg + '" font-family="Arial, sans-serif" font-size="42" opacity="0.7">Page ' + pageNumber + '</text>' +
    '</svg>';
  return "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
}

function sortPresentations(presentations) {
  return (presentations || []).slice().sort(function(a, b) {
    return new Date(b.updatedAt) - new Date(a.updatedAt);
  });
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function isGasRuntime() {
  return apiClient.hasApiUrl();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

document.addEventListener("DOMContentLoaded", init);

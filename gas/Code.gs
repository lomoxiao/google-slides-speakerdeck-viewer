const DEFAULT_SLIDES_FOLDER_ID = '';
const META_CACHE_KEY = 'presentations_meta_v3';
const META_INDEX_KEY = 'presentations_meta_index_v3';
const META_CACHE_SECONDS = 1200;
const OUTLINE_CACHE_SECONDS = 21600;
const THUMBNAIL_CACHE_SECONDS = 1200;
const CACHE_MAX_CHARS = 90000;
const PROPERTY_MAX_CHARS = 8000;
const INITIAL_PAGE_COUNT = 1;
const PREFETCH_PAGE_COUNT = 3;

function doGet() {
  return HtmlService
    .createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Slide Library')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getPresentations() {
  return getPresentationsMeta();
}

function getPresentationsMeta() {
  const cached = readCache_(META_CACHE_KEY);
  if (cached) {
    return cached;
  }

  return rebuildPresentationsMeta_(false);
}

function warmPresentationsCache() {
  return rebuildPresentationsMeta_(true);
}

function installWarmPresentationsTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'warmPresentationsCache') {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp.newTrigger('warmPresentationsCache')
    .timeBased()
    .everyMinutes(15)
    .create();

  return { ok: true };
}

function getPresentationPageWindow(presentationId, startIndex, count) {
  if (!presentationId) {
    throw new Error('presentationId is required.');
  }

  const outline = getPresentationOutline_(presentationId);
  const total = outline.pages.length;
  const safeStart = Math.max(0, Math.min(Number(startIndex) || 0, Math.max(total - 1, 0)));
  const safeCount = Math.max(1, Number(count) || INITIAL_PAGE_COUNT);
  const end = Math.min(total, safeStart + safeCount);
  const pages = [];

  for (let index = safeStart; index < end; index += 1) {
    pages.push(getPresentationPage_(presentationId, outline, index));
  }

  return {
    presentationId: presentationId,
    startIndex: safeStart,
    count: pages.length,
    pageCount: total,
    pages: pages
  };
}

function getPresentationPages(presentationId) {
  if (!presentationId) {
    throw new Error('presentationId is required.');
  }

  const outline = getPresentationOutline_(presentationId);
  return outline.pages.map(function(_page, index) {
    return getPresentationPage_(presentationId, outline, index);
  });
}

function requestSlideGeneration(articleUrl) {
  const url = String(articleUrl || '').trim();
  if (!/^https?:\/\/\S+/i.test(url)) {
    throw new Error('articleUrl must start with http:// or https://.');
  }

  const properties = PropertiesService.getScriptProperties();
  const token = properties.getProperty('SLACK_BOT_TOKEN');
  const channelId = properties.getProperty('SLACK_COMPLETION_CHANNEL_ID');

  if (!token) {
    throw new Error('SLACK_BOT_TOKEN is not set.');
  }
  if (!channelId) {
    throw new Error('SLACK_COMPLETION_CHANNEL_ID is not set.');
  }

  const response = UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + token
    },
    payload: JSON.stringify({
      channel: channelId,
      text: '[slide-generate] ' + url
    }),
    muteHttpExceptions: true
  });

  const body = JSON.parse(response.getContentText() || '{}');
  if (!body.ok) {
    throw new Error('Slack post failed: ' + (body.error || response.getResponseCode()));
  }

  return { ok: true };
}

function rebuildPresentationsMeta_(forceRefresh) {
  const files = getSlidesFiles_();
  const existingMeta = forceRefresh ? [] : readStoredMeta_();
  const existingById = {};
  existingMeta.forEach(function(item) {
    existingById[item.id] = item;
  });

  const presentations = [];
  const index = {};

  while (files.hasNext()) {
    const file = files.next();
    const presentationId = file.getId();
    const updatedAt = file.getLastUpdated().toISOString();
    const updatedAtMillis = String(file.getLastUpdated().getTime());
    const existing = existingById[presentationId];

    if (existing && existing.updatedAt === updatedAt && existing.pageCount >= 0) {
      const thumbnailUrl = getFreshFirstThumbnailUrl_(presentationId, existing, updatedAtMillis);
      presentations.push({
        id: existing.id,
        title: file.getName(),
        description: file.getDescription() || existing.description || '',
        updatedAt: existing.updatedAt,
        updatedAtMillis: existing.updatedAtMillis || updatedAtMillis,
        firstPageObjectId: existing.firstPageObjectId || '',
        thumbnailUrl: thumbnailUrl,
        thumbnailFetchedAt: new Date().toISOString(),
        pageCount: existing.pageCount,
        pages: []
      });
      index[presentationId] = updatedAtMillis;
      continue;
    }

    const outline = getPresentationOutline_(presentationId, updatedAtMillis);
    const firstPage = outline.pages.length ? getPresentationPage_(presentationId, outline, 0) : null;

    presentations.push({
      id: presentationId,
      title: file.getName(),
      description: file.getDescription() || '',
      updatedAt: updatedAt,
      updatedAtMillis: updatedAtMillis,
      firstPageObjectId: firstPage ? firstPage.pageObjectId : '',
      thumbnailUrl: firstPage ? firstPage.imageUrl : '',
      thumbnailFetchedAt: new Date().toISOString(),
      pageCount: outline.pages.length,
      pages: []
    });
    index[presentationId] = updatedAtMillis;
  }

  presentations.sort(function(a, b) {
    return new Date(b.updatedAt) - new Date(a.updatedAt);
  });

  writeCache_(META_CACHE_KEY, presentations, META_CACHE_SECONDS);
  writeCache_(META_INDEX_KEY, index, META_CACHE_SECONDS);
  writeStoredMeta_(presentations);

  return presentations;
}

function getPresentationOutline_(presentationId, knownUpdatedAtMillis) {
  const updatedAtMillis = knownUpdatedAtMillis || String(DriveApp.getFileById(presentationId).getLastUpdated().getTime());
  const cacheKey = 'outline_' + presentationId + '_' + updatedAtMillis;
  const cached = readCache_(cacheKey);

  if (cached) {
    return cached;
  }

  const presentation = Slides.Presentations.get(presentationId);
  const slides = presentation.slides || [];
  const outline = {
    presentationId: presentationId,
    updatedAtMillis: updatedAtMillis,
    pages: slides.map(function(slide, index) {
      const speakerNote = extractSpeakerNote_(slide);
      return {
        pageObjectId: slide.objectId,
        pageNumber: index + 1,
        speakerNote: speakerNote,
        hasSpeakerNote: speakerNote.trim().length > 0
      };
    })
  };

  writeCache_(cacheKey, outline, OUTLINE_CACHE_SECONDS);
  return outline;
}

function getPresentationPage_(presentationId, outline, index) {
  const page = outline.pages[index];
  if (!page) {
    throw new Error('Page index is out of range.');
  }

  const cacheKey = 'page_v3_' + presentationId + '_' + outline.updatedAtMillis + '_' + page.pageObjectId;
  const cached = readCache_(cacheKey);

  if (cached) {
    return cached;
  }

  const hydrated = {
    pageObjectId: page.pageObjectId,
    pageNumber: page.pageNumber,
    imageUrl: getSlideThumbnailUrl_(presentationId, page.pageObjectId),
    speakerNote: page.speakerNote || '',
    hasSpeakerNote: Boolean(page.hasSpeakerNote)
  };

  writeCache_(cacheKey, hydrated, THUMBNAIL_CACHE_SECONDS);
  return hydrated;
}

function getFreshFirstThumbnailUrl_(presentationId, existing, updatedAtMillis) {
  const fetchedAt = existing.thumbnailFetchedAt ? new Date(existing.thumbnailFetchedAt).getTime() : 0;
  const isFresh = fetchedAt && (Date.now() - fetchedAt) < (THUMBNAIL_CACHE_SECONDS * 1000);

  if (isFresh && existing.thumbnailUrl) {
    return existing.thumbnailUrl;
  }

  if (existing.firstPageObjectId) {
    return getSlideThumbnailUrl_(presentationId, existing.firstPageObjectId);
  }

  const outline = getPresentationOutline_(presentationId, updatedAtMillis);
  return outline.pages.length
    ? getSlideThumbnailUrl_(presentationId, outline.pages[0].pageObjectId)
    : '';
}

function getSlidesFiles_() {
  const folderId = PropertiesService.getScriptProperties().getProperty('SLIDES_FOLDER_ID') || DEFAULT_SLIDES_FOLDER_ID;
  return folderId
    ? DriveApp.getFolderById(folderId).getFilesByType(MimeType.GOOGLE_SLIDES)
    : DriveApp.getFilesByType(MimeType.GOOGLE_SLIDES);
}

function getSlideThumbnailUrl_(presentationId, pageObjectId) {
  const thumbnail = Slides.Presentations.Pages.getThumbnail(presentationId, pageObjectId, {
    'thumbnailProperties.mimeType': 'PNG',
    'thumbnailProperties.thumbnailSize': 'LARGE'
  });

  return thumbnail.contentUrl || '';
}

function extractSpeakerNote_(slide) {
  const notesPage = slide.slideProperties && slide.slideProperties.notesPage;
  const elements = notesPage && notesPage.pageElements ? notesPage.pageElements : [];
  const chunks = [];

  elements.forEach(function(element) {
    const textElements = element.shape && element.shape.text && element.shape.text.textElements
      ? element.shape.text.textElements
      : [];

    textElements.forEach(function(textElement) {
      if (textElement.textRun && textElement.textRun.content) {
        chunks.push(textElement.textRun.content);
      }
    });
  });

  return chunks.join('').trim();
}

function readCache_(key) {
  const cached = CacheService.getScriptCache().get(key);
  return cached ? JSON.parse(cached) : null;
}

function writeCache_(key, value, seconds) {
  const serialized = JSON.stringify(value);
  if (serialized.length <= CACHE_MAX_CHARS) {
    CacheService.getScriptCache().put(key, serialized, seconds);
  }
}

function readStoredMeta_() {
  const stored = PropertiesService.getScriptProperties().getProperty(META_CACHE_KEY);
  return stored ? JSON.parse(stored) : [];
}

function writeStoredMeta_(presentations) {
  const serialized = JSON.stringify(presentations);
  if (serialized.length <= PROPERTY_MAX_CHARS) {
    PropertiesService.getScriptProperties().setProperty(META_CACHE_KEY, serialized);
  }
}

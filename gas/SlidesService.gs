const DEFAULT_SLIDES_FOLDER_ID = 'C0B032Z69KR';
const META_CACHE_KEY = 'presentations_meta_v4';
const META_INDEX_KEY = 'presentations_meta_index_v4';
const META_CACHE_SECONDS = 1200;
const OUTLINE_CACHE_SECONDS = 21600;
const THUMBNAIL_CACHE_SECONDS = 1200;
const INITIAL_PAGE_COUNT = 1;

function getPresentations() {
  return getPresentationsMeta();
}

function getPresentationsMeta(refresh) {
  if (refresh) {
    return rebuildPresentationsMeta_(true);
  }

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

function getPresentationFirstThumbnail(presentationId) {
  if (!presentationId) {
    throw new Error('presentationId is required.');
  }

  const file = DriveApp.getFileById(presentationId);
  const updatedAt = file.getLastUpdated().toISOString();
  const updatedAtMillis = String(file.getLastUpdated().getTime());
  const outline = getPresentationOutline_(presentationId, updatedAtMillis);
  const firstPage = outline.pages.length ? getPresentationPage_(presentationId, outline, 0) : null;

  return {
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
  };
}

function rebuildPresentationsMeta_(forceRefresh) {
  const files = getSlidesFiles_();
  const existingMeta = readStoredMeta_();
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
      presentations.push({
        id: existing.id,
        title: file.getName(),
        description: file.getDescription() || existing.description || '',
        updatedAt: existing.updatedAt,
        updatedAtMillis: existing.updatedAtMillis || updatedAtMillis,
        firstPageObjectId: existing.firstPageObjectId || '',
        thumbnailUrl: existing.thumbnailUrl || '',
        thumbnailFetchedAt: existing.thumbnailFetchedAt || '',
        pageCount: existing.pageCount,
        pages: []
      });
      index[presentationId] = updatedAtMillis;
      continue;
    }

    const outline = getPresentationOutline_(presentationId, updatedAtMillis);
    const firstPage = outline.pages.length ? outline.pages[0] : null;

    presentations.push({
      id: presentationId,
      title: file.getName(),
      description: file.getDescription() || '',
      updatedAt: updatedAt,
      updatedAtMillis: updatedAtMillis,
      firstPageObjectId: firstPage ? firstPage.pageObjectId : '',
      thumbnailUrl: '',
      thumbnailFetchedAt: '',
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

  const cacheKey = 'page_v4_' + presentationId + '_' + outline.updatedAtMillis + '_' + page.pageObjectId;
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

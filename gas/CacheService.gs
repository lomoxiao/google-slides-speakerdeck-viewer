const CACHE_MAX_CHARS = 90000;
const PROPERTY_MAX_CHARS = 8000;

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

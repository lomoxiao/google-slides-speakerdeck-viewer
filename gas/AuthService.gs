const VIEWER_TOKEN_CACHE_TTL_SECONDS = 600;

/**
 * Firebase IDトークンによる認可。FIREBASE_DB_URL 未設定の間は従来動作
 * （clientKeyのみ）のまま無効化されるため、GAS先行デプロイが安全にできる。
 * CLIENT_KEY 一致は旧静的ビューア（docs/）向けの代替credentialとして許可する。
 */
function assertAuthorized_(request) {
  if (request.action === 'health' || request.action === '') {
    return;
  }
  const dbUrl = PropertiesService.getScriptProperties().getProperty('FIREBASE_DB_URL');
  if (!dbUrl) {
    return;
  }
  const expectedKey = PropertiesService.getScriptProperties().getProperty('CLIENT_KEY');
  if (expectedKey && request.clientKey === expectedKey) {
    return;
  }
  assertViewerToken_(request.idToken, dbUrl);
}

function assertViewerToken_(idToken, dbUrl) {
  if (!idToken) {
    throw unauthorizedError_();
  }
  const cache = CacheService.getScriptCache();
  const cacheKey = 'viewerToken_' + tokenCacheKey_(idToken);
  if (cache.get(cacheKey)) {
    return;
  }
  const uid = decodeTokenUid_(idToken);
  if (!uid || !/^[A-Za-z0-9_-]+$/.test(uid)) {
    throw unauthorizedError_();
  }
  // RTDBがトークンの署名・期限を検証し、Rulesが /access/viewers/{uid} の
  // 本人読み取りだけを許可するため、この1リクエストで「トークン有効」と
  // 「viewer allowlist所属」を同時に証明できる。
  const url = String(dbUrl).replace(/\/+$/, '') +
    '/access/viewers/' + encodeURIComponent(uid) + '.json?auth=' + encodeURIComponent(idToken);
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200 || response.getContentText().trim() !== 'true') {
    throw unauthorizedError_();
  }
  cache.put(cacheKey, '1', VIEWER_TOKEN_CACHE_TTL_SECONDS);
}

function decodeTokenUid_(idToken) {
  const parts = String(idToken).split('.');
  if (parts.length !== 3) {
    return '';
  }
  try {
    const payload = JSON.parse(
      Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[1])).getDataAsString('UTF-8')
    );
    // 署名検証はRTDB側に委ねるため、ここではuidの取り出しのみ行う
    return String(payload.sub || payload.user_id || '');
  } catch (error) {
    return '';
  }
}

function tokenCacheKey_(idToken) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    idToken,
    Utilities.Charset.UTF_8
  );
  return digest
    .map(function (value) {
      const byte = (value + 256) % 256;
      return (byte < 16 ? '0' : '') + byte.toString(16);
    })
    .join('');
}

function unauthorizedError_() {
  const error = new Error('unauthorized');
  error.code = 'unauthorized';
  return error;
}

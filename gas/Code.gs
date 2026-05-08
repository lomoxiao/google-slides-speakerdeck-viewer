const APP_BUILD_ID = 'github-pages-api-mvp-20260509';

function doGet(e) {
  return handleApiRequest_(e, 'GET');
}

function doPost(e) {
  return handleApiRequest_(e, 'POST');
}

function handleApiRequest_(e, method) {
  try {
    const request = parseApiRequest_(e, method);
    assertClientKey_(request);
    return jsonResponse_({
      ok: true,
      data: dispatchApiAction_(request)
    });
  } catch (error) {
    return jsonResponse_({
      ok: false,
      error: {
        message: error && error.message ? error.message : String(error)
      }
    });
  }
}

function parseApiRequest_(e, method) {
  const params = (e && e.parameter) || {};
  let body = {};

  if (method === 'POST' && e && e.postData && e.postData.contents) {
    body = JSON.parse(e.postData.contents || '{}');
  }

  return {
    method: method,
    action: String(body.action || params.action || '').trim(),
    clientKey: String(body.clientKey || params.clientKey || '').trim(),
    params: params,
    body: body
  };
}

function dispatchApiAction_(request) {
  switch (request.action) {
    case 'listPresentations':
      return request.params.refresh === '1'
        ? warmPresentationsCache()
        : getPresentationsMeta();

    case 'getFirstThumbnail':
      return getPresentationFirstThumbnail(request.params.presentationId);

    case 'getPageWindow':
      return getPresentationPageWindow(
        request.params.presentationId,
        request.params.startIndex,
        request.params.count
      );

    case 'requestGeneration':
      return requestSlideGeneration(request.body);

    case 'health':
    case '':
      return {
        buildId: APP_BUILD_ID,
        actions: [
          'listPresentations',
          'getFirstThumbnail',
          'getPageWindow',
          'requestGeneration'
        ]
      };

    default:
      throw new Error('Unknown action: ' + request.action);
  }
}

function assertClientKey_(request) {
  const expected = PropertiesService.getScriptProperties().getProperty('CLIENT_KEY');
  if (expected && request.clientKey !== expected) {
    throw new Error('Invalid clientKey.');
  }
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

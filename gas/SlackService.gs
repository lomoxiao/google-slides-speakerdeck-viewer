function requestSlideGeneration(input) {
  const payload = normalizeGenerationPayload_(input || {});
  const trackingId = createTrackingId_();
  const messageText = buildSlideGenerationMessage_(payload, trackingId);

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
      text: messageText
    }),
    muteHttpExceptions: true
  });

  const body = JSON.parse(response.getContentText() || '{}');
  if (!body.ok) {
    throw new Error('Slack post failed: ' + (body.error || response.getResponseCode()));
  }

  return {
    trackingId: trackingId,
    slackTs: body.ts || ''
  };
}

function normalizeGenerationPayload_(input) {
  const payload = input || {};
  const urls = Array.isArray(payload.urls)
    ? payload.urls.map(normalizeUrl_).filter(Boolean)
    : [];
  const researchPrompt = String(payload.researchPrompt || '').trim();
  const mode = String(payload.mode || (researchPrompt ? 'research' : 'url')).trim();
  const audience = String(payload.audience || '').trim();
  const focus = String(payload.focus || '').trim();
  const pages = payload.pages === undefined || payload.pages === null || payload.pages === ''
    ? ''
    : String(payload.pages).trim();

  if (urls.length && researchPrompt) {
    throw new Error('URL and researchPrompt cannot be specified together.');
  }
  if (!urls.length && !researchPrompt) {
    throw new Error('Enter at least one URL or a research prompt.');
  }
  if (urls.length > 3) {
    throw new Error('URLs are limited to 3 items.');
  }
  if (urls.some(function(url) { return !/^https?:\/\/\S+/i.test(url); })) {
    throw new Error('URLs must start with http:// or https://.');
  }
  if (pages && !/^\d+$/.test(pages)) {
    throw new Error('pages must be an integer.');
  }

  return {
    mode: mode,
    urls: urls,
    researchPrompt: researchPrompt,
    audience: audience,
    focus: focus,
    pages: pages
  };
}

function buildSlideGenerationMessage_(payload, trackingId) {
  // Worker currently parses the Slack text as the command body, so keep
  // trackingId out of the posted message until the Worker can ignore it.
  // return buildSlideGenerationCommand_(payload) + '\n\ntrackingId: ' + trackingId;
  return buildSlideGenerationCommand_(payload);
}

function buildSlideGenerationCommand_(payload) {
  const args = ['[slide-generate]'];
  if (payload.urls.length) {
    args.push('--url', payload.urls.join(', '));
  } else {
    args.push('--research', quoteArg_(payload.researchPrompt));
  }
  if (payload.audience) {
    args.push('--audience', quoteArg_(payload.audience));
  }
  if (payload.focus) {
    args.push('--focus', quoteArg_(payload.focus));
  }
  if (payload.pages) {
    args.push('--pages', payload.pages);
  }
  return args.join(' ');
}

function createTrackingId_() {
  const timeZone = Session.getScriptTimeZone() || 'Asia/Tokyo';
  const date = Utilities.formatDate(new Date(), timeZone, 'yyyyMMdd');
  const suffix = Utilities.getUuid().replace(/-/g, '').slice(0, 10);
  return 'tracking_' + date + '_' + suffix;
}

function quoteArg_(value) {
  return '"' + String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

function normalizeUrl_(value) {
  return String(value || '').trim().replace(/[.,;:!?)}\]>]+$/g, '');
}

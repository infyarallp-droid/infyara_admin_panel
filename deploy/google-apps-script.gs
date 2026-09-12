/**
 * Google Form → Moksha admin panel bridge.
 *
 * Setup:
 * 1. Open the Google Form's linked responses Sheet.
 * 2. Extensions → Apps Script, paste this file.
 * 3. Set API_BASE and SHARED_SECRET below (SHARED_SECRET must equal the
 *    GOOGLE_FORM_SHARED_SECRET env var on the API).
 * 4. Triggers (clock icon) → Add Trigger → function: onFormSubmit,
 *    event source: From spreadsheet, event type: On form submit.
 */
const API_BASE = 'https://moksha-api.onrender.com'; // your Render API URL
const SHARED_SECRET = 'change-me-google-secret';    // == GOOGLE_FORM_SHARED_SECRET

function onFormSubmit(e) {
  const answers = {};
  if (e && e.namedValues) {
    Object.keys(e.namedValues).forEach(function (k) {
      answers[k] = String(e.namedValues[k]);
    });
  }
  UrlFetchApp.fetch(API_BASE + '/webhooks/google-form', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-shared-secret': SHARED_SECRET },
    muteHttpExceptions: true,
    payload: JSON.stringify({ answers: answers }),
  });
}

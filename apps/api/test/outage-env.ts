// Imported before ./setup.js by outage.test.ts: simulates production with file
// storage unreachable and WhatsApp credentials not yet provided.
process.env.STORAGE_PROVIDER = 'supabase';
process.env.SUPABASE_URL = 'http://127.0.0.1:9'; // nothing listens here → every upload fails
process.env.SUPABASE_SERVICE_KEY = 'unused-test-key';
process.env.TEST_WHATSAPP_UNCONFIGURED = '1';

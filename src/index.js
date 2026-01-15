const cron = require('node-cron');
const { syncUsers } = require('./sync');
const config = require('./config');

// Validate required environment variables
if (!config.SUPABASE_URL || !config.SUPABASE_KEY) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_KEY must be set in environment variables!');
  console.error('Please add them to your .env file.');
  process.exit(1);
}

console.log('Supabase User Sync Service starting...');
console.log(`Sync interval: ${config.SYNC_INTERVAL_MINUTES} minutes`);

// Run initial sync immediately on startup
syncUsers()
  .then(() => {
    console.log('Initial sync completed successfully.');
  })
  .catch((error) => {
    console.error('Initial sync failed:', error.message);
    // Continue anyway - cron will retry
  });

// Schedule incremental syncs every N minutes
const cronExpression = `*/${config.SYNC_INTERVAL_MINUTES} * * * *`;
console.log(`Scheduling syncs with cron expression: ${cronExpression}`);

cron.schedule(cronExpression, async () => {
  console.log(`\n[${new Date().toISOString()}] Scheduled sync starting...`);
  try {
    await syncUsers();
    console.log(`[${new Date().toISOString()}] Scheduled sync completed successfully.`);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Scheduled sync failed:`, error.message);
    // Don't throw - allow cron to continue scheduling
  }
});

console.log('Service is running. Press Ctrl+C to stop.');

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nShutting down gracefully...');
  process.exit(0);
});

const axios = require('axios');
const config = require('./config');
const { getCheckpoint, updateCheckpoint, insertUsers } = require('./supabase');

// Rate limiting: max 3 requests per 10 seconds
const RATE_LIMIT_MAX_REQUESTS = 3;
const RATE_LIMIT_WINDOW_MS = 10000; // 10 seconds
const apiCallTimestamps = [];

/**
 * Rate limiter: ensures we don't exceed 3 API calls per 10 seconds
 * @returns {Promise<void>}
 */
async function waitForRateLimit() {
  const now = Date.now();
  
  // Remove timestamps older than 10 seconds
  while (apiCallTimestamps.length > 0 && now - apiCallTimestamps[0] >= RATE_LIMIT_WINDOW_MS) {
    apiCallTimestamps.shift();
  }

  // If we've made 3 calls in the last 10 seconds, wait
  if (apiCallTimestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    const oldestCallTime = apiCallTimestamps[0];
    const waitTime = RATE_LIMIT_WINDOW_MS - (now - oldestCallTime) + 100; // Add 100ms buffer
    console.log(`Rate limit: Waiting ${Math.ceil(waitTime / 1000)} seconds before next API call...`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
    
    // Clean up old timestamps again after waiting
    const newNow = Date.now();
    while (apiCallTimestamps.length > 0 && newNow - apiCallTimestamps[0] >= RATE_LIMIT_WINDOW_MS) {
      apiCallTimestamps.shift();
    }
  }
}

/**
 * Record an API call timestamp (call this after making the API request)
 */
function recordApiCall() {
  apiCallTimestamps.push(Date.now());
}

/**
 * Fetch a single page from the API with rate limiting
 * @param {number} page - Page number to fetch
 * @returns {Promise<Object>} API response with users and pagination
 */
async function fetchUsersPage(page) {
  // Wait for rate limit before making the call
  await waitForRateLimit();

  try {
    const url = `${config.API_BASE_URL}${page > 1 ? `?page=${page}` : ''}`;
    const response = await axios.get(url, {
      timeout: 30000, // 30 second timeout
    });

    // Record successful API call
    recordApiCall();

    if (response.data.status !== 1) {
      throw new Error(`API returned status ${response.data.status}: ${response.data.message}`);
    }

    return response.data.data;
  } catch (error) {
    // Only record API call on network/request errors, not on response errors
    // (response errors mean we did make a call)
    if (error.response || error.request) {
      recordApiCall();
    }
    
    if (error.response) {
      throw new Error(`API error: ${error.response.status} - ${error.response.statusText}`);
    }
    if (error.request) {
      throw new Error('Network error: No response from API');
    }
    throw error;
  }
}

/**
 * Fetch all pages for initial sync
 * @returns {Promise<Array>} Array of all users from all pages
 */
async function fetchAllPages() {
  const allUsers = [];
  let currentPage = 1;
  let hasNextPage = true;

  console.log('Starting full sync - fetching all pages...');

  while (hasNextPage) {
    try {
      console.log(`Fetching page ${currentPage}...`);
      const data = await fetchUsersPage(currentPage);
      const users = data.users || [];

      if (users.length > 0) {
        allUsers.push(...users);
        console.log(`Fetched ${users.length} users from page ${currentPage}`);
      }

      hasNextPage = data.pagination?.hasNextPage || false;
      currentPage++;

      // Rate limiting is handled in fetchUsersPage, no need for additional delay
    } catch (error) {
      console.error(`Error fetching page ${currentPage}:`, error.message);
      throw error;
    }
  }

  console.log(`Full sync complete. Total users fetched: ${allUsers.length}`);
  return allUsers;
}

/**
 * Fetch pages incrementally starting from page 1 until checkpoint is found
 * @param {string} checkpointUserId - The user_id checkpoint to stop at
 * @returns {Promise<string>} The first user_id from page 1 (new checkpoint)
 */
async function fetchIncrementalPages(checkpointUserId) {
  let currentPage = 1;
  let hasNextPage = true;
  let firstUserIdFromPage1 = null;
  let totalInserted = 0;

  console.log(`Starting incremental sync. Looking for checkpoint: ${checkpointUserId}`);

  while (hasNextPage) {
    try {
      console.log(`Fetching page ${currentPage}...`);
      const data = await fetchUsersPage(currentPage);
      const users = data.users || [];

      if (users.length === 0) {
        console.log(`Page ${currentPage} is empty, stopping.`);
        break;
      }

      // Store first user_id from page 1 as new checkpoint
      if (currentPage === 1 && users.length > 0) {
        firstUserIdFromPage1 = users[0].user_id;
      }

      // Check if checkpoint user_id is in this page
      const checkpointIndex = users.findIndex(user => user.user_id === checkpointUserId);
      
      if (checkpointIndex !== -1) {
        // Found checkpoint - only insert users before the checkpoint
        const usersToInsert = users.slice(0, checkpointIndex);
        if (usersToInsert.length > 0) {
          const inserted = await insertUsers(usersToInsert);
          totalInserted += inserted;
          console.log(`Inserted ${inserted} new users from page ${currentPage} (before checkpoint)`);
        }
        console.log(`Found checkpoint user_id on page ${currentPage}, stopping sync.`);
        break;
      } else {
        // Checkpoint not found - insert all users from this page
        const inserted = await insertUsers(users);
        totalInserted += inserted;
        console.log(`Inserted ${users.length} users from page ${currentPage}`);
      }

      hasNextPage = data.pagination?.hasNextPage || false;
      currentPage++;

      // Rate limiting is handled in fetchUsersPage, no need for additional delay
    } catch (error) {
      console.error(`Error fetching page ${currentPage}:`, error.message);
      throw error;
    }
  }

  console.log(`Incremental sync complete. Total users inserted: ${totalInserted}`);

  if (!firstUserIdFromPage1) {
    // If we didn't get page 1, fetch it to get the latest user_id
    try {
      const data = await fetchUsersPage(1);
      const users = data.users || [];
      if (users.length > 0) {
        firstUserIdFromPage1 = users[0].user_id;
      }
    } catch (error) {
      console.error('Error fetching page 1 for checkpoint:', error.message);
      throw error;
    }
  }

  if (!firstUserIdFromPage1) {
    throw new Error('Could not determine checkpoint - page 1 is empty');
  }

  return firstUserIdFromPage1;
}

/**
 * Main sync orchestrator
 * Handles both initial sync and incremental sync
 */
async function syncUsers() {
  try {
    console.log('Starting sync...');
    const checkpoint = await getCheckpoint();

    if (!checkpoint) {
      // First run - full sync
      console.log('No checkpoint found. Performing initial full sync...');
      const allUsers = await fetchAllPages();

      if (allUsers.length > 0) {
        // Insert all users
        const inserted = await insertUsers(allUsers);
        console.log(`Inserted ${inserted} users into database`);

        // Get first user_id from page 1 as checkpoint
        const firstPageData = await fetchUsersPage(1);
        const firstPageUsers = firstPageData.users || [];
        if (firstPageUsers.length > 0) {
          const latestUserId = firstPageUsers[0].user_id;
          await updateCheckpoint(latestUserId);
          console.log('Initial sync complete. Checkpoint set to latest user.');
        } else {
          throw new Error('Page 1 is empty - cannot set checkpoint');
        }
      } else {
        console.log('No users found in API. Skipping sync.');
      }
    } else {
      // Incremental sync
      console.log(`Checkpoint found: ${checkpoint}. Performing incremental sync...`);
      const newCheckpoint = await fetchIncrementalPages(checkpoint);
      await updateCheckpoint(newCheckpoint);
      console.log('Incremental sync complete.');
    }
  } catch (error) {
    console.error('Sync error:', error.message);
    throw error;
  }
}

module.exports = {
  syncUsers,
  fetchUsersPage,
  fetchAllPages,
  fetchIncrementalPages,
};

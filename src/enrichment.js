const axios = require('axios');
const config = require('./config');
const { supabase } = require('./supabase');

/**
 * Check if an IP address is private/invalid
 * @param {string} ip - IP address to validate
 * @returns {boolean} True if IP is private or invalid
 */
function isPrivateIP(ip) {
  if (!ip) return true;
  
  // IPv4 private ranges
  const privateRanges = [
    /^10\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^192\.168\./,
    /^127\./,
    /^169\.254\./,
    /^0\./,
  ];
  
  return privateRanges.some(range => range.test(ip));
}

/**
 * Get users that need enrichment (have null enrichment fields)
 * @param {number} batchSize - Number of users to fetch
 * @param {number} offset - Offset for pagination
 * @returns {Promise<Array>} Array of users needing enrichment
 */
async function getUsersNeedingEnrichment(batchSize, offset = 0) {
  try {
    // Query for users where ip_address is not null and at least one enrichment field is null
    let query = supabase
      .from('id_users')
      .select('user_id, ip_address, country_name_official, state, city, district, country_code')
      .not('ip_address', 'is', null)
      .or('country_name_official.is.null,state.is.null,city.is.null,district.is.null,country_code.is.null')
      .range(offset, offset + batchSize - 1);

    const { data, error } = await query;

    if (error) {
      throw error;
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching users needing enrichment:', error);
    throw error;
  }
}

/**
 * Fetch geolocation data for an IP address
 * @param {string} ipAddress - IP address to look up
 * @returns {Promise<Object|null>} Geolocation data or null if error
 */
async function fetchGeolocationData(ipAddress) {
  if (!ipAddress || isPrivateIP(ipAddress)) {
    console.log(`Skipping private/invalid IP: ${ipAddress}`);
    return null;
  }

  try {
    const url = `${config.IP_GEOLOCATION_API_URL}?apiKey=${config.IP_GEOLOCATION_API_KEY}&ip=${ipAddress}`;
    const response = await axios.get(url, {
      timeout: 10000, // 10 second timeout
    });

    return response.data;
  } catch (error) {
    if (error.response) {
      console.error(`API error for IP ${ipAddress}: ${error.response.status} - ${error.response.statusText}`);
    } else if (error.request) {
      console.error(`Network error for IP ${ipAddress}: No response from API`);
    } else {
      console.error(`Error fetching geolocation for IP ${ipAddress}:`, error.message);
    }
    return null;
  }
}

/**
 * Update user record with geolocation data
 * Only updates fields that are currently null
 * @param {string} userId - User ID to update
 * @param {Object} geolocationData - Geolocation data from API
 * @returns {Promise<boolean>} True if update was successful
 */
async function enrichUser(userId, geolocationData) {
  if (!geolocationData || !geolocationData.location) {
    return false;
  }

  try {
    const location = geolocationData.location;
    
    // Build update object with only non-null values from API
    const updates = {};
    
    if (location.country_name_official) {
      updates.country_name_official = location.country_name_official;
    }
    if (location.state_prov) {
      updates.state = location.state_prov;
    }
    if (location.city) {
      updates.city = location.city;
    }
    if (location.district) {
      updates.district = location.district;
    }
    if (location.country_code2) {
      updates.country_code = location.country_code2;
    }

    if (Object.keys(updates).length === 0) {
      return false;
    }

    // Use COALESCE to only update null fields
    // Supabase doesn't support COALESCE directly in update, so we'll use a different approach
    // First, get the current user to check which fields are null
    const { data: currentUser, error: fetchError } = await supabase
      .from('id_users')
      .select('country_name_official, state, city, district, country_code')
      .eq('user_id', userId)
      .single();

    if (fetchError) {
      throw fetchError;
    }

    // Only update fields that are currently null
    const finalUpdates = {};
    if (updates.country_name_official && !currentUser.country_name_official) {
      finalUpdates.country_name_official = updates.country_name_official;
    }
    if (updates.state && !currentUser.state) {
      finalUpdates.state = updates.state;
    }
    if (updates.city && !currentUser.city) {
      finalUpdates.city = updates.city;
    }
    if (updates.district && !currentUser.district) {
      finalUpdates.district = updates.district;
    }
    if (updates.country_code && !currentUser.country_code) {
      finalUpdates.country_code = updates.country_code;
    }

    if (Object.keys(finalUpdates).length === 0) {
      return false;
    }

    const { error } = await supabase
      .from('id_users')
      .update(finalUpdates)
      .eq('user_id', userId);

    if (error) {
      throw error;
    }

    return true;
  } catch (error) {
    console.error(`Error enriching user ${userId}:`, error);
    return false;
  }
}

/**
 * Process a batch of users for enrichment
 * @param {number} batchSize - Number of users to process in this batch
 * @param {number} offset - Offset for pagination
 * @returns {Promise<{processed: number, enriched: number, hasMore: boolean}>}
 */
async function processEnrichmentBatch(batchSize, offset = 0) {
  try {
    const users = await getUsersNeedingEnrichment(batchSize, offset);
    
    if (users.length === 0) {
      return { processed: 0, enriched: 0, hasMore: false };
    }

    console.log(`Processing batch: ${users.length} users (offset: ${offset})`);

    let enrichedCount = 0;
    let processedCount = 0;

    // Process users sequentially to avoid overwhelming the API
    for (const user of users) {
      try {
        processedCount++;
        const geolocationData = await fetchGeolocationData(user.ip_address);
        
        if (geolocationData) {
          const success = await enrichUser(user.user_id, geolocationData);
          if (success) {
            enrichedCount++;
          }
        }

        // Add a small delay between API calls to be respectful
        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        console.error(`Error processing user ${user.user_id}:`, error.message);
        // Continue with next user
      }
    }

    console.log(`Batch complete: ${processedCount} processed, ${enrichedCount} enriched`);

    return {
      processed: processedCount,
      enriched: enrichedCount,
      hasMore: users.length === batchSize, // If we got a full batch, there might be more
    };
  } catch (error) {
    console.error('Error processing enrichment batch:', error);
    throw error;
  }
}

/**
 * Main enrichment orchestrator
 * Processes all users needing enrichment in batches until none remain
 * @returns {Promise<{totalProcessed: number, totalEnriched: number}>}
 */
async function enrichUsers() {
  try {
    console.log('Starting user enrichment...');
    const batchSize = config.ENRICHMENT_BATCH_SIZE;
    let offset = 0;
    let totalProcessed = 0;
    let totalEnriched = 0;
    let hasMore = true;

    while (hasMore) {
      const result = await processEnrichmentBatch(batchSize, offset);
      
      totalProcessed += result.processed;
      totalEnriched += result.enriched;
      hasMore = result.hasMore;
      offset += batchSize;

      // If we got fewer users than the batch size, we're done
      if (result.processed < batchSize) {
        hasMore = false;
      }

      // Small delay between batches
      if (hasMore) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    console.log(`Enrichment complete: ${totalProcessed} users processed, ${totalEnriched} users enriched`);
    return { totalProcessed, totalEnriched };
  } catch (error) {
    console.error('Enrichment error:', error);
    throw error;
  }
}

module.exports = {
  enrichUsers,
  getUsersNeedingEnrichment,
  fetchGeolocationData,
  enrichUser,
  processEnrichmentBatch,
  isPrivateIP,
};

const { createClient } = require('@supabase/supabase-js');
const config = require('./config');

const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_KEY);

const CHECKPOINT_KEY = 'last_synced_user_id';

async function getCheckpoint() {
  try {
    const { data, error } = await supabase
      .from('id_sync_state')
      .select('value')
      .eq('key', CHECKPOINT_KEY)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null;
      }
      throw error;
    }

    return data?.value || null;
  } catch (error) {
    console.error('Error getting checkpoint:', error);
    throw error;
  }
}

async function updateCheckpoint(userId) {
  try {
    const { error } = await supabase
      .from('id_sync_state')
      .upsert({
        key: CHECKPOINT_KEY,
        value: userId,
        updated_at: new Date().toISOString(),
      }, {
        onConflict: 'key',
      });

    if (error) {
      throw error;
    }

    console.log(`Checkpoint updated to: ${userId}`);
  } catch (error) {
    console.error('Error updating checkpoint:', error);
    throw error;
  }
}

async function insertUsers(users) {
  if (!users || users.length === 0) {
    return 0;
  }

  try {
    const dbUsers = users.map(user => ({
      user_id: user.user_id,
      email: user.email,
      ip_address: user.ipAddress || null,
      identifier_type: user.identifierType,
      created_at: user.createdAt,
      updated_at: user.updatedAt,
      ingested_at: new Date().toISOString(),
    }));

    const { data, error } = await supabase
      .from('id_users')
      .upsert(dbUsers, {
        onConflict: 'user_id',
        ignoreDuplicates: true,
      });

    if (error) {
      throw error;
    }

    return dbUsers.length;
  } catch (error) {
    console.error('Error inserting users:', error);
    return 0;
  }
}

module.exports = {
  supabase,
  getCheckpoint,
  updateCheckpoint,
  insertUsers,
};

# Deployment Guide

This guide explains how to deploy and run both services (sync and enrichment) on your server using PM2.

## Prerequisites

- Node.js installed on your server
- npm or yarn package manager
- PM2 will be installed automatically when you run `npm install`

## Step 1: Install Dependencies

```bash
cd backend
npm install
```

## Step 2: Configure Environment Variables

Create a `.env` file in the `backend/` directory with all required variables:

```env
# Supabase Configuration
SUPABASE_URL=https://fyyuowhisscsymrnjrtf.supabase.co
SUPABASE_KEY=your_supabase_key_here

# API Configuration
API_BASE_URL=http://apiv1.avici.club:3200/api/v1/pipe/users/all
SYNC_INTERVAL_MINUTES=10

# IP Geolocation API
IP_GEOLOCATION_API_KEY=your_ipgeolocation_api_key_here
IP_GEOLOCATION_API_URL=https://api.ipgeolocation.io/v2/ipgeo
ENRICHMENT_INTERVAL_MINUTES=10
ENRICHMENT_BATCH_SIZE=50
```

## Step 3: Start Services with PM2

Start both services:

```bash
npm run pm2:start
```

This will start:
- `user-sync-service` - Syncs users from API to Supabase
- `user-enrichment-service` - Enriches user records with geolocation data

## Step 4: Verify Services are Running

Check the status:

```bash
npm run pm2:status
```

You should see both services with status "online".

## Step 5: View Logs

View logs from both services:

```bash
npm run pm2:logs
```

View logs for a specific service:

```bash
pm2 logs user-sync-service
pm2 logs user-enrichment-service
```

## Useful PM2 Commands

### Stop Services
```bash
npm run pm2:stop
```

### Restart Services
```bash
npm run pm2:restart
```

### Delete Services (stops and removes from PM2)
```bash
npm run pm2:delete
```

### View Real-time Monitoring
```bash
pm2 monit
```

### Save PM2 Configuration
After starting services, save the current process list so PM2 restarts them on server reboot:

```bash
pm2 save
pm2 startup
```

The `pm2 startup` command will give you a command to run with sudo that sets up PM2 to start on system boot.

## Auto-restart on Server Reboot

To ensure services restart automatically when the server reboots:

1. Run `pm2 save` to save the current process list
2. Run `pm2 startup` - it will output a command like:
   ```
   sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u your_username --hp /home/your_username
   ```
3. Copy and run that command with sudo
4. Services will now auto-start on server reboot

## Troubleshooting

### Services not starting
- Check that `.env` file exists and has all required variables
- Check logs: `npm run pm2:logs`
- Verify Node.js version: `node --version`

### Services crashing
- Check error logs in `./logs/` directory
- Verify API keys are correct in `.env`
- Check database connection (Supabase URL and key)

### View detailed process info
```bash
pm2 show user-sync-service
pm2 show user-enrichment-service
```

## Logs Location

Logs are stored in:
- `./logs/sync-error.log` - Sync service errors
- `./logs/sync-out.log` - Sync service output
- `./logs/enrichment-error.log` - Enrichment service errors
- `./logs/enrichment-out.log` - Enrichment service output

## Notes

- Both services run independently and can be managed separately
- Services automatically restart if they crash
- Memory limit is set to 500MB per service (adjust in `ecosystem.config.js` if needed)
- Services run in production mode (NODE_ENV=production)

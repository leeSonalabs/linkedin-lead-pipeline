# LinkedIn Lead Generation Pipeline

A Node.js application that automates lead generation from LinkedIn post engagers. Triggered by Slack messages, it extracts people who engaged with a LinkedIn post, enriches their profiles, and adds them to cold email campaigns.

## Pipeline Flow

```
Slack Message → Apify (scrape) → Apollo (enrich) → Smartlead (campaign)
```

## Features

- **Slack Integration**: Listen for messages with LinkedIn post URLs
- **Apify Scraping**: Extract likers and commenters from LinkedIn posts
- **Apollo Enrichment**: Get verified emails and contact details
- **Smartlead Integration**: Auto-add leads to email campaigns with custom variables

## Prerequisites

1. **Slack App**: Create at [api.slack.com/apps](https://api.slack.com/apps)
2. **Apify Account**: Sign up at [apify.com](https://apify.com)
3. **Apollo.io Account**: Get API key from [apollo.io](https://apollo.io)
4. **Smartlead Account**: Get API key from [smartlead.ai](https://smartlead.ai)

## Slack App Setup

1. Create a new Slack app at [api.slack.com/apps](https://api.slack.com/apps)

2. **Bot Token Scopes** (OAuth & Permissions):
   - `chat:write` - Send messages
   - `channels:history` - Read messages in public channels
   - `channels:read` - View basic channel info

3. **Event Subscriptions**:
   - Enable Events
   - Subscribe to bot events: `message.channels`
   - Set Request URL to: `https://your-railway-url.up.railway.app/slack/events`

4. **Install the app** to your workspace and copy the Bot Token

5. **Get the Channel ID**:
   - Right-click on the channel → View channel details
   - Copy the Channel ID at the bottom

### Socket Mode (Alternative - Easier for Development)

If you don't want to set up a public URL for events:

1. Enable Socket Mode in your Slack app settings
2. Generate an App-Level Token with `connections:write` scope
3. Set `SLACK_APP_TOKEN` in your environment variables

## Apify Setup

1. Sign up at [apify.com](https://apify.com)

2. Get your API Token:
   - Go to Settings → Integrations
   - Copy your Personal API Token

3. The app uses these community actors by default:
   - `curious_coder/linkedin-post-reactions-scraper` - For post likes/reactions
   - `curious_coder/linkedin-post-comments-scraper` - For post comments

   You can use custom actors by setting the environment variables:
   - `APIFY_LINKEDIN_REACTIONS_ACTOR_ID`
   - `APIFY_LINKEDIN_COMMENTS_ACTOR_ID`

4. **Important**: Apify uses residential proxies for LinkedIn scraping. Make sure you have sufficient credits in your account.

## Smartlead Setup

1. Sign up at [smartlead.ai](https://smartlead.ai)

2. Get your API Key:
   - Go to Settings → API
   - Copy your API key

3. Get your Campaign ID:
   - Go to Campaigns
   - Select or create a campaign
   - The Campaign ID is in the URL or campaign settings

## Environment Variables

Create a `.env` file based on `.env.example`:

```env
# Slack
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_SIGNING_SECRET=your-signing-secret
SLACK_CHANNEL_ID=C0123456789
SLACK_APP_TOKEN=xapp-your-app-token  # Optional, for Socket Mode

# Apify
APIFY_API_TOKEN=your-api-token
# Optional: Custom actor IDs
# APIFY_LINKEDIN_REACTIONS_ACTOR_ID=your-custom-reactions-actor
# APIFY_LINKEDIN_COMMENTS_ACTOR_ID=your-custom-comments-actor

# Apollo
APOLLO_API_KEY=your-api-key

# Smartlead
SMARTLEAD_API_KEY=your-api-key
SMARTLEAD_CAMPAIGN_ID=your-campaign-id

# Server
PORT=3000
LOG_LEVEL=INFO
```

## Local Development

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env
# Edit .env with your credentials

# Run the application
npm start

# Run with auto-reload (Node 18+)
npm run dev
```

## Railway Deployment

### Option 1: Deploy via GitHub

1. Push this code to a GitHub repository

2. Go to [Railway](https://railway.app) and create a new project

3. Select "Deploy from GitHub repo" and choose your repository

4. Add environment variables in Railway:
   - Go to your service → Variables
   - Add all variables from `.env.example`

5. Railway will auto-deploy on every push to main

### Option 2: Deploy via CLI

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login to Railway
railway login

# Initialize project
railway init

# Add environment variables
railway variables set SLACK_BOT_TOKEN=xoxb-...
railway variables set SLACK_SIGNING_SECRET=...
# ... add all other variables

# Deploy
railway up
```

### Post-Deployment

1. Get your Railway URL from the deployment dashboard

2. Update your Slack app's Event Subscriptions URL:
   ```
   https://your-app.up.railway.app/slack/events
   ```

3. Verify the URL in Slack app settings

## Usage

Send a message in your configured Slack channel with a LinkedIn post URL:

```
https://www.linkedin.com/posts/username_topic-activity-1234567890
```

Or with the prefix:
```
POST_URL: https://www.linkedin.com/posts/username_topic-activity-1234567890
```

The bot will:
1. Detect the LinkedIn URL
2. Send status updates as it processes
3. Send a final summary:
   ```
   ✅ Pipeline Complete

   Found 150 engagers
   → 89 emails from Apollo
   → 89 pushed to Smartlead
   ```

## Smartlead Custom Fields

Each lead pushed to Smartlead includes these custom fields for your email templates:

- `{{first_name}}` - Lead's first name
- `{{last_name}}` - Lead's last name
- `{{company}}` - Lead's company name
- `{{title}}` - Lead's job title
- `{{linkedin_url}}` - Lead's LinkedIn profile URL

## Project Structure

```
├── src/
│   ├── index.js              # Main entry point
│   ├── services/
│   │   ├── slack.js          # Slack bot integration
│   │   ├── apify.js          # LinkedIn scraping via Apify
│   │   ├── apollo.js         # Profile enrichment
│   │   └── smartlead.js      # Campaign management
│   └── utils/
│       └── logger.js         # Logging utility
├── package.json
├── railway.json              # Railway config
├── Procfile                  # Process file
├── .env.example              # Environment template
└── README.md
```

## Error Handling

- Each service has built-in error handling and retries
- Failed leads are logged but don't stop the pipeline
- Slack receives error notifications if the pipeline fails
- All steps are logged for debugging

## Rate Limits

The application respects API rate limits:

- **Apify**: Runs actors with residential proxies, waits for completion
- **Apollo**: 5 concurrent requests with 1s delay between batches
- **Smartlead**: Bulk upload with fallback to individual adds (200ms delay)

Adjust these in the service files if needed.

## Troubleshooting

### "No engagers found"
- Verify the LinkedIn post URL is correct and public
- Check that the Apify actors are working (test in Apify console)
- Ensure the post has actual engagers (likes/comments)
- Check your Apify credit balance

### "No verified emails found"
- Apollo may not have data for all profiles
- Many LinkedIn profiles don't have associated emails
- This is normal - expect ~30-60% match rate

### "Slack events not received"
- Verify the Event Subscriptions URL is correct
- Check that the bot is in the channel
- Ensure proper OAuth scopes are set

### "Apify actor failed"
- Check your Apify credit balance
- Verify the actor IDs are correct
- Some actors may have usage limits or require authentication

### "Smartlead API error"
- Verify your API key is correct
- Check that the campaign ID exists
- Ensure your Smartlead plan supports API access

## License

MIT

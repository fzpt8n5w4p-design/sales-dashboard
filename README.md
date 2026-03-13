# OpsCore Dashboard

Live operations dashboard — Veeqo · Amazon SP-API · eBay · Google Sheets

## Stack
- **Next.js 14** (React + server-side API proxies — no CORS issues)
- **react-grid-layout** (draggable, resizable panels)
- **Deployed on Render** via GitHub

---

## Local Setup

### 1. Install dependencies
```bash
npm install
```

### 2. Add your API keys
```bash
cp .env.example .env.local
```
Open `.env.local` and fill in your credentials (see section below).

### 3. Run locally
```bash
npm run dev
```
Open http://localhost:3000

---

## API Credentials

### Veeqo
1. Log in to Veeqo → **Settings → API**
2. Generate an API key
3. Add to `.env.local`:
   ```
   VEEQO_API_KEY=vq_live_xxxxxxxxxxxx
   ```

### Amazon SP-API
1. Go to **Seller Central → Apps & Services → Develop Apps**
2. Create an app → note your Client ID and Client Secret
3. Generate a Refresh Token via the SP-API OAuth flow
4. Add to `.env.local`:
   ```
   AMAZON_SELLER_ID=A3P5ROKL5A1OLE
   AMAZON_CLIENT_ID=amzn1.application-oa2-client.xxx
   AMAZON_CLIENT_SECRET=your-secret
   AMAZON_REFRESH_TOKEN=Atzr|xxx
   AMAZON_MARKETPLACE_ID=A1F83G8C2ARO7P
   ```
   Marketplace IDs: UK=`A1F83G8C2ARO7P` · DE=`A1PA6795UKMFR9` · FR=`A13V1IB3VIYZZH` · IT=`APJ6JRA9NG5V4` · ES=`A1RKKUPIHCS9HS`

### eBay
1. Go to **developer.ebay.com → My Account → Application Keys**
2. Get your App ID and generate a User Token with `sell.fulfillment` and `sell.analytics` scopes
3. Add to `.env.local`:
   ```
   EBAY_TOKEN=v^1.1#i^1#r^0#...
   EBAY_ENV=production
   ```

### Google Sheets
1. Go to **console.cloud.google.com → APIs → Google Sheets API → Enable**
2. Create credentials → API Key
3. Your spreadsheet must be shared as "Anyone with the link can view"
4. Sheet format (row 1 = headers, row 2+ = data):
   ```
   Metric     | Target | Actual | Unit
   Revenue    | 22000  | 18420  | £
   Orders     | 420    | 347    |
   Shipments  | 380    | 291    |
   ```
5. Add to `.env.local`:
   ```
   GOOGLE_SHEETS_API_KEY=AIzaSy...
   GOOGLE_SHEETS_ID=1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms
   GOOGLE_SHEETS_RANGE=Targets!A1:D10
   ```

---

## Deploy to Render via GitHub

### Step 1 — Push to GitHub
```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/opscore-dashboard.git
git push -u origin main
```

### Step 2 — Create Render Web Service
1. Go to **render.com** → New → Web Service
2. Connect your GitHub repo
3. Configure:
   - **Runtime**: Node
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Plan**: Free (or Starter for always-on)

### Step 3 — Add Environment Variables on Render
In your Render service → **Environment** tab, add every key from your `.env.local`.
**Never commit `.env.local` to GitHub** — it's in `.gitignore`.

### Step 4 — Deploy
Click **Deploy**. Render will build and give you a URL like `opscore-dashboard.onrender.com`.

Future deploys are automatic — just `git push` and Render redeploys.

---

## Using the Dashboard

- **Drag panels** by hovering the top of any card and dragging
- **Resize panels** from the bottom-right handle
- **Change date range** with the Today / Yesterday / 7 Days / 30 Days buttons
- **Layout auto-saves** in your browser — each team member's layout is personal
- **Reset Layout** button restores the default arrangement
- Auto-refreshes every 60 seconds

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Veeqo dot is red | Check `VEEQO_API_KEY` — test at `your-url/api/veeqo` |
| Amazon 401 | Refresh token expired — regenerate via SP-API OAuth |
| eBay 403 | Token scope missing `sell.fulfillment` |
| Sheets 403 | Sheet not set to public viewer access |
| Render "build failed" | Check build logs — usually a missing env var |

Open the browser console or visit `/api/veeqo`, `/api/amazon` etc. directly to see raw error messages.

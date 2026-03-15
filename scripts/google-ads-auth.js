/**
 * Google Ads OAuth2 helper — spins up a local server to capture the redirect
 *
 * Usage:
 *   1. Set GOOGLE_ADS_CLIENT_ID and GOOGLE_ADS_CLIENT_SECRET in .env.local
 *   2. In Google Cloud Console, add http://localhost:9090 as an authorized redirect URI
 *   3. Run: node scripts/google-ads-auth.js
 *   4. It opens your browser automatically — sign in and grant access
 *   5. The refresh token is printed in the terminal
 */

const fs = require('fs')
const path = require('path')
const http = require('http')
const { exec } = require('child_process')

// Load env vars from .env.local
const envPath = path.join(__dirname, '..', '.env.local')
const envContent = fs.readFileSync(envPath, 'utf8')
const env = {}
envContent.split('\n').forEach(line => {
  const match = line.match(/^([^#=]+)=(.*)$/)
  if (match) env[match[1].trim()] = match[2].trim()
})

const CLIENT_ID = env.GOOGLE_ADS_CLIENT_ID
const CLIENT_SECRET = env.GOOGLE_ADS_CLIENT_SECRET

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('\nError: Set GOOGLE_ADS_CLIENT_ID and GOOGLE_ADS_CLIENT_SECRET in .env.local first\n')
  process.exit(1)
}

const PORT = 9090
const REDIRECT_URI = `http://localhost:${PORT}`
const SCOPE = 'https://www.googleapis.com/auth/adwords'

const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
  `client_id=${CLIENT_ID}&` +
  `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
  `scope=${encodeURIComponent(SCOPE)}&` +
  `response_type=code&` +
  `access_type=offline&` +
  `prompt=consent`

console.log('\n=== Google Ads OAuth2 Setup ===\n')
console.log('IMPORTANT: Make sure http://localhost:9090 is listed as an')
console.log('authorized redirect URI in your Google Cloud Console:')
console.log('  APIs & Services > Credentials > Your OAuth Client > Authorized redirect URIs\n')
console.log('Opening browser...\n')

// Open browser
exec(`open "${authUrl}"`)

// Start local server to capture the redirect
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')

  if (error) {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<h2>Error</h2><p>' + error + '</p><p>You can close this tab.</p>')
    console.error('Error:', error)
    server.close()
    process.exit(1)
  }

  if (!code) {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<p>Waiting for authorization...</p>')
    return
  }

  // Exchange code for tokens
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    })

    const data = await tokenRes.json()

    if (data.error) {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(`<h2>Error</h2><p>${data.error}: ${data.error_description}</p>`)
      console.error('\nError:', data.error, '-', data.error_description)
      server.close()
      process.exit(1)
    }

    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<h2 style="color:green">Success!</h2><p>Refresh token received. You can close this tab and check the terminal.</p>')

    console.log('=== Success! ===\n')
    console.log('Add this to your .env.local:\n')
    console.log(`GOOGLE_ADS_REFRESH_TOKEN=${data.refresh_token}`)
    console.log()

    server.close()
    process.exit(0)
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/html' })
    res.end('<h2>Error</h2><p>' + err.message + '</p>')
    console.error('Failed:', err.message)
    server.close()
    process.exit(1)
  }
})

server.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT} for OAuth redirect...\n`)
})

/**
 * Amazon SP-API OAuth2 helper
 *
 * Generates the authorization URL for Seller Central, then
 * captures the redirect to exchange the auth code for a refresh token.
 *
 * Usage:
 *   1. Set AMAZON_CLIENT_ID and AMAZON_CLIENT_SECRET in .env.local
 *   2. Run: node scripts/amazon-sp-auth.js
 *   3. Sign in to Seller Central and authorize the app
 *   4. The refresh token is printed in the terminal
 */

const fs = require('fs')
const path = require('path')
const http = require('http')
const { exec } = require('child_process')
const crypto = require('crypto')

// Load env vars from .env.local
const envPath = path.join(__dirname, '..', '.env.local')
const envContent = fs.readFileSync(envPath, 'utf8')
const env = {}
envContent.split('\n').forEach(line => {
  const match = line.match(/^([^#=]+)=(.*)$/)
  if (match) env[match[1].trim()] = match[2].trim()
})

const CLIENT_ID = env.AMAZON_CLIENT_ID
const CLIENT_SECRET = env.AMAZON_CLIENT_SECRET

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('\nError: Set AMAZON_CLIENT_ID and AMAZON_CLIENT_SECRET in .env.local first\n')
  process.exit(1)
}

const PORT = 9091
const REDIRECT_URI = `https://localhost:${PORT}/callback`
const APP_ID = 'amzn1.sp.solution.c6101be6-c21b-486e-aa78-e396bea35242'
const STATE = crypto.randomBytes(16).toString('hex')

// Amazon Seller Central authorization URL
// This sends the seller to Seller Central to authorize your app
const authUrl = `https://sellercentral.amazon.co.uk/apps/authorize/consent?` +
  `application_id=${APP_ID}&` +
  `redirect_uri=${encodeURIComponent(REDIRECT_URI)}&` +
  `state=${STATE}&` +
  `version=beta`

console.log('\n=== Amazon SP-API OAuth2 Setup ===\n')
console.log('This will open Seller Central in your browser.')
console.log('Sign in and click "Authorize" to grant access.\n')
console.log('If the redirect fails (localhost SSL issue), just copy the')
console.log('full URL from your browser address bar and paste it below.\n')

// Try to open browser
exec(`open "${authUrl}"`)

// Start local server to try to capture redirect
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  const code = url.searchParams.get('spapi_oauth_code')
  const state = url.searchParams.get('state')

  if (!code) {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<p>Waiting for authorization...</p>')
    return
  }

  if (state !== STATE) {
    res.writeHead(400, { 'Content-Type': 'text/html' })
    res.end('<h2>Error: State mismatch</h2>')
    return
  }

  await exchangeCode(code, res)
})

server.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT} for redirect...\n`)
  console.log('--- OR paste the full redirect URL here (if browser shows an error): ---\n')
})

// Also accept pasted URL from stdin
const readline = require('readline')
const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

rl.on('line', async (line) => {
  const trimmed = line.trim()
  if (!trimmed) return

  try {
    // Handle both full URLs and bare codes
    let code
    if (trimmed.includes('spapi_oauth_code=')) {
      const url = new URL(trimmed.replace('https://localhost', 'http://localhost'))
      code = url.searchParams.get('spapi_oauth_code')
    } else {
      code = trimmed
    }

    if (code) {
      await exchangeCode(code)
      rl.close()
      server.close()
    }
  } catch (e) {
    console.log('Could not parse that. Paste the full URL or just the spapi_oauth_code value.\n')
  }
})

async function exchangeCode(code, res) {
  try {
    console.log('\nExchanging authorization code for refresh token...\n')

    const tokenRes = await fetch('https://api.amazon.com/auth/o2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
      }),
    })

    const data = await tokenRes.json()

    if (data.error) {
      const msg = `${data.error}: ${data.error_description}`
      if (res) {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(`<h2>Error</h2><p>${msg}</p>`)
      }
      console.error('Error:', msg)
      process.exit(1)
    }

    if (res) {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<h2 style="color:green">Success!</h2><p>Refresh token received. Check the terminal.</p>')
    }

    console.log('=== Success! ===\n')
    console.log('Add this to your .env.local:\n')
    console.log(`AMAZON_REFRESH_TOKEN=${data.refresh_token}`)
    console.log()

    server.close()
    rl.close()
    process.exit(0)
  } catch (err) {
    console.error('Failed to exchange code:', err.message)
    if (res) {
      res.writeHead(500, { 'Content-Type': 'text/html' })
      res.end('<h2>Error</h2><p>' + err.message + '</p>')
    }
  }
}

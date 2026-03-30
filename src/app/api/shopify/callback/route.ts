import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const code = searchParams.get('code')
  const shop = searchParams.get('shop')

  if (!code || !shop) {
    return NextResponse.json({ ok: false, error: 'Missing code or shop parameter' }, { status: 400 })
  }

  const clientId = process.env.SHOPIFY_B2B_CLIENT_ID
  const clientSecret = process.env.SHOPIFY_B2B_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    return NextResponse.json({ ok: false, error: 'SHOPIFY_B2B_CLIENT_ID or SHOPIFY_B2B_CLIENT_SECRET not set' }, { status: 500 })
  }

  try {
    const res = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      return NextResponse.json({ ok: false, error: `Token exchange failed: ${body}` }, { status: res.status })
    }

    const data = await res.json()

    // Display the token so you can copy it and add it as SHOPIFY_B2B_TOKEN env var
    return new NextResponse(
      `<html><body style="background:#000;color:#fff;font-family:monospace;padding:40px">
        <h1>Shopify OAuth Success!</h1>
        <p>Access Token (save this as SHOPIFY_B2B_TOKEN):</p>
        <pre style="background:#111;padding:20px;border-radius:8px;font-size:18px;word-break:break-all">${data.access_token}</pre>
        <p>Scope: ${data.scope}</p>
        <p style="color:#FF453A;margin-top:20px">Copy this token now and add it as an environment variable. You will not be able to see it again.</p>
      </body></html>`,
      { headers: { 'Content-Type': 'text/html' } }
    )
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 })
  }
}

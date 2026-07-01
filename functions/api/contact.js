// Cloudflare Pages Function — replaces Netlify Forms.
// Deploys automatically at POST /api/contact
//
// Required Pages environment variables (Pages project settings > Environment variables):
//   RESEND_API_KEY       - API key from resend.com
//   TURNSTILE_SECRET_KEY - secret key from the Cloudflare Turnstile dashboard
//
// Also replace the placeholder site key in index.html
// (data-sitekey="YOUR_TURNSTILE_SITE_KEY") with your Turnstile *site* key.
//
// Resend requires the "from" address to be on a domain you've verified in
// your Resend account - update RESEND_FROM below once that's set up.

const NOTIFY_TO = "andrew@snailface.com";
const RESEND_FROM = "snailface <contact@snailface.com>";

export async function onRequestPost(context) {
  const { request, env } = context;

  let formData;
  try {
    formData = await request.formData();
  } catch (err) {
    return new Response("Bad request", { status: 400 });
  }

  const name = (formData.get("name") || "").toString().trim();
  const email = (formData.get("email") || "").toString().trim();
  const message = (formData.get("message") || "").toString().trim();
  const turnstileToken = formData.get("cf-turnstile-response");

  if (!name || !email || !message) {
    return new Response("Missing required fields", { status: 400 });
  }

  // Verify Turnstile token to block bots/spam.
  if (env.TURNSTILE_SECRET_KEY) {
    const verifyRes = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: env.TURNSTILE_SECRET_KEY,
          response: turnstileToken,
          remoteip: request.headers.get("CF-Connecting-IP"),
        }),
      }
    );
    const verifyData = await verifyRes.json();
    if (!verifyData.success) {
      return new Response("Spam check failed", { status: 400 });
    }
  }

  // Send the notification email via Resend.
  const emailRes = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: RESEND_FROM,
      to: [NOTIFY_TO],
      reply_to: email,
      subject: `New message from ${name}`,
      text: `From: ${name} <${email}>\n\n${message}`,
    }),
  });

  if (!emailRes.ok) {
    const errText = await emailRes.text();
    return new Response(`Failed to send message: ${errText}`, { status: 502 });
  }

  return Response.redirect(new URL("/thank-you", request.url), 303);
}

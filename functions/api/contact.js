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
// RESEND_FROM currently uses Resend's shared sandbox address, which works
// without verifying a domain but can ONLY deliver to the email address the
// Resend account itself was signed up with (NOTIFY_TO below). Once
// snailface.com is verified in Resend, switch this to something like
// "snailface <contact@snailface.com>" to send from your own domain instead.

const NOTIFY_TO = "andrew@snailface.com";
const RESEND_FROM = "snailface <onboarding@resend.dev>";

export async function onRequestPost(context) {
  const { request, env } = context;

  // Everything below is wrapped in try/catch: an uncaught exception here
  // makes Cloudflare show its own generic "Bad gateway" page instead of a
  // useful error, which is much harder to debug. Always return a Response.
  try {
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
      try {
        const verifyRes = await fetch(
          "https://challenges.cloudflare.com/turnstile/v0/siteverify",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              secret: env.TURNSTILE_SECRET_KEY,
              response: turnstileToken || "",
              remoteip: request.headers.get("CF-Connecting-IP"),
            }),
          }
        );
        const verifyData = await verifyRes.json();
        if (!verifyData.success) {
          return new Response("Spam check failed", { status: 400 });
        }
      } catch (err) {
        return new Response(`Spam check error: ${err.message}`, { status: 502 });
      }
    }

    if (!env.RESEND_API_KEY) {
      return new Response(
        "Server misconfigured: RESEND_API_KEY is not set on this Pages project.",
        { status: 500 }
      );
    }

    // Send the notification email via Resend.
    let emailRes;
    try {
      emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: RESEND_FROM,
          to: [NOTIFY_TO],
          reply_to: email,
          subject: `Snailface.com submitted message by ${name}`,
          text: `From: ${name} <${email}>\n\n${message}`,
        }),
      });
    } catch (err) {
      return new Response(`Failed to reach Resend: ${err.message}`, { status: 502 });
    }

    if (!emailRes.ok) {
      const errText = await emailRes.text();
      return new Response(`Failed to send message: ${errText}`, { status: 502 });
    }

    return Response.redirect(new URL("/thank-you", request.url), 303);
  } catch (err) {
    return new Response(`Unexpected error: ${err.message}`, { status: 500 });
  }
}

/**
 * Cloudflare Email Routing Worker for Disposable Temp Mail
 * 
 * How it works:
 * 1. Cloudflare receives any email sent to *@yourdomain.com
 * 2. This worker intercepts the email stream
 * 3. It converts the raw MIME message to a stream or arrayBuffer
 * 4. It POSTs the raw RFC822 email to your TempMail webhook endpoint
 */

export default {
  async email(message, env, ctx) {
    // URL of your deployed TempMail instance webhook
    // e.g., "https://tempmail.yourdomain.com/api/webhook/email"
    const WEBHOOK_URL = env.WEBHOOK_URL || "https://YOUR_SERVER_OR_TUNNEL_URL/api/webhook/email";

    try {
      // Read raw email bytes
      const rawEmail = new Response(message.raw);
      const arrayBuffer = await rawEmail.arrayBuffer();

      // Forward to your server
      const response = await fetch(WEBHOOK_URL, {
        method: "POST",
        headers: {
          "Content-Type": "message/rfc822",
          "X-Mail-From": message.from,
          "X-Mail-To": message.to,
          "X-Forwarded-By": "Cloudflare-Email-Worker"
        },
        body: arrayBuffer
      });

      if (!response.ok) {
        console.error(`Failed to forward email. Status: ${response.status}`);
      }
    } catch (err) {
      console.error(`Error forwarding email: ${err.message}`);
    }
  }
};

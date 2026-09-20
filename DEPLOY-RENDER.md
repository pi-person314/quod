# Render frontend + local backend

Render serves the website. Requests for documents, uploads, progress, and voice
travel through an authenticated ngrok tunnel to your computer. PostgreSQL,
Elasticsearch, PDFs, processing, and provider keys stay on your computer.

```
Browser → Render (HTTPS) → ngrok (HTTPS) → protected gateway :3005 → backend :3003
```

The gateway requires a shared secret and only exposes browser API routes.
Worker-only resolve/bake endpoints are excluded. The backend still checks each
user's Firebase identity and document ownership. No router port forwarding is needed.

## 1. Generate the shared secret privately

From PowerShell in the project folder:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Copy that value into your local `.env`:

```dotenv
QUOD_GATEWAY_SECRET=your_generated_64_character_value
```

Keep this value private. You will enter the same value in Render. Do not set
`QUOD_MODE=frontend` on your local backend.

## 2. Run the updated local backend and gateway

After the updated production build has been prepared, restart the existing
backend terminal with Ctrl+C followed by:

```powershell
node --env-file=.env apps/web/scripts/start-local.mjs
```

For a checkout without a prepared local build, run this first (it produces an
isolated build without reading any `.env` file):

```powershell
node apps/web/scripts/isolated-verification.mjs build
```

Keep Docker Desktop and the existing PostgreSQL/Elasticsearch containers running.
In a second terminal, from the project folder:

```powershell
node --env-file=.env apps/web/scripts/start-gateway.mjs
```

It should print `Quod protected gateway ready on 127.0.0.1:3005`.

## 3. Start ngrok

In a third terminal:

```powershell
ngrok http 3005 --url=https://wow-decorator-identical.ngrok-free.dev --inspect=false
```

Use **3005**, not 3003. Disabling request inspection avoids retaining users'
tokens and PDF contents in the local inspection UI. Copy the HTTPS forwarding
URL, for example `https://your-assigned-domain.ngrok-free.app`.

Your assigned URL is `https://wow-decorator-identical.ngrok-free.dev`.
Confirm ngrok's displayed forwarding address matches it, then use that exact
URL as `QUOD_BACKEND_URL` in Render.

Opening that URL directly should return **401**. This is expected: the gateway
only accepts requests authenticated by the hosted frontend.

## 4. Publish the code and create the Render service

The changes, including `render.yaml`, must be committed and pushed to the GitHub
branch Render will deploy. Review the files before committing; do not commit
`.env`, private PDFs, local databases, or session artifacts.

1. In Render, choose **New → Blueprint** and select the repository and branch.
2. Render reads `render.yaml` and creates a free Node web service named `quod`.
3. Enter these requested environment variables privately:

| Variable | Value |
| --- | --- |
| `QUOD_BACKEND_URL` | The HTTPS ngrok forwarding URL, with no path |
| `QUOD_GATEWAY_SECRET` | The same secret you generated locally |
| `NEXT_PUBLIC_FIREBASE_API_KEY` | Firebase web app's public API key |
| `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` | Existing Firebase auth domain, usually `PROJECT.firebaseapp.com` |
| `NEXT_PUBLIC_FIREBASE_PROJECT_ID` | Existing Firebase project ID |
| `NEXT_PUBLIC_FIREBASE_APP_ID` | Existing Firebase web app ID |

The Firebase values are in Firebase Console → Project settings → Your apps →
Web app configuration. They are public application configuration, distinct from
your OpenAI/Deepgram keys. Do **not** copy your entire `.env` to Render. Do not
set database/provider credentials there.

4. Apply the Blueprint and wait for its build and deployment.
5. Copy the assigned `https://quod-....onrender.com` URL. Render's built-in
   `RENDER_EXTERNAL_URL` supplies the trusted public origin automatically.
   If you later use a custom domain, set `QUOD_PUBLIC_ORIGIN` to that exact HTTPS
   origin (without a path), and use that address consistently.

## 5. Authorize the hosted hostname in Firebase

Firebase Console → Authentication → Settings → Authorized domains → Add domain.
Add the Render hostname without `https://` or any path. Leave the existing
Firebase auth domain and localhost entries in place.

## 6. Verify the deployment

Open the Render URL and:

1. Sign in with Google and confirm your existing document sets appear.
2. Open an existing PDF, switch pages, and open a reference card.
3. Upload a small PDF or standalone `.tex` file; confirm progress updates arrive.
4. Try voice if needed (this can incur the normal provider charges).
5. Stop only the gateway. The homepage should remain available and display the
   document-server-offline notice. Restart the gateway and confirm recovery.

The Render `/health` endpoint checks the hosted app itself. `/api/backend/status`
checks whether the local server is reachable; it does not check every provider.

## Keeping it running

Keep the computer powered, awake, connected to the internet, and all three
terminals plus Docker running. On Windows, lid-close behavior is separate from
the idle sleep timer: verify the plugged-in lid action is **Do nothing** if you
intend to close the laptop. Rebooting stops these processes; restart them afterward.

Render's free service can sleep after inactivity, so an initial visit may take
around a minute to wake it. ngrok's free plan has transfer/request limits; PDFs
and audio count toward them. This setup does not make your backend continuously
available when your computer or tunnel is offline.

If the ngrok URL changes, update `QUOD_BACKEND_URL` in Render. If you rotate the
shared secret, update both local `.env` and Render, then restart both local
processes and redeploy/restart Render.

References: [Render Blueprints](https://render.com/docs/blueprint-spec),
[Render free services](https://render.com/docs/free),
[ngrok free plan limits](https://ngrok.com/docs/pricing-limits/free-plan-limits).

# Project Loop · AI Builder Cup 2026 prototype

[Live prototype](https://project-loop-aibc26-eden.web.app/) · [2:42 demo video](https://project-loop-aibc26-eden.web.app/demo.mp4) · [Pitch deck](docs/project-loop-pitch.pdf)

Project Loop is a public-safe demonstration of the **Future of Work** idea behind Personal Dashboard: work continues on available home machines, important information is filtered against the person's projects, and agent results feed reviewed lessons into the next run. The real dashboard has an away report for scheduled jobs and CI; project-relevant news and finance research; a work profile with cited claims and user corrections; and a visible agent → PR → CI → log → suggestion → knowledge/rule loop.

The interactive public prototype implements **one slice** of that system. It turns dated team updates into Gemini-generated task suggestions. Each suggestion must cite an exact update ID, and a person must approve it before it becomes a task. The HomeLab, news, finance, profile, and agent-loop cards on the site explain the private system; they are synthetic illustrations, not connected public features.

This repository contains **synthetic examples only**. It has no diary, private notes, health records, identity information, financial data, local file scanning, shell execution, or access to the original Personal Dashboard service. Local jobs run only while their host is available; the public site does not claim uninterrupted execution.

## The working flow

1. Select one of three sample projects and inspect its dated updates.
2. Add a sample update in your own isolated browser session.
3. Run Gemini analysis. The server limits context to the selected project's most recent eight updates and validates every returned evidence ID.
4. Review the draft suggestions. Only the **Approve as task** action writes a task.
5. The approved task remains in that session's Firestore document with its evidence IDs. A later analysis includes approved tasks as human decisions so Gemini can avoid repeating them.

## Google Cloud architecture

```text
Browser → Firebase Hosting → Cloud Run (Node.js)
                              ├─ Vertex AI / Gemini (structured analysis)
                              └─ Firestore (isolated demo sessions)
```

Firebase Hosting serves the interface and routes API requests to Cloud Run. Cloud Run calls Gemini through Vertex AI using its service identity and stores only synthetic session data in Firestore. Firebase Hosting forwards only the `__session` cookie to Cloud Run; the random, HttpOnly, SameSite cookie keeps visitors' demo tasks separate. The browser never receives Google Cloud credentials. The model's JSON is treated as untrusted: the server checks lengths and rejects citations that are not present in the selected project's evidence.

## Local preview

Requires Node.js 22 or newer.

```bash
npm ci
DEMO_LOCAL=1 PORT=58823 npm start
```

Open `http://127.0.0.1:58823`. Local mode uses in-memory data and a clearly labelled deterministic AI simulation; it does **not** prove that Gemini or Firestore are available. Run `npm test` for evidence validation and approval checks.

## Cloud deployment

Use a dedicated Google Cloud/Firebase project with billing, Firestore Native mode, Vertex AI API, Cloud Run API, Cloud Build API, and Artifact Registry API enabled. Grant the Cloud Run service identity the minimum roles needed to call Vertex AI and read/write Firestore. No API key or service-account JSON should be committed.

```bash
gcloud run deploy project-loop-demo \
  --source . \
  --region asia-southeast1 \
  --project YOUR_PROJECT_ID \
  --allow-unauthenticated \
  --set-env-vars GOOGLE_CLOUD_PROJECT=YOUR_PROJECT_ID,GOOGLE_CLOUD_LOCATION=global,GEMINI_MODEL=gemini-2.5-flash

firebase deploy --only hosting --project YOUR_PROJECT_ID
```

The Firebase Hosting rewrite in `firebase.json` sends `/api/**` to the Cloud Run service in `asia-southeast1`. Check `/api/health`, add an update, run a live Gemini analysis, approve a task, refresh, and verify the task persists before using the public URL in a submission. Keep the prototype running through judging.

## Limits

This is a focused hackathon prototype, not a multi-tenant production service. A session can add at most 25 updates, approve at most 20 tasks, and request at most five Gemini analyses. Sessions are anonymous and use sample data; there is no account recovery. The deployment owner should set Cloud Run instance and budget limits and remove old Firestore demo sessions after evaluation.

# Deploying PharmaPulse for free

One container serves the API **and** the compiled interface on a single origin.
One URL to hand out, no CORS, and nothing to keep awake on a second service.

Everything the running app needs is under a megabyte — the forecast store is
945 KB and the built frontend is 300 KB — so this fits inside every free tier
listed here with room to spare.

```
docker build -t pharmapulse .
docker run -p 8000:8000 pharmapulse          # then open http://localhost:8000
```

**Test that locally first.** If the image runs on your machine it will run on
any of these hosts, and debugging a build on a free tier with a five-minute
feedback loop is miserable.

---

## Which host

| | Free? | Sleeps? | Card needed | Verdict |
|---|---|---|---|---|
| **Hugging Face Spaces** | yes | no | **no** | **Use this.** Docker-native, no card, stays warm |
| Render | yes | **after 15 min idle** | no | Fine as a backup; the cold start is ~50 s |
| Koyeb | yes, 1 service | no | yes | Works, but a card for a hackathon demo is friction |
| Fly.io | trial | no | yes | Free allowance is gone; skip |
| Railway | $5 credit | no | yes | Runs out; skip |

**Take the sleeping seriously.** On Render, a judge who opens your link cold
waits about fifty seconds looking at a blank page, and most people conclude it
is broken before it loads. Hugging Face does not do that.

---

## Hugging Face Spaces — the recommended path

**1. Make an account** at huggingface.co. No card, no billing step.

**2. Create a Space.** New → Space.

- Owner: you
- Space name: `pharmapulse`
- License: whatever you like
- **Space SDK: Docker** → **Blank**
- Hardware: **CPU basic (free)**
- Visibility: **Public** (a private Space cannot be opened by a judge without a login)

**3. Configure the Space.** In the Space, edit `README.md` so the very top of
the file is exactly this block, dashes included:

```
---
title: PharmaPulse
emoji: 💊
colorFrom: green
colorTo: gray
sdk: docker
app_port: 8000
---
```

`app_port: 8000` is the important line. Spaces route to 7860 by default; this
tells it to use the port our image actually listens on, so nothing in the
Dockerfile has to change.

**4. Nothing to move.** Spaces builds the `Dockerfile` at the repository root,
which is where ours lives. That is the only reason it is at the root rather
than under `infra/`.

**5. Push.** Spaces is a git remote:

```bash
git remote add space https://huggingface.co/spaces/<your-username>/pharmapulse
git push space main
```

**6. Watch the build.** The Logs tab shows it. Expect **8–12 minutes** — pip
installing prophet and cmdstanpy is most of it, and the nightly batch adds
about four minutes.

**7. Check it.** Open the Space URL, then confirm:

- `/` loads the Decisions screen
- `/api/health` returns JSON with `"forecast_store": "present"`
- The Evidence screen shows real numbers, not a degraded banner

---

## Render — the backup

1. render.com → New → **Web Service** → connect the GitHub repo.
2. Runtime **Docker**. Leave the Dockerfile path as the default `./Dockerfile`.
3. Instance type **Free**.
4. Leave the start command blank; the image already sets it, and Render
   supplies `$PORT` which the CMD honours.
5. Deploy, and expect the same 8–12 minutes.

Render's free tier sleeps after fifteen idle minutes. Before presenting, open
the URL a couple of minutes early so it is awake — and have a local instance
running as a fallback regardless.

---

## If the build fails

**The build times out.** The batch is the expensive part. Comment out the
`run_nightly` line in the Dockerfile and redeploy: the API falls back to
`contracts/fixtures/*.json` and labels itself degraded, so the interface still
works end to end. That is rung 5 of the degradation ladder, and it exists for
exactly this.

**`salesdaily.csv` not found.** `data/observed/salesdaily.csv` is committed, so
this only happens if the build context is wrong. Build from the repository
root — `docker build -t pharmapulse .` — not from inside a subdirectory.

**Blank page, but `/api/health` works.** The frontend built but did not mount.
Check the build log for the `web` stage, and that `web/dist/index.html` exists
in the image.

**The interface loads but every panel errors.** The frontend is calling the
wrong base URL. `VITE_API_BASE=/api` has to be set at **build** time — Vite
inlines it into the bundle, so setting it as a runtime environment variable
does nothing.

---

## Before you send the link

- [ ] Open it in a private window. If it asks for a login, the Space is private.
- [ ] `/api/health` says `"forecast_store": "present"`, not `"missing"`.
- [ ] Walk all seven screens once. Replay in particular — it holds server state.
- [ ] Run `python scripts/reset_demo.py` locally and redeploy if the demo board
      has drifted, so the Order screen opens on a real recommendation rather
      than "0 units".
- [ ] The repo is **private**. Either make it public or add the judges as
      collaborators, or the link in the deck goes nowhere.

---

## What is deliberately not deployed

No database server, no Redis, no scheduler. Analytical storage is Parquet read
by DuckDB — no port, no credentials. Operational storage is SQLite on the
container's own disk.

**That last part matters on a free tier: the disk is ephemeral.** Accepting an
order writes to SQLite, and a restart wipes it back to the seeded position.
For a demo that is a feature — every visitor gets a clean board. For anything
real it is the first thing to replace with a managed Postgres.

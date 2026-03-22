# roadmap.johnchrisley.dev

This roadmap now includes a small Node backend so the checklist can be stored on disk and synced across devices.

## Run locally

1. Open a terminal in `roadmap.johnchrisley.dev`
2. Run `cmd /c npm.cmd start`
3. Open `http://localhost:8787`

The same server handles:

- the static roadmap page
- `GET /api/health`
- `POST /api/state/load`
- `POST /api/state/save`

Saved checklist data is stored in `backend/data/` as JSON files.

## Cloud sync fields

- `API URL`: where the backend is running
- `Profile ID`: your personal sync profile name
- `Sync Key`: your private passphrase for that profile

If the profile does not exist yet, the first successful save creates it.

## Important deployment note

GitHub Pages cannot run this backend. If `roadmap.johnchrisley.dev` is still hosted as a static GitHub Pages site, you have two options:

1. Move the roadmap to a Node-capable host and serve both frontend and backend together
2. Keep the frontend on GitHub Pages and deploy only the backend somewhere else, then put that backend URL into the roadmap's `API URL` field

For real persistence in production, deploy the backend to a host with persistent disk storage.

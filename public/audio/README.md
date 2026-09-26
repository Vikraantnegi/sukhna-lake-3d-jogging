# Your own music (optional)

Drop audio files (mp3, ogg, m4a, wav, flac, opus) in this folder and they play,
shuffled, while you sit on a bench or the steps down to the water, instead of
the generated lo-fi loop.

- This folder is git-ignored (only this README is tracked), so tracks are never
  committed.
- The build deletes `dist/audio`, so tracks are never shipped. They play from
  the dev server (`npm run dev`), which lists this folder at `/audio/list.json`.
- Only use music you have the rights to play.

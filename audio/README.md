# Audio samples

Drop your audio files here, commit, push.

In the Cadence app, in the New / Edit Song modal, the "Audio" field can
either:

- accept a relative filename (e.g. `everlasting_love.ogg`) which is
  resolved against this folder, or
- accept a full URL to a file hosted anywhere public (Dropbox, S3,
  Cloudinary, …).

The 📁 button next to the field reads this folder via the GitHub API and
shows you the available files in a dropdown, so you don't need to type
the name by hand.

Supported file types: mp3, m4a, wav, ogg, opus, flac. Anything the
browser's `<audio>` element can play.

Tip: name files with a slug + extension, no spaces, e.g.
`everlasting-love.ogg`, `monte-argentario-demo.mp3`. The repo URL is
public, so don't put anything sensitive here.

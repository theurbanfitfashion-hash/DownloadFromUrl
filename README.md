# DownloadFromUrl

A lightweight, responsive, browser-only web app for opening or downloading files from direct HTTP(S) URLs. Supports links to common audio, image, video, and other file formats without sending the URL to an application server.

## Run locally

No build tools or dependencies are required. Open `index.html` in a modern browser, or serve the folder with any static web server, for example:

```bash
python -m http.server 8000
```

Then visit `http://localhost:8000`.

## Deploy with GitHub Pages

1. Create a repository named `DownloadFromUrl` on GitHub.
2. Upload `index.html`, `styles.css`, `app.js`, and this README to the repository root.
3. In **Settings → Pages**, choose **Deploy from a branch**, select `main` and `/ (root)`, then save.
4. Wait for the Pages deployment to finish. GitHub will show the published URL in **Settings → Pages**.

The included `.github/workflows/pages.yml` can alternatively deploy the static site using GitHub Actions after Pages is configured to use GitHub Actions.

## Important limitations

- This app works with direct, publicly accessible file URLs. It does not extract media from arbitrary webpages.
- A link may open in the browser rather than download, depending on the browser and server headers. The HTML `download` attribute is not guaranteed to work for cross-origin URLs.
- Authentication, hotlink protection, CORS rules, expiring links, and platform restrictions may prevent downloads.
- It does not bypass DRM, paywalls, sign-in requirements, or other access controls. Only download content you own or are authorized to save.
- No file is proxied through this site; URL handling stays in the browser. The page does not upload media to a server.

## Testing

The project has no runtime dependencies. Basic validation: verify the form rejects malformed URLs and non-HTTP(S) schemes, accepts valid HTTP(S) URLs, and constructs a link to the submitted URL. Browser and source-server policies still determine whether the file can be saved.

## License

MIT — see `LICENSE`.

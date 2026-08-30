# Deploying

The app is **entirely client-side**. `npm run build` emits a folder of static files —
`index.html`, one JS bundle, the solver's Web Worker as its own chunk, a stylesheet, and
`sample-timetable.xml`. Parsing, the branch-and-bound search, and the scoring all run in the
visitor's browser; there is no backend, no database, and no process to keep alive. Any host
that can serve files over HTTP can serve this, including a plain university `public_html`
directory.

One consequence worth stating plainly: **a timetable export never leaves the machine that
opened it.** The file is read with `FileReader` and solved in-page, so hosting the app at a
public URL publishes the app, not anybody's schedule.

## Build

```bash
npm ci
npm run build        # tsc --noEmit, then vite build → dist/
```

Node 22 or newer, on your own machine. Nothing needs Node on the server.

### Serving from a subdirectory

Vite bakes the deployment path into every asset URL in `dist/index.html`. The default is `/`,
which is right for `npm run dev` and for root-hosted deploys. Serving from a subdirectory
requires that subpath at **build** time — you cannot fix it by moving files afterwards:

```bash
APP_BASE=/~xlogin/scheduler/ npm run build
```

Leading and trailing slashes both matter; `APP_BASE` is joined onto asset names verbatim.
The same value flows through `import.meta.env.BASE_URL`, which is how the **Load sample**
button and the Web Worker find their files, so setting it once covers all three.

## Deploying to a faculty account (FI MU)

FI MU serves `~/public_html` on aisa as `https://www.fi.muni.cz/~login/`. See the faculty's
own documentation — [Uživatelské HTML stránky](https://www.fi.muni.cz/tech/unix/html-pages.html.cs)
and [Webová řešení](https://www.fi.muni.cz/tech/unix/web.html.cs) — which is authoritative for
the ACL syntax and any quota limits; the commands below are a working sketch, not a quotation.

1. **Build for the target path** (substitute your login):

   ```bash
   APP_BASE=/~xlogin/scheduler/ npm run build
   ```

2. **Copy the build.** Only `dist/`'s *contents* go across — not the folder itself, and none
   of the source tree:

   ```bash
   rsync -av --delete dist/ xlogin@aisa.fi.muni.cz:~/public_html/scheduler/
   ```

   `--delete` clears out the previous build's hashed assets, which otherwise accumulate.

3. **Grant Apache access.** The web server runs as `apachefi` and must be able to traverse
   into your home directory and read the files. FI recommends ACLs over `chmod`:

   ```bash
   setfacl -m u:apachefi:x ~                                  # traverse the home directory
   setfacl -R -m u:apachefi:rX ~/public_html/scheduler        # read the build
   setfacl -R -d -m u:apachefi:rX ~/public_html/scheduler     # and anything copied in later
   ```

   Permissions are the usual reason a correct build answers 403.

4. **Open it:** `https://www.fi.muni.cz/~xlogin/scheduler/`

Access logs for user pages live on aisa at `/var/log/httpd-user/<login>.log` and are kept for
about six months. To keep the page off the public web, the faculty documents `.htaccess`
password protection in [Řízení přístupu k uživatelským stránkám](https://www.fi.muni.cz/tech/unix/auth-html.html.cs).

Redeploying is steps 1–2 again. There is nothing to restart.

### What this deploy does *not* need

FI supports PHP and CGI (and documents Node.js under CGI) for pages that need server-side
work. This app needs none of it: no interpreter, no `.htaccess` rewrite rules — there is no
client-side router, so every URL the app uses is a real file on disk — and no long-running
process, which that hosting model does not offer anyway.

If the app ever grows a server-side solver, accounts, or stored schedules, this arrangement
stops being suitable and the choice of host has to be revisited.

## Other static hosts

GitHub Pages, Netlify, Cloudflare Pages, S3 + CloudFront: build and upload `dist/` the same
way. Use the default base when the site sits at a domain root; a GitHub Pages project site at
`https://user.github.io/scheduler/` needs `APP_BASE=/scheduler/`.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Blank page, 404s for `/assets/…` in the console | Built without `APP_BASE`, or with a value that doesn't match the real path |
| Page loads, **Load sample** fails | Same cause — the sample resolves against `BASE_URL` |
| "Solving…" never finishes | The worker chunk isn't reachable; check `dist/assets/solver.worker-*.js` was copied and is readable |
| 403 Forbidden | ACLs — step 3 above; the home directory needs `x` for `apachefi`, not just `public_html` |
| Stale UI after a redeploy | Hashed filenames make this rare; a hard reload clears a cached `index.html` |

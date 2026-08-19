# SoundDesigner release procedure

The panel checks the public GitHub repository `iboyshanto/SoundDesigner` for the latest stable GitHub Release. It accepts semantic tags such as `v1.2.3`, ignores drafts and prereleases, and prefers a release asset named `SoundDesigner-v1.2.3.zxp`.

## One-time setup

1. Create the public repository `https://github.com/iboyshanto/SoundDesigner` or change `UPDATE_REPOSITORY` in `src/js/main/updater.ts` before the first public build.
2. Run `bun run certificate:create` once and enter a strong password when prompted. This creates `.signing/SoundDesigner-publisher.p12` without printing or storing the password.
3. Securely back up the certificate and password. The `.signing` directory is ignored by Git; never commit or publish the certificate.
4. Test the signed package on macOS and Windows with the installer/distribution path you publish to users.
5. If Freesound is enabled in a commercial release, obtain the required API-use permission from Freesound and verify that the release UX preserves creator, source URL, and license metadata.

## Publish a stable update

1. Update `version` in `package.json` using semantic versioning, for example `1.2.3`.
2. Build and sign with the same publisher identity. The command automatically finds the local certificate and securely prompts for its password:

   ```sh
   bun run release:package
   ```

   CI may instead provide `SOUNDDESIGNER_ZXP_CERT` and `SOUNDDESIGNER_ZXP_PASSWORD` through secrets. The GitHub workflow expects `SOUNDDESIGNER_ZXP_CERT_BASE64` and `SOUNDDESIGNER_ZXP_PASSWORD`.

3. Install and smoke-test `release/SoundDesigner-v1.2.3.zxp` in supported Premiere Pro and After Effects versions on both operating systems.
   Include a saved-project Freesound download, unsupported local audio conversion, optional −1 dBFS normalization, Project-panel `SoundDesigner` organization, and a project-switch cache check.
4. Commit the source/version change and push it. Create the tag `v1.2.3` from that exact commit.
5. Create a non-draft, non-prerelease GitHub Release from the tag and upload:
   - `SoundDesigner-v1.2.3.zxp`
   - `SoundDesigner-v1.2.3.zxp.sha256`
6. Publish the release. Existing installations will discover it during their next automatic check (at most once per 24 hours), or immediately from Settings > Updates > Check now.

## Safety contract

- The running extension never downloads into its installation directory, executes a file, or silently replaces itself.
- Release and asset URLs must belong to the configured GitHub repository.
- A missing ZXP asset falls back to the GitHub Release page so installation guidance remains visible.
- GitHub errors, rate limits, offline hosts, malformed versions, and oversized responses fail gracefully; a previously verified cached result remains usable.
- The update check runs in panel JavaScript through CEP Node HTTPS. It does not cross `evalScript` and does not modify the ES3 ExtendScript host layer.

/**
 * Re-vendor DOMPurify into src/client/vendor/purify.min.js.
 *
 *   npm i -D dompurify@<version> && node scripts/vendor-dompurify.js
 *
 * There is no build step in this repo -- index.html loads plain <script> tags --
 * so the npm package cannot be consumed directly and its dist file is copied in
 * with a provenance header. This script exists so that copy is reproducible and
 * the header's version/sha256 can never drift from the file below it.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'node_modules', 'dompurify', 'dist', 'purify.min.js');
const OUT = path.join(ROOT, 'src', 'client', 'vendor', 'purify.min.js');

if (!fs.existsSync(SRC)) {
  console.error('dompurify is not installed. Run: npm i -D dompurify@<version>');
  process.exit(1);
}

const version = require(path.join(ROOT, 'node_modules', 'dompurify', 'package.json')).version;
const body = fs.readFileSync(SRC);
const sha = require('crypto').createHash('sha256').update(body).digest('hex');

const header =
`/*! DOMPurify v${version} -- VENDORED, DO NOT EDIT.
 * Source : node_modules/dompurify/dist/purify.min.js (npm dompurify@${version})
 * sha256 : ${sha}
 * Why vendored: this repo has no build step, so the browser loads plain
 * <script> tags and there is no bundler to pull an npm package in. Re-vendor
 * with:  npm i -D dompurify@<v> && node scripts/vendor-dompurify.js
 * Loaded as an UNMANAGED script in index.html, before the managed block,
 * because src/client/utils/index.js uses it at module scope.
 */
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, header + body);
console.log('vendored dompurify ' + version + ' -> src/client/vendor/purify.min.js');
console.log('sha256 ' + sha);

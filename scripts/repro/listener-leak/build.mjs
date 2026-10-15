import { build } from "esbuild"; // npx -y tsx installs it; or npm i -D esbuild
const SRC = process.argv[2];
await build({ entryPoints: ["harness.tsx"], bundle: true, outfile: "out.js", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' }, nodePaths: [SRC + "/node_modules"],
  plugins: [{ name: "a", setup(b) {
    b.onResolve({ filter: /^@\/lib\/(mock-data|storage-sync-interceptor)$/ }, () => ({ path: "stub", namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export const updatePatientRecordById=()=>({}); export const forceSyncNow=async()=>{};", loader: "js" }));
    b.onResolve({ filter: /^@\// }, (a) => b.resolve("./" + a.path.slice(2), { resolveDir: SRC + "/src", kind: a.kind }));
  } }] });

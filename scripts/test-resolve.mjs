// Lets plain node run the server tests: maps "@/..." to src/ and finds .ts files for
// extensionless imports, the way Next's bundler does. Used with --import, for example:
//   node --no-warnings --import ./scripts/test-resolve.mjs src/server/auth.test.ts
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";

const SRC = new URL("../src/", import.meta.url);

registerHooks({
  resolve(specifier, context, next) {
    // next has no "exports" map, so ESM needs the file name
    if (specifier === "next/server") return next("next/server.js", context);
    let spec = specifier.startsWith("@/") ? new URL(specifier.slice(2), SRC).href : specifier;
    if ((spec.startsWith(".") || spec.startsWith("file:")) && !/\.(?:[cm]?js|ts|json)$/.test(spec)) {
      const base = new URL(spec, context.parentURL).href;
      const found = [".ts", "/index.ts"].map((ext) => base + ext).find((u) => existsSync(new URL(u)));
      if (found) spec = found;
    }
    return next(spec, context);
  },
});

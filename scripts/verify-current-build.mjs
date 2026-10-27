import { assertCurrentBuild } from './lib/build-identity.mjs';

const { __meta } = assertCurrentBuild();
console.log(`Current theme build verified: ${__meta.version} / ${__meta.revision}`);

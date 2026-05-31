// amazon-connect-streams ships no bundled TypeScript types and has no @types
// package. useConnectCcp.ts declares a narrow local interface for the bits of the
// `connect` global it actually calls; this ambient module declaration just lets
// the dynamic `import('amazon-connect-streams')` resolve under tsc. Typed as
// `any` deliberately — the real surface is the local shim in useConnectCcp.ts.
declare module 'amazon-connect-streams';

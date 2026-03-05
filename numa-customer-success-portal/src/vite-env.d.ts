/// <reference types="vite/client" />
/// <reference types="vite-plugin-svgr/client" />

interface ImportMetaEnv {
  readonly VITE_AWS_REGION: string;
  readonly VITE_USER_POOL_ID: string;
  readonly VITE_USER_POOL_CLIENT_ID: string;
  readonly VITE_IDENTITY_POOL_ID: string;
  readonly VITE_ECR_REPOSITORY_URI: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

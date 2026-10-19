interface ImportMetaEnv {
  readonly PUBLIC_API_ORIGIN: string;
  readonly PUBLIC_COLLAB_ORIGIN: string;
  readonly PUBLIC_SITE_ORIGIN: string;
  readonly PUBLIC_STORAGE_ORIGIN: string;
  readonly PUBLIC_SENTRY_DSN?: string;
  readonly PUBLIC_TEST_HOOKS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

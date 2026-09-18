/// <reference types="vite/client" />
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}

interface GoogleCredentialResponse {
  credential: string;
}
interface Window {
  google?: {
    accounts: {
      id: {
        initialize(opts: { client_id: string; callback: (r: GoogleCredentialResponse) => void }): void;
        renderButton(el: HTMLElement, opts: Record<string, string | number>): void;
      };
    };
  };
}

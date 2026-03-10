import type { JournalAppApi } from "../../shared/api";

declare global {
  interface Window {
    journalApp?: JournalAppApi;
  }
}

export {};

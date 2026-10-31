import { initializeEpicIntegration } from "../epic";

let initialization: Promise<void> | undefined;

// Both upstream startup paths call this. Share cleanup/initialization rather than race it.
export const initializeOptionalEpic = () => {
  initialization ??= initializeEpicIntegration();
  return initialization;
};

import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

const safeGetAppRoot = (): string => {
  if (app.isPackaged) {
    return process.resourcesPath;
  }
  return process.cwd();
};

export const resolveRuntimePath = (...segments: string[]): string =>
  path.join(safeGetAppRoot(), ...segments);

export const resolvePackagedResourcePath = (...segments: string[]): string =>
  path.join(process.resourcesPath, ...segments);

export const resolveDevPath = (...segments: string[]): string =>
  path.join(process.cwd(), ...segments);

export const resolveProjectPath = (...segments: string[]): string =>
  path.join(process.cwd(), ...segments);

export const firstExistingPath = (candidates: string[]): string | null =>
  candidates.find((candidate: string) => fs.existsSync(candidate)) ?? null;
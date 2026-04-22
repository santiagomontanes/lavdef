import type { SessionUser } from '../../shared/types.js';

let currentSessionUser: SessionUser | null = null;

export const setCurrentSessionUser = (user: SessionUser | null) => {
  currentSessionUser = user
    ? {
        ...user
      }
    : null;
};

export const getCurrentSessionUser = (): SessionUser | null =>
  currentSessionUser
    ? {
        ...currentSessionUser
      }
    : null;

export const getCurrentSessionUserId = (): number | null => currentSessionUser?.id ?? null;
export const getCurrentSessionUserRoleId = (): number | null => currentSessionUser?.roleId ?? null;

export const getCurrentSessionUserName = (): string | null =>
  currentSessionUser?.displayName ?? currentSessionUser?.username ?? null;

export const clearCurrentSessionUser = () => {
  currentSessionUser = null;
};

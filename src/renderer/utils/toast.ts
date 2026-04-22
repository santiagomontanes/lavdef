type ToastType = 'success' | 'error' | 'info';

const palette: Record<ToastType, { bg: string; border: string }> = {
  success: { bg: '#ecfdf3', border: '#16a34a' },
  error: { bg: '#fef2f2', border: '#dc2626' },
  info: { bg: '#eff6ff', border: '#2563eb' }
};

export const showToast = (
  message: string,
  type: ToastType = 'info',
  timeoutMs = 3200
) => {
  if (typeof document === 'undefined') return;

  let container = document.getElementById('app-toast-root');
  if (!container) {
    container = document.createElement('div');
    container.id = 'app-toast-root';
    container.style.position = 'fixed';
    container.style.top = '12px';
    container.style.right = '12px';
    container.style.zIndex = '99999';
    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.gap = '8px';
    container.style.maxWidth = 'min(90vw, 420px)';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  const colors = palette[type];
  toast.textContent = message;
  toast.style.background = colors.bg;
  toast.style.border = `1px solid ${colors.border}`;
  toast.style.borderLeft = `5px solid ${colors.border}`;
  toast.style.color = '#111827';
  toast.style.borderRadius = '10px';
  toast.style.padding = '10px 12px';
  toast.style.fontSize = '13px';
  toast.style.boxShadow = '0 8px 20px rgba(0,0,0,0.12)';
  toast.style.opacity = '0';
  toast.style.transform = 'translateY(-6px)';
  toast.style.transition = 'opacity 140ms ease, transform 140ms ease';
  container.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
  });

  window.setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-6px)';
    window.setTimeout(() => toast.remove(), 180);
  }, Math.max(1200, timeoutMs));
};

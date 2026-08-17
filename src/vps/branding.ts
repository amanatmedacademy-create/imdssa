export const CONTROL_CENTER_BRAND = {
  product: 'IMDS',
  name: 'Control Center',
  fullName: 'IMDS Control Center',
} as const;

export function installControlCenterBranding(root: HTMLElement) {
  const apply = () => {
    root.querySelectorAll<HTMLElement>('.vps-brand span').forEach((element) => {
      if (element.textContent?.trim() === 'Super Admin') {
        element.textContent = CONTROL_CENTER_BRAND.name;
      }
    });
    document.title = CONTROL_CENTER_BRAND.fullName;
  };

  apply();
  const observer = new MutationObserver(apply);
  observer.observe(root, { childList: true, subtree: true });
  return () => observer.disconnect();
}

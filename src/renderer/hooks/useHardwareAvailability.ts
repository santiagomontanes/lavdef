const HARDWARE_UNSUPPORTED_MESSAGE =
  'Esta funcionalidad requiere hardware (impresora, lector QR, cajón de dinero) que solo está disponible en Windows. En macOS no podrás usar estas funciones. El resto de la aplicación funciona con normalidad.';

export const useHardwareAvailability = () => {
  const platform = window.desktopApi.getPlatform();
  const isHardwareSupported = platform === 'win32';

  return {
    isHardwareSupported,
    message: isHardwareSupported ? '' : HARDWARE_UNSUPPORTED_MESSAGE
  };
};

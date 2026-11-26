#!/bin/bash
# postrm del .deb (plantilla propia, ver deb.afterRemove en electron-builder.yml).
# A diferencia de la de electron-builder 26, solo limpia al desinstalar de verdad:
# dpkg también ejecuta el postrm de la versión vieja al actualizar ("upgrade"), y la
# plantilla original borraba ahí el perfil de AppArmor sin el cual la app no arranca
# en Ubuntu 24.04+.
#
# OJO: electron-builder reemplaza todo lo que tenga la forma dólar-llave-nombre-llave por sus macros
# y falla si no la conoce: en el bash de este archivo usar $VAR, nunca con llaves.

case "$1" in
  remove|purge|abort-install|"")
    # Delete the link to the binary
    # update-alternatives --remove <name> <path>: 'path' must be the registered alternative binary,
    # not the generic symlink — see https://man7.org/linux/man-pages/man1/update-alternatives.1.html
    if type update-alternatives >/dev/null 2>&1; then
        update-alternatives --remove '${executable}' '/opt/${sanitizedProductName}/${executable}'
    else
        rm -f '/usr/bin/${executable}'
    fi

    APPARMOR_PROFILE_DEST='/etc/apparmor.d/${executable}'

    # Descargar el perfil del kernel antes de borrar el archivo, para que no siga
    # aplicándose hasta el próximo reinicio (salvo dentro de un chroot).
    if [ -f "$APPARMOR_PROFILE_DEST" ]; then
      if apparmor_status --enabled > /dev/null 2>&1; then
        if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
          apparmor_parser --remove "$APPARMOR_PROFILE_DEST" || true
        fi
      fi
      rm -f "$APPARMOR_PROFILE_DEST"
    fi
    ;;
  *)
    # upgrade, failed-upgrade, abort-upgrade, disappear: no tocar nada; el postinst
    # de la versión nueva vuelve a dejar el enlace, el perfil y el sandbox.
    ;;
esac

exit 0

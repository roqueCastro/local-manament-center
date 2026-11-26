#!/bin/bash
# postinst del .deb (plantilla propia, ver deb.afterInstall en electron-builder.yml).
# Basado en la de electron-builder 26, con un cambio en el sandbox de Chromium:
# en Ubuntu 24.04+ (kernel.apparmor_restrict_unprivileged_userns=1) la prueba
# "unshare --user true" pasa igual, así que la plantilla original deja chrome-sandbox
# sin SUID y todo depende del perfil de AppArmor. Si ese perfil falta, la app aborta
# al arrancar ("The SUID sandbox helper binary was found, but is not configured
# correctly"). Aquí, con esa restricción activa, chrome-sandbox queda además con SUID
# como respaldo, igual que hace el .deb de Google Chrome.
#
# OJO: electron-builder reemplaza todo lo que tenga la forma dólar-llave-nombre-llave por sus macros
# (executable, sanitizedProductName...) y falla si no la conoce: en el bash de este
# archivo usar $VAR, nunca con llaves.

APP_DIR='/opt/${sanitizedProductName}'
APP_BIN="$APP_DIR/${executable}"
SANDBOX="$APP_DIR/chrome-sandbox"

if type update-alternatives >/dev/null 2>&1; then
    # Remove previous link if it doesn't use update-alternatives
    if [ -L '/usr/bin/${executable}' -a -e '/usr/bin/${executable}' -a "`readlink '/usr/bin/${executable}'`" != '/etc/alternatives/${executable}' ]; then
        rm -f '/usr/bin/${executable}'
    fi
    update-alternatives --install '/usr/bin/${executable}' '${executable}' "$APP_BIN" 100 || ln -sf "$APP_BIN" '/usr/bin/${executable}'
else
    ln -sf "$APP_BIN" '/usr/bin/${executable}'
fi

if hash update-mime-database 2>/dev/null; then
    update-mime-database /usr/share/mime || true
fi

if hash update-desktop-database 2>/dev/null; then
    update-desktop-database /usr/share/applications || true
fi

# Perfil de AppArmor (Ubuntu 24+): permite al sandbox usar user namespaces.
# Solo se instala si la versión de AppArmor entiende el perfil (abi/4.0); en
# Ubuntu 22.04 no hace falta.
if apparmor_status --enabled > /dev/null 2>&1; then
  APPARMOR_PROFILE_SOURCE="$APP_DIR/resources/apparmor-profile"
  APPARMOR_PROFILE_TARGET='/etc/apparmor.d/${executable}'
  if apparmor_parser --skip-kernel-load --debug "$APPARMOR_PROFILE_SOURCE" > /dev/null 2>&1; then
    cp -f "$APPARMOR_PROFILE_SOURCE" "$APPARMOR_PROFILE_TARGET"

    # Dentro de un chroot (armado de imágenes) no tiene sentido cargarlo en el kernel.
    if ! { [ -x '/usr/bin/ischroot' ] && /usr/bin/ischroot; } && hash apparmor_parser 2>/dev/null; then
      apparmor_parser --replace --write-cache --skip-read-cache "$APPARMOR_PROFILE_TARGET" ||
        echo "No se pudo cargar el perfil de AppArmor; se usará chrome-sandbox con SUID"
    fi
  else
    echo "Skipping the installation of the AppArmor profile as this version of AppArmor does not seem to support the bundled profile"
  fi
fi

# Sandbox de Chromium:
#   - sin user namespaces                          → chrome-sandbox con SUID
#   - con user namespaces restringidos (Ubuntu 24+) → SUID como respaldo del perfil
#   - con user namespaces libres                   → sin SUID (no hace falta)
# Con SUID puesto, Chromium igual prefiere los namespaces si el perfil los permite.
USERNS_RESTRICTED=0
if [ "`cat /proc/sys/kernel/apparmor_restrict_unprivileged_userns 2>/dev/null`" = "1" ]; then
    USERNS_RESTRICTED=1
fi

if ! { [[ -L /proc/self/ns/user ]] && unshare --user true; } || [ "$USERNS_RESTRICTED" = "1" ]; then
    chown root:root "$SANDBOX" || true
    chmod 4755 "$SANDBOX" || true
else
    chmod 0755 "$SANDBOX" || true
fi

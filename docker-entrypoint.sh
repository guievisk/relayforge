#!/bin/sh
# Se receber argumentos (ex: release_command do Fly), executa esses args.
# Sem argumentos, inicia o server normalmente.
set -e

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

echo "Starting RelayForge..."
exec node dist/server.js

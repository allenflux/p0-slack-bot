#!/bin/sh
set -eu

if [ -f "${BACKEND_ROOT:-/backend}/src/routers/workflow.py" ]; then
  echo "Found backend workflow.py, syncing API catalog..."
  npm run sync:apis
else
  echo "Backend workflow.py not found, using committed data/apiCatalog.json"
fi

npm start

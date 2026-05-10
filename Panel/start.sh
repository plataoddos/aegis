#!/bin/bash
cd "$(dirname "$0")"
./node_modules/.bin/vite --config "Figma Web Panel Config.ts" --port 5173

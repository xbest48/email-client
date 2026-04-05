cd nest-backend
npx kill-port 3300 > /dev/null 2>&1 || true
npm run build
npm run start > ../nest_output.log 2>&1 &

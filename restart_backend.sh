cd nest-backend
kill $(lsof -t -i :3300) 2> /dev/null || true
npm run build
npm run start > ../nest_output.log 2>&1 &

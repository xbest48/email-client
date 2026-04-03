const fs = require('fs');
const data = fs.readFileSync('src/app/services/auth.service.ts', 'utf8');
const lines = data.split('\n');

lines.forEach((line, i) => {
    if (line.includes('localStorage.getItem')) {
        console.log(`Found getItem on line ${i+1}: ${line}`);
    }
});

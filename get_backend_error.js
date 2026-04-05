const { exec } = require('child_process');

exec('curl -v http://localhost:3300/api/auth/profile', (err, stdout, stderr) => {
    console.log(stderr);
    console.log(stdout);
});

module.exports = {
  apps: [
    {
      name: 'kyma-mail-backend',
      cwd: '/home/applications/kymamail/backend/current',
      script: 'dist/main.js',
      interpreter: 'node',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      time: true,
      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },
    },
  ],
};

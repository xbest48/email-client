const fs = require('fs');
const file = 'src/app/components/email-detail/email-detail.component.ts';
let content = fs.readFileSync(file, 'utf8');

// In main, showReply is computed based on replyMode(). So instead of this.showReply.set(true), we do this.replyMode.set('reply');
content = content.replace("this.showReply.set(true);", "this.replyMode.set('reply');");
fs.writeFileSync(file, content);

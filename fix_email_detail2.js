const fs = require('fs');
const file = 'src/app/components/email-detail/email-detail.component.ts';
let content = fs.readFileSync(file, 'utf8');

// It looks like `} \n \n private buildReplyAllRecipients` wasn't fully replaced because the regex was too strict.
content = content.replace("  }\n\n}\n\n  private buildReplyAllRecipients", "  }\n\n  private buildReplyAllRecipients");
content = content.replace("<<<<<<< HEAD\n", "");
content = content.replace("=======\n", "");
content = content.replace(">>>>>>> origin/main\n", "");

fs.writeFileSync(file, content);

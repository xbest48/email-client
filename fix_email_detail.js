const fs = require('fs');
const file = 'src/app/components/email-detail/email-detail.component.ts';
let content = fs.readFileSync(file, 'utf8');

// The conflict in email-detail.component.ts is because HEAD adds AI methods at the end,
// and main adds reply-all features at the end.
// We can just keep both by removing the markers and adjusting the closing brace.

content = content.replace("<<<<<<< HEAD", "");
content = content.replace("=======", "");
content = content.replace(">>>>>>> origin/main", "");

// Now there might be an extra `}` from the `<<<<<<< HEAD` part or `=======` part.
// The `<<<<<<< HEAD` ended with:
//     if (type === 'translation') this.aiTranslation.set(null);
//   }
//
// }
// =======
// This means there's an extra `}` right before `=======`.
content = content.replace("  }\n\n}\n  private buildReplyAllRecipients", "  }\n\n  private buildReplyAllRecipients");

fs.writeFileSync(file, content);
console.log('Fixed email-detail.component.ts conflict');

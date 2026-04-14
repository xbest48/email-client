const fs = require('fs');
const file = 'src/app/components/email-list/email-list.component.html';
let content = fs.readFileSync(file, 'utf8');

// Resolution 1
const search1 = `<<<<<<< HEAD
          <div class="hidden sm:block w-36 shrink-0 truncate" [class.font-semibold]="!email.isRead">
            @if (isSentFolder()) {
              <span class="text-sm text-gray-800 dark:text-gray-200">{{ email.to[0]?.name || email.to[0]?.email || '(sans destinataire)' }}</span>
            } @else {
              <span class="text-sm text-gray-800 dark:text-gray-200">{{ email.from.name || email.from.email }}</span>
=======`;
const replacement1 = `          <div class="hidden sm:flex w-36 shrink-0 min-w-0 flex-col gap-0.5" [class.font-semibold]="!email.isRead">
            @if (labelsFor(email); as emailLabels) {
              @if (emailLabels.length > 0) {
                <div class="flex items-center gap-1 flex-wrap">
                  @for (label of emailLabels; track label.id) {
                    <span class="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium max-w-full"
                          [style.background-color]="label.color + '22'"
                          [style.color]="label.color"
                          [title]="label.name">
                      <span class="w-1.5 h-1.5 rounded-full shrink-0" [style.background-color]="label.color" aria-hidden="true"></span>
                      <span class="truncate">{{ label.name }}</span>
                    </span>
                  }
                </div>
              }
            }
            <div class="truncate">
              @if (isSentFolder()) {
                <span class="text-sm text-gray-800 dark:text-gray-200">{{ recipientLabel(email) }}</span>
              } @else {
                <span class="text-sm text-gray-800 dark:text-gray-200">{{ email.from.name || email.from.email }}</span>
              }
            </div>
          </div>`;

// Replace from search1 to origin/main manually
content = content.replace(/<<<<<<< HEAD[\s\S]*?=======/, "");
content = content.replace(">>>>>>> origin/main", "");

// Actually, wait, let's just do a targeted regex replace for both conflicts
content = content.replace(/<<<<<<< HEAD\n\s*<div class="hidden sm:block[\s\S]*?=======\n/g, "");
content = content.replace(/<<<<<<< HEAD\n\s*<span class="text-sm text-gray-800 dark:text-gray-200">\{\{ email\.to\[0\]\?\.name[\s\S]*?=======\n/g, "");
content = content.replace(/>>>>>>> origin\/main\n/g, "");

fs.writeFileSync(file, content);
console.log('Fixed email list html conflict');

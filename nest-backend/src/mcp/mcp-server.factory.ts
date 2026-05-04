import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ImapService, EmailCredentials } from '../email/imap/imap.service';
import { SmtpService, type SendEmailDto } from '../email/smtp/smtp.service';
import { AccountsService } from '../accounts/accounts.service';
import { LabelsService } from '../labels/labels.service';

export interface McpToolContext {
  userId: string;
  accountId: string;
}

export interface McpDeps {
  imap: ImapService;
  smtp: SmtpService;
  accounts: AccountsService;
  labels: LabelsService;
}

const SERVER_INFO = {
  name: 'email-client-mcp',
  version: '0.1.0',
};

const SERVER_INSTRUCTIONS = [
  "Outils pour interroger et agir sur la boîte mail de l'utilisateur authentifié",
  "(IMAP/SMTP). Toutes les opérations sont scopées au compte email dont l'identifiant",
  "est fourni par le contexte de la session MCP.",
  '',
  "PIÈCES JOINTES — `send_email` et `create_draft` acceptent un champ `attachments`",
  "(tableau, max 20 éléments, 25 Mo au total). Chaque entrée doit contenir :",
  "  • `filename` (string) : nom du fichier visible par le destinataire",
  "  • `content` (string) : contenu binaire encodé en base64 standard",
  "  • `contentType` (string) : type MIME (ex: 'application/pdf', 'image/png')",
  "  • `cid` (string, optionnel) : pour incorporer une image dans le HTML via",
  "    <img src=\"cid:NOM\">",
  "Si l'utilisateur a partagé un fichier dans la conversation, encode son contenu",
  "en base64 et place-le dans le champ `content` — n'invente jamais de contenu.",
].join('\n');

const ok = (data: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
});

const fail = (message: string) => ({
  isError: true,
  content: [{ type: 'text' as const, text: message }],
});

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // mirrors SMTP/HTTP limit
const MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024;

const attachmentSchema = z.object({
  filename: z.string().min(1).max(255),
  content: z
    .string()
    .min(1)
    .describe('Contenu du fichier encodé en base64 (sans préfixe data:).'),
  contentType: z.string().min(1).default('application/octet-stream'),
  cid: z
    .string()
    .optional()
    .describe(
      "Content-ID pour incorporer l'image en HTML via <img src=\"cid:...\">. " +
        'Laissez vide pour une pièce jointe classique.',
    ),
});

type AttachmentInput = z.infer<typeof attachmentSchema>;

function decodeAttachments(
  inputs: AttachmentInput[] | undefined,
): { filename: string; content: Buffer; contentType: string; cid?: string }[] | undefined {
  if (!inputs || inputs.length === 0) return undefined;
  let total = 0;
  return inputs.map((a) => {
    // tolerate accidental data-URI prefix
    const raw = a.content.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/=_-]+$/.test(raw)) {
      throw new Error(`Pièce jointe « ${a.filename} » : contenu base64 invalide.`);
    }
    const buf = Buffer.from(raw, 'base64');
    if (buf.length === 0) {
      throw new Error(`Pièce jointe « ${a.filename} » : contenu vide.`);
    }
    if (buf.length > MAX_ATTACHMENT_BYTES) {
      throw new Error(
        `Pièce jointe « ${a.filename} » trop volumineuse (max ${MAX_ATTACHMENT_BYTES / 1024 / 1024} Mo).`,
      );
    }
    total += buf.length;
    if (total > MAX_TOTAL_ATTACHMENT_BYTES) {
      throw new Error(
        `Total des pièces jointes trop volumineux (max ${MAX_TOTAL_ATTACHMENT_BYTES / 1024 / 1024} Mo).`,
      );
    }
    return { filename: a.filename, content: buf, contentType: a.contentType, cid: a.cid };
  });
}

export async function resolveCredentials(
  deps: McpDeps,
  ctx: McpToolContext,
): Promise<EmailCredentials> {
  const account = await deps.accounts.findOneWithPassword(ctx.accountId, ctx.userId);
  if (!account) {
    throw new Error(`Compte email introuvable pour cet utilisateur (id=${ctx.accountId})`);
  }
  return {
    email: account.email,
    password: account.password,
    imapHost: account.imapHost,
    imapPort: account.imapPort,
    smtpHost: account.smtpHost,
    smtpPort: account.smtpPort,
  };
}

export function createMcpServer(deps: McpDeps, ctx: McpToolContext): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions: SERVER_INSTRUCTIONS });

  const withCreds = async <T,>(fn: (creds: EmailCredentials) => Promise<T>) => {
    const creds = await resolveCredentials(deps, ctx);
    return fn(creds);
  };

  server.registerTool(
    'list_folders',
    {
      title: 'Lister les dossiers IMAP',
      description: 'Retourne la liste des dossiers (Inbox, Sent, Trash, etc.) du compte.',
      inputSchema: {},
    },
    async () => {
      try {
        const folders = await withCreds((c) => deps.imap.listFolders(c));
        return ok(folders);
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    'list_emails',
    {
      title: 'Lister les emails',
      description:
        "Retourne une page d'emails (envelope only) d'un dossier. Utiliser le path retourné par list_folders.",
      inputSchema: {
        folder: z.string().describe('Chemin du dossier IMAP (ex: "INBOX")'),
        page: z.number().int().positive().default(1),
        pageSize: z.number().int().min(1).max(100).default(25),
      },
    },
    async ({ folder, page, pageSize }) => {
      try {
        const res = await withCreds((c) => deps.imap.fetchEmails(c, folder, page, pageSize));
        return ok(res);
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    'search_emails',
    {
      title: 'Rechercher des emails',
      description:
        'Recherche IMAP plein texte dans un dossier. Le moteur dépend du serveur IMAP.',
      inputSchema: {
        folder: z.string(),
        query: z.string().min(1),
      },
    },
    async ({ folder, query }) => {
      try {
        const res = await withCreds((c) => deps.imap.searchEmails(c, folder, query));
        return ok(res);
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    'read_email',
    {
      title: 'Lire un email',
      description: "Récupère le contenu complet d'un email par son UID.",
      inputSchema: {
        folder: z.string(),
        uid: z.number().int().positive(),
      },
    },
    async ({ folder, uid }) => {
      try {
        const res = await withCreds((c) => deps.imap.fetchEmail(c, folder, uid));
        return ok(res);
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    'get_thread',
    {
      title: 'Récupérer un thread',
      description: "Reconstitue le fil de conversation auquel l'email appartient.",
      inputSchema: {
        folder: z.string(),
        uid: z.number().int().positive(),
      },
    },
    async ({ folder, uid }) => {
      try {
        const res = await withCreds((c) => deps.imap.fetchThread(c, folder, uid));
        return ok(res);
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    'send_email',
    {
      title: 'Envoyer un email',
      description:
        'Envoie un email via SMTP et le copie dans le dossier Sent. ' +
        'Les pièces jointes doivent être encodées en base64.',
      inputSchema: {
        to: z.union([z.string(), z.array(z.string())]),
        cc: z.union([z.string(), z.array(z.string())]).optional(),
        bcc: z.union([z.string(), z.array(z.string())]).optional(),
        subject: z.string(),
        text: z.string().optional(),
        html: z.string().optional(),
        inReplyTo: z.string().optional(),
        references: z.union([z.string(), z.array(z.string())]).optional(),
        requestReadReceipt: z.boolean().optional(),
        attachments: z
          .array(attachmentSchema)
          .max(20)
          .optional()
          .describe(
            "Pièces jointes (jusqu'à 20, 25 Mo total). Chaque entrée : { filename, " +
              "content (base64 du binaire), contentType, cid? }. Pour joindre un " +
              "fichier partagé par l'utilisateur, encode son contenu en base64 et " +
              "renseigne `content` — n'invente jamais de contenu fictif.",
          ),
      },
    },
    async (args) => {
      try {
        const { attachments, ...rest } = args;
        const decoded = decodeAttachments(attachments);
        const result = await withCreds(async (c) => {
          const dto: SendEmailDto = { ...rest, attachments: decoded };
          const sent = await deps.smtp.sendEmail(c, dto);
          if (sent.rawMessage) {
            try {
              await deps.imap.appendToSentFolder(c, sent.rawMessage);
            } catch {
              // non-bloquant
            }
          }
          return {
            messageId: sent.messageId,
            accepted: sent.accepted,
            rejected: sent.rejected,
          };
        });
        return ok(result);
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    'create_draft',
    {
      title: 'Créer un brouillon',
      description:
        'Construit un email et le sauvegarde dans le dossier Drafts. ' +
        'Les pièces jointes doivent être encodées en base64.',
      inputSchema: {
        to: z.union([z.string(), z.array(z.string())]),
        cc: z.union([z.string(), z.array(z.string())]).optional(),
        bcc: z.union([z.string(), z.array(z.string())]).optional(),
        subject: z.string(),
        text: z.string().optional(),
        html: z.string().optional(),
        inReplyTo: z.string().optional(),
        references: z.union([z.string(), z.array(z.string())]).optional(),
        previousFolder: z.string().optional(),
        previousUid: z.number().int().positive().optional(),
        attachments: z
          .array(attachmentSchema)
          .max(20)
          .optional()
          .describe(
            "Pièces jointes (jusqu'à 20, 25 Mo total). Chaque entrée : { filename, " +
              "content (base64 du binaire), contentType, cid? }. Pour joindre un " +
              "fichier partagé par l'utilisateur, encode son contenu en base64 et " +
              "renseigne `content` — n'invente jamais de contenu fictif.",
          ),
      },
    },
    async (args) => {
      try {
        const { previousFolder, previousUid, attachments, ...rest } = args;
        const decoded = decodeAttachments(attachments);
        const result = await withCreds(async (c) => {
          const dto: SendEmailDto = { ...rest, attachments: decoded };
          const raw = await deps.smtp.buildRawMessage(c, dto);
          if (!raw) throw new Error("Échec de la construction du brouillon");
          return deps.imap.appendToDraftsFolder(c, raw, previousFolder, previousUid);
        });
        return ok(result);
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    'set_flag',
    {
      title: 'Marquer / démarquer un email',
      description:
        'Ajoute ou retire un flag IMAP (ex: \\Seen pour lu/non-lu, \\Flagged pour étoilé).',
      inputSchema: {
        folder: z.string(),
        uid: z.number().int().positive(),
        flag: z.string().describe('Nom du flag IMAP, ex: "\\\\Seen" ou "\\\\Flagged"'),
        value: z.boolean(),
      },
    },
    async ({ folder, uid, flag, value }) => {
      try {
        await withCreds((c) => deps.imap.setFlag(c, folder, uid, flag, value));
        return ok({ success: true });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    'move_email',
    {
      title: "Déplacer un email vers un dossier",
      description: "Déplace un email d'un dossier IMAP vers un autre.",
      inputSchema: {
        fromFolder: z.string(),
        uid: z.number().int().positive(),
        toFolder: z.string(),
      },
    },
    async ({ fromFolder, uid, toFolder }) => {
      try {
        await withCreds((c) => deps.imap.moveEmail(c, fromFolder, uid, toFolder));
        return ok({ success: true });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    'trash_email',
    {
      title: 'Mettre un email à la corbeille',
      description:
        "Déplace un email vers le dossier corbeille (ou supprime définitivement si déjà dans la corbeille).",
      inputSchema: {
        folder: z.string(),
        uid: z.number().int().positive(),
        trashFolder: z
          .string()
          .optional()
          .describe('Chemin du dossier corbeille à utiliser. Auto-détecté si omis.'),
      },
    },
    async ({ folder, uid, trashFolder }) => {
      try {
        await withCreds((c) => deps.imap.deleteEmail(c, folder, uid, trashFolder));
        return ok({ success: true });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    'list_labels',
    {
      title: "Lister les labels de l'utilisateur",
      description: 'Retourne tous les labels (locaux à l\'application, pas IMAP).',
      inputSchema: {},
    },
    async () => {
      try {
        const labels = await deps.labels.findAllByUser(ctx.userId);
        return ok(labels);
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    'create_label',
    {
      title: 'Créer un label',
      description: 'Crée un nouveau label utilisateur.',
      inputSchema: {
        name: z.string().min(1),
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/).describe('Couleur au format #RRGGBB'),
      },
    },
    async ({ name, color }) => {
      try {
        const label = await deps.labels.create(ctx.userId, { name, color });
        return ok(label);
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    'add_label_to_email',
    {
      title: 'Appliquer un label à un email',
      inputSchema: {
        labelId: z.string(),
        folder: z.string(),
        uid: z.number().int().positive(),
      },
    },
    async ({ labelId, folder, uid }) => {
      try {
        const res = await deps.labels.addEmailToLabel(labelId, ctx.userId, folder, uid);
        return ok(res);
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  server.registerTool(
    'remove_label_from_email',
    {
      title: "Retirer un label d'un email",
      inputSchema: {
        labelId: z.string(),
        folder: z.string(),
        uid: z.number().int().positive(),
      },
    },
    async ({ labelId, folder, uid }) => {
      try {
        await deps.labels.removeEmailFromLabel(labelId, ctx.userId, folder, uid);
        return ok({ success: true });
      } catch (e) {
        return fail((e as Error).message);
      }
    },
  );

  return server;
}

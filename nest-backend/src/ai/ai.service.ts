import { BadGatewayException, BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { IsNull, Repository } from 'typeorm';
import { UsersService } from '../users/users.service';
import { decrypt } from '../users/crypto.util';
import { EmailAiInsight } from './email-ai-insight.entity';

type ConfidenceLevel = 'low' | 'medium' | 'high';
type PhishingLevel = 'low' | 'medium' | 'high';

export interface AiActionItem {
  title: string;
  details: string;
  kind: 'task' | 'meeting' | 'deadline' | 'follow_up';
  dueDate: string | null;
  confidence: ConfidenceLevel;
}

export interface AiCategoryResult {
  category: string;
  confidence: ConfidenceLevel;
  reason: string;
}

export interface AiPhishingResult {
  level: PhishingLevel;
  reason: string;
  indicators: string[];
}

export interface EmailTriageInput {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  messageId?: string;
  folder?: string;
  uid?: number;
}

export interface EmailTriageResult {
  id: string;
  category: string;
  urgency: ConfidenceLevel;
  confidence: ConfidenceLevel;
  phishingLevel: PhishingLevel;
  reason: string;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
  error?: {
    message?: string;
  };
}

interface AnthropicResponse {
  content?: Array<{
    type?: string;
    text?: string;
  }>;
  error?: {
    message?: string;
  };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  error?: {
    message?: string;
  };
}

type AiProvider = 'openai' | 'anthropic' | 'google' | 'mistral' | 'other';

interface ProviderConfig {
  provider: AiProvider;
  apiKey: string;
  apiUrl: string | null;
}

interface EmailInsightIdentity {
  messageId?: string | null;
  folder?: string | null;
  uid?: number | null;
}

@Injectable()
export class AiService {
  private static readonly defaultModel = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
  private static readonly mistralModel = process.env.MISTRAL_MODEL || 'mistral-small-latest';
  private static readonly anthropicModel = process.env.ANTHROPIC_MODEL || 'claude-3-5-haiku-latest';
  private static readonly googleModel = process.env.GOOGLE_MODEL || 'gemini-2.0-flash';

  constructor(
    private readonly usersService: UsersService,
    @InjectRepository(EmailAiInsight)
    private readonly emailAiInsightRepository: Repository<EmailAiInsight>,
  ) {}

  async compose(
    userId: string,
    prompt: string,
    currentDraft?: string,
    tone?: string,
  ): Promise<string> {
    const normalizedPrompt = (prompt || '').trim();
    const normalizedDraft = (currentDraft || '').trim();
    if (!normalizedPrompt && !normalizedDraft) {
      throw new BadRequestException("Une instruction ou un brouillon existant est requis.");
    }

    const toneLabel = tone?.trim() || 'natural';
    return this.requestText(
      userId,
      [
        'Tu aides a rediger des emails professionnels.',
        "Retourne uniquement le corps de l'email en HTML simple et propre.",
        'Utilise des balises comme <p>, <ul>, <li> si utile.',
        "N'ajoute ni markdown, ni ``` fences, ni objet d'email.",
        'Conserve les faits du brouillon quand un brouillon existe.',
      ].join(' '),
      [
        normalizedDraft
          ? `Brouillon actuel:\n${normalizedDraft}`
          : 'Aucun brouillon actuel.',
        normalizedPrompt
          ? `Instruction utilisateur: ${normalizedPrompt}`
          : 'Instruction utilisateur: Ameliore le brouillon existant.',
        `Ton souhaite: ${toneLabel}.`,
      ].join('\n\n'),
      0.6,
    );
  }

  async summarize(userId: string, emailContent: string): Promise<string> {
    return this.requestText(
      userId,
      [
        "Tu resumes des emails pour une interface de messagerie en francais.",
        'Fais un resume tres concis en 3 a 5 puces maximum.',
        "Retourne du texte brut lisible, sans introduction ni conclusion.",
      ].join(' '),
      emailContent,
      0.3,
    );
  }

  async reply(userId: string, emailContent: string): Promise<string[]> {
    const result = await this.requestJson<{ replies?: string[] }>(
      userId,
      [
        'Analyse le message et propose 3 reponses courtes.',
        'Retourne uniquement un objet JSON avec une cle "replies".',
        'Chaque reponse doit etre concise, naturelle, directement envoyable.',
      ].join(' '),
      emailContent,
    );
    return (result.replies ?? []).filter((entry) => typeof entry === 'string' && entry.trim().length > 0).slice(0, 3);
  }

  async extract(userId: string, emailContent: string): Promise<AiActionItem[]> {
    const today = new Date().toISOString().slice(0, 10);
    const result = await this.requestJson<{ items?: AiActionItem[] }>(
      userId,
      [
        "Extrait les actions a faire d'un email.",
        'Retourne uniquement un objet JSON avec une cle "items".',
        'Chaque item doit suivre ce schema:',
        '{"title":"string","details":"string","kind":"task|meeting|deadline|follow_up","dueDate":"YYYY-MM-DDTHH:mm:ss.sssZ ou null","confidence":"low|medium|high"}',
        `La date du jour est ${today}.`,
        "Si aucune action n'est demandee, retourne {\"items\":[]}.",
      ].join(' '),
      emailContent,
    );

    return (result.items ?? [])
      .map((item) => {
        const parsedDueDate = item?.dueDate ? new Date(item.dueDate) : null;
        return {
          title: (item?.title || '').trim(),
          details: (item?.details || '').trim(),
          kind: this.normalizeActionKind(item?.kind),
          dueDate: parsedDueDate && !Number.isNaN(parsedDueDate.getTime()) ? parsedDueDate.toISOString() : null,
          confidence: this.normalizeConfidence(item?.confidence),
        };
      })
      .filter((item) => item.title.length > 0);
  }

  async translate(userId: string, emailContent: string, targetLanguage: string): Promise<string> {
    return this.requestText(
      userId,
      [
        'Traduis le texte de facon naturelle et contextuelle.',
        'Conserve les informations techniques, la structure et le ton.',
        `La langue cible est: ${targetLanguage}.`,
        "Retourne uniquement la traduction, sans commentaire additionnel.",
      ].join(' '),
      emailContent,
      0.2,
    );
  }

  async categorize(
    userId: string,
    emailContent: string,
    identity?: EmailInsightIdentity,
    accountId?: string | null,
  ): Promise<AiCategoryResult> {
    const normalizedIdentity = this.normalizeIdentity(identity);
    const normalizedAccountId = this.normalizeAccountId(accountId);
    const contentHash = this.hashContent(emailContent);
    const cached = await this.findCachedInsight(userId, normalizedAccountId, normalizedIdentity);

    if (cached && cached.contentHash === contentHash && cached.category) {
      return {
        category: cached.category,
        confidence: this.normalizeConfidence(cached.confidence),
        reason: cached.reason || '',
      };
    }

    const result = await this.requestJson<AiCategoryResult>(
      userId,
      [
        'Classe cet email dans une categorie utile pour une boite mail.',
        'Categories recommandees: Factures, Newsletter, Urgent, Personnel, Travail, Promotion, Social, Support, Autre.',
        'Retourne uniquement un objet JSON avec category, confidence, reason.',
      ].join(' '),
      emailContent,
    );

    const normalizedResult = {
      category: (result.category || 'Autre').trim() || 'Autre',
      confidence: this.normalizeConfidence(result.confidence),
      reason: (result.reason || '').trim(),
    };

    await this.saveInsight(userId, normalizedAccountId, normalizedIdentity, contentHash, {
      category: normalizedResult.category,
      confidence: normalizedResult.confidence,
      reason: normalizedResult.reason,
      urgency: cached?.contentHash === contentHash ? this.normalizeNullableConfidence(cached?.urgency) : null,
      phishingLevel: cached?.contentHash === contentHash ? this.normalizeNullablePhishingLevel(cached?.phishingLevel) : null,
    }, cached);

    return normalizedResult;
  }

  async phishing(
    userId: string,
    emailContent: string,
    identity?: EmailInsightIdentity,
    accountId?: string | null,
  ): Promise<AiPhishingResult> {
    const normalizedIdentity = this.normalizeIdentity(identity);
    const normalizedAccountId = this.normalizeAccountId(accountId);
    const contentHash = this.hashContent(emailContent);
    const cached = await this.findCachedInsight(userId, normalizedAccountId, normalizedIdentity);

    if (cached && cached.contentHash === contentHash && cached.phishingLevel) {
      return {
        level: this.normalizePhishingLevel(cached.phishingLevel),
        reason: cached.reason || '',
        indicators: [],
      };
    }

    const result = await this.requestJson<AiPhishingResult>(
      userId,
      [
        "Analyse le message pour detecter des signaux d'hameconnage ou de manipulation.",
        'Retourne uniquement un objet JSON avec level, reason, indicators.',
        'level doit etre low, medium ou high.',
        'indicators doit etre un tableau court de signaux concrets.',
      ].join(' '),
      emailContent,
    );

    const normalizedResult = {
      level: this.normalizePhishingLevel(result.level),
      reason: (result.reason || '').trim(),
      indicators: Array.isArray(result.indicators)
        ? result.indicators.filter((item) => typeof item === 'string' && item.trim().length > 0).slice(0, 5)
        : [],
    };

    await this.saveInsight(
      userId,
      normalizedAccountId,
      normalizedIdentity,
      contentHash,
      {
        category: cached?.category,
        confidence: cached?.contentHash === contentHash ? this.normalizeNullableConfidence(cached?.confidence) : null,
        urgency: cached?.contentHash === contentHash ? this.normalizeNullableConfidence(cached?.urgency) : null,
        phishingLevel: normalizedResult.level,
        reason: normalizedResult.reason,
      },
      cached,
    );

    return normalizedResult;
  }

  async triage(
    userId: string,
    emails: EmailTriageInput[],
    accountId?: string | null,
  ): Promise<EmailTriageResult[]> {
    if (!emails.length) return [];

    const normalizedAccountId = this.normalizeAccountId(accountId);
    const trimmedEmails = emails.slice(0, 20).map((email) => ({
      id: email.id,
      from: email.from,
      subject: email.subject,
      snippet: email.snippet,
      messageId: email.messageId,
      folder: email.folder,
      uid: email.uid,
    }));

    const cachedResults = new Map<string, EmailTriageResult>();
    const missingEmails: typeof trimmedEmails = [];

    for (const email of trimmedEmails) {
      const identity = this.normalizeIdentity(email);
      const contentHash = this.hashContent(email.from, email.subject, email.snippet);
      const cached = await this.findCachedInsight(userId, normalizedAccountId, identity);

      if (cached && cached.contentHash === contentHash && this.isCompleteTriageInsight(cached)) {
        cachedResults.set(email.id, {
          id: email.id,
          category: cached.category || 'Autre',
          urgency: this.normalizeConfidence(cached.urgency),
          confidence: this.normalizeConfidence(cached.confidence),
          phishingLevel: this.normalizePhishingLevel(cached.phishingLevel),
          reason: cached.reason || '',
        });
      } else {
        missingEmails.push(email);
      }
    }

    if (!missingEmails.length) {
      return trimmedEmails
        .map((email) => cachedResults.get(email.id))
        .filter((item): item is EmailTriageResult => !!item);
    }

    const result = await this.requestJson<{ results?: EmailTriageResult[] }>(
      userId,
      [
        "Analyse une liste d'emails pour un tri intelligent.",
        'Pour chaque email, retourne: id, category, urgency, confidence, phishingLevel, reason.',
        'Categories recommandees: Factures, Newsletter, Urgent, Personnel, Travail, Promotion, Social, Support, Autre.',
        'urgency et confidence doivent etre low, medium ou high.',
        'phishingLevel doit etre low, medium ou high.',
        'Retourne uniquement un objet JSON avec une cle "results".',
      ].join(' '),
      JSON.stringify({
        emails: missingEmails.map((email) => ({
          id: email.id,
          from: email.from,
          subject: email.subject,
          snippet: email.snippet,
        })),
      }),
    );

    const freshResults = (result.results ?? [])
      .filter((item) => item && typeof item.id === 'string')
      .map((item) => ({
        id: item.id,
        category: (item.category || 'Autre').trim() || 'Autre',
        urgency: this.normalizeConfidence(item.urgency),
        confidence: this.normalizeConfidence(item.confidence),
        phishingLevel: this.normalizePhishingLevel(item.phishingLevel),
        reason: (item.reason || '').trim(),
      }));

    const freshById = new Map(freshResults.map((item) => [item.id, item]));

    for (const email of missingEmails) {
      const triageResult = freshById.get(email.id);
      if (!triageResult) continue;

      await this.saveInsight(
        userId,
        normalizedAccountId,
        this.normalizeIdentity(email),
        this.hashContent(email.from, email.subject, email.snippet),
        {
          category: triageResult.category,
          urgency: triageResult.urgency,
          confidence: triageResult.confidence,
          phishingLevel: triageResult.phishingLevel,
          reason: triageResult.reason,
        },
      );
      cachedResults.set(email.id, triageResult);
    }

    return trimmedEmails
      .map((email) => cachedResults.get(email.id))
      .filter((item): item is EmailTriageResult => !!item);
  }

  private normalizeAccountId(accountId?: string | null): string | null {
    const normalized = accountId?.trim();
    return normalized ? normalized : null;
  }

  private normalizeIdentity(identity?: EmailInsightIdentity | null): EmailInsightIdentity {
    const messageId = identity?.messageId?.trim() || null;
    const folder = identity?.folder?.trim() || null;
    const uid = typeof identity?.uid === 'number' ? identity.uid : null;
    return { messageId, folder, uid };
  }

  private hashContent(...parts: Array<string | null | undefined>): string {
    return createHash('sha256')
      .update(parts.map((part) => (part || '').trim()).join('\n\u241f\n'))
      .digest('hex');
  }

  private async findCachedInsight(
    userId: string,
    accountId: string | null,
    identity: EmailInsightIdentity,
  ): Promise<EmailAiInsight | null> {
    const accountMatcher = accountId ? accountId : IsNull();
    const where: Array<Record<string, unknown>> = [];

    if (identity.messageId) {
      where.push({
        userId,
        accountId: accountMatcher,
        messageId: identity.messageId,
      });
    }

    if (identity.folder && identity.uid !== null && identity.uid !== undefined) {
      where.push({
        userId,
        accountId: accountMatcher,
        folder: identity.folder,
        uid: identity.uid,
      });
    }

    if (!where.length) return null;

    return this.emailAiInsightRepository.findOne({
      where: where as any,
      order: { updatedAt: 'DESC' },
    });
  }

  private async saveInsight(
    userId: string,
    accountId: string | null,
    identity: EmailInsightIdentity,
    contentHash: string,
    values: {
      category?: string | null;
      urgency?: ConfidenceLevel | null;
      confidence?: ConfidenceLevel | null;
      phishingLevel?: PhishingLevel | null;
      reason?: string;
    },
      existing?: EmailAiInsight | null,
  ): Promise<EmailAiInsight | null> {
    if (!identity.messageId && !(identity.folder && identity.uid !== null && identity.uid !== undefined)) {
      return null;
    }

    const insight = existing ?? (await this.findCachedInsight(userId, accountId, identity)) ?? this.emailAiInsightRepository.create();
    insight.userId = userId;
    insight.user = { id: userId } as any;
    insight.accountId = accountId;
    insight.messageId = identity.messageId ?? insight.messageId ?? null;
    insight.folder = identity.folder ?? insight.folder ?? null;
    insight.uid = identity.uid ?? insight.uid ?? null;
    insight.contentHash = contentHash;
    insight.category = values.category?.trim() || insight.category || 'Autre';
    insight.urgency = this.normalizeNullableConfidence(values.urgency);
    insight.confidence = this.normalizeNullableConfidence(values.confidence);
    insight.phishingLevel = this.normalizeNullablePhishingLevel(values.phishingLevel);
    insight.reason = values.reason?.trim() || '';
    return this.emailAiInsightRepository.save(insight);
  }

  private isCompleteTriageInsight(insight: EmailAiInsight): boolean {
    return !!insight.category && !!insight.urgency && !!insight.confidence && !!insight.phishingLevel;
  }

  private normalizeNullableConfidence(value: unknown): ConfidenceLevel | null {
    if (value === null || value === undefined || value === '') return null;
    return this.normalizeConfidence(value);
  }

  private normalizeNullablePhishingLevel(value: unknown): PhishingLevel | null {
    if (value === null || value === undefined || value === '') return null;
    return this.normalizePhishingLevel(value);
  }

  private async requestText(
    userId: string,
    systemPrompt: string,
    userPrompt: string,
    temperature = 0.4,
  ): Promise<string> {
    const config = await this.getProviderConfig(userId);
    switch (config.provider) {
      case 'anthropic':
        return this.requestAnthropicText(config, systemPrompt, userPrompt, temperature);
      case 'google':
        return this.requestGoogleText(config, systemPrompt, userPrompt, temperature);
      case 'mistral':
        return this.requestOpenAiCompatibleText(
          config,
          AiService.mistralModel,
          config.apiUrl || 'https://api.mistral.ai/v1/chat/completions',
          systemPrompt,
          userPrompt,
          temperature,
        );
      case 'other':
        return this.requestOpenAiCompatibleText(
          config,
          AiService.defaultModel,
          config.apiUrl || '',
          systemPrompt,
          userPrompt,
          temperature,
        );
      case 'openai':
      default:
        return this.requestOpenAiCompatibleText(
          config,
          AiService.defaultModel,
          config.apiUrl || 'https://api.openai.com/v1/chat/completions',
          systemPrompt,
          userPrompt,
          temperature,
        );
    }
  }

  private async requestJson<T>(userId: string, systemPrompt: string, userPrompt: string): Promise<T> {
    const raw = await this.requestText(
      userId,
      `${systemPrompt} Reponds en JSON strict uniquement, sans markdown ni texte hors JSON.`,
      userPrompt,
      0.2,
    );
    return this.parseJson<T>(raw);
  }

  private parseJson<T>(raw: string): T {
    const normalized = raw.trim();
    const candidates = [
      normalized,
      normalized.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim(),
    ];

    for (const candidate of candidates) {
      try {
        return JSON.parse(candidate) as T;
      } catch {
        // Try next strategy.
      }
    }

    const firstObject = normalized.indexOf('{');
    const lastObject = normalized.lastIndexOf('}');
    if (firstObject >= 0 && lastObject > firstObject) {
      try {
        return JSON.parse(normalized.slice(firstObject, lastObject + 1)) as T;
      } catch {
        // Ignore and continue.
      }
    }

    const firstArray = normalized.indexOf('[');
    const lastArray = normalized.lastIndexOf(']');
    if (firstArray >= 0 && lastArray > firstArray) {
      try {
        return JSON.parse(normalized.slice(firstArray, lastArray + 1)) as T;
      } catch {
        // Ignore and continue.
      }
    }

    throw new BadGatewayException("La reponse JSON du modele IA n'a pas pu etre analysee.");
  }

  private normalizeActionKind(value: unknown): AiActionItem['kind'] {
    return value === 'meeting' || value === 'deadline' || value === 'follow_up'
      ? value
      : 'task';
  }

  private normalizeConfidence(value: unknown): ConfidenceLevel {
    return value === 'low' || value === 'high' ? value : 'medium';
  }

  private normalizePhishingLevel(value: unknown): PhishingLevel {
    return value === 'medium' || value === 'high' ? value : 'low';
  }

  private async requestOpenAiCompatibleText(
    config: ProviderConfig,
    model: string,
    apiUrl: string,
    systemPrompt: string,
    userPrompt: string,
    temperature: number,
  ): Promise<string> {
    if (!apiUrl) {
      throw new BadRequestException("Une URL d'API compatible OpenAI est requise pour ce fournisseur.");
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    const payload = await response.json() as ChatCompletionResponse;
    if (!response.ok) {
      throw new BadGatewayException(payload.error?.message || "L'appel au modele IA a echoue.");
    }

    const content = payload.choices?.[0]?.message?.content;
    if (typeof content === 'string' && content.trim()) {
      return content.trim();
    }
    if (Array.isArray(content)) {
      const text = content
        .map((entry) => (typeof entry?.text === 'string' ? entry.text : ''))
        .join('')
        .trim();
      if (text) return text;
    }

    throw new BadGatewayException("Le modele IA a retourne une reponse vide.");
  }

  private async requestAnthropicText(
    config: ProviderConfig,
    systemPrompt: string,
    userPrompt: string,
    temperature: number,
  ): Promise<string> {
    const response = await fetch(config.apiUrl || 'https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: AiService.anthropicModel,
        max_tokens: 1200,
        temperature,
        system: systemPrompt,
        messages: [
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    const payload = await response.json() as AnthropicResponse;
    if (!response.ok) {
      throw new BadGatewayException(payload.error?.message || "L'appel au modele IA a echoue.");
    }

    const text = (payload.content ?? [])
      .map((entry) => entry?.text || '')
      .join('')
      .trim();

    if (!text) {
      throw new BadGatewayException("Le modele IA a retourne une reponse vide.");
    }

    return text;
  }

  private async requestGoogleText(
    config: ProviderConfig,
    systemPrompt: string,
    userPrompt: string,
    temperature: number,
  ): Promise<string> {
    const baseUrl = config.apiUrl || `https://generativelanguage.googleapis.com/v1beta/models/${AiService.googleModel}:generateContent`;
    const separator = baseUrl.includes('?') ? '&' : '?';
    const response = await fetch(`${baseUrl}${separator}key=${encodeURIComponent(config.apiKey)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: userPrompt }],
          },
        ],
        generationConfig: {
          temperature,
        },
      }),
    });

    const payload = await response.json() as GeminiResponse;
    if (!response.ok) {
      throw new BadGatewayException(payload.error?.message || "L'appel au modele IA a echoue.");
    }

    const text = (payload.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part?.text || '')
      .join('')
      .trim();

    if (!text) {
      throw new BadGatewayException("Le modele IA a retourne une reponse vide.");
    }

    return text;
  }

  private async getProviderConfig(userId: string): Promise<ProviderConfig> {
    const user = await this.usersService.findById(userId);
    const encryptedKey = user?.aiApiKey || user?.openAiApiKey;
    if (!encryptedKey) {
      throw new ForbiddenException("Aucune cle API IA n'est configuree pour cet utilisateur.");
    }
    if (!user.isAiEnabled) {
      throw new ForbiddenException("Les fonctionnalites IA sont desactivees pour cet utilisateur.");
    }

    const provider = (user.aiProvider || 'openai') as AiProvider;
    const apiUrl = user.aiApiUrl?.trim() || null;

    try {
      return {
        provider,
        apiKey: decrypt(encryptedKey),
        apiUrl,
      };
    } catch {
      return {
        provider,
        apiKey: encryptedKey,
        apiUrl,
      };
    }
  }
}

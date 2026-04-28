import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

interface DocSection {
  id: string;
  title: string;
  summary: string;
  items: readonly string[];
}

interface ShortcutGroup {
  title: string;
  shortcuts: readonly { key: string; description: string }[];
}

@Component({
  selector: 'app-documentation',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './documentation.component.html',
  styleUrl: './documentation.component.css',
})
export class DocumentationComponent {
  readonly sections: readonly DocSection[] = [
    {
      id: 'demarrage',
      title: 'Demarrage',
      summary: 'Les premieres actions pour ouvrir votre boite et travailler sans friction.',
      items: [
        'Connectez-vous avec votre compte Kyma ou creez un compte depuis la page d inscription.',
        'Ajoutez au moins un compte mail dans Reglages > Comptes pour synchroniser vos messages.',
        'Utilisez la barre laterale pour passer de la boite de reception aux messages envoyes, brouillons, spam et corbeille.',
        'Sur mobile, ouvrez le menu avec le bouton situe en haut a gauche puis refermez-le en touchant le fond de page.',
      ],
    },
    {
      id: 'lecture',
      title: 'Lire et organiser les emails',
      summary: 'Toutes les commandes utiles pour traiter rapidement la liste des messages.',
      items: [
        'Cliquez sur un email pour l ouvrir. Le bouton retour ou le raccourci u revient a la liste.',
        'Actualisez un dossier avec le bouton de rafraichissement dans l en-tete de la liste.',
        'Selectionnez plusieurs messages pour appliquer des actions groupees comme suivre, spam ou suppression.',
        'Glissez un message vers un dossier de la barre laterale pour le deplacer.',
        'Dans la corbeille, utilisez Vider la corbeille pour supprimer definitivement les emails du dossier.',
      ],
    },
    {
      id: 'recherche',
      title: 'Recherche',
      summary: 'Retrouvez un message sans quitter le dossier courant.',
      items: [
        'Saisissez une requete dans la barre de recherche en haut de l application.',
        'La recherche s applique au dossier courant quand vous etes dans une liste.',
        'Depuis le detail d un email, la recherche repart du dossier d origine du message.',
        'Effacez le champ pour revenir a l affichage complet du dossier.',
      ],
    },
    {
      id: 'redaction',
      title: 'Rediger et envoyer',
      summary: 'Composer des messages, repondre, utiliser les modeles et garder la main sur l envoi.',
      items: [
        'Cliquez sur Nouveau message ou utilisez le raccourci c pour ouvrir la fenetre de redaction.',
        'Ajoutez les destinataires dans A, puis activez Cc / Cci si necessaire.',
        'Joignez des fichiers en les deposant directement dans la fenetre de composition.',
        'Utilisez les modeles depuis l icone document lorsque des modeles sont configures.',
        'Si l annulation d envoi est active, un bandeau permet d annuler l envoi pendant le delai choisi.',
      ],
    },
    {
      id: 'dossiers-libelles',
      title: 'Dossiers et libelles',
      summary: 'Structurez votre boite avec vos propres dossiers et etiquettes.',
      items: [
        'Depliez la section Dossiers pour afficher les dossiers IMAP disponibles.',
        'Ajoutez un dossier avec le bouton plus, puis donnez-lui un nom clair.',
        'Faites un clic droit sur un dossier pour telecharger son archive ou le supprimer.',
        'Depliez Libelles pour creer, renommer et utiliser des libelles de classement.',
        'Les compteurs indiquent les messages non lus ou associes aux libelles quand ils sont disponibles.',
      ],
    },
    {
      id: 'parametres',
      title: 'Parametres',
      summary: 'Centralisez la configuration de l application depuis le bouton engrenage.',
      items: [
        'Comptes : ajoutez des boites Google, Microsoft, Apple ou des serveurs IMAP/SMTP compatibles.',
        'Signatures : creez une ou plusieurs signatures et choisissez celle utilisee par defaut.',
        'General : reglez le theme, la taille des pages, la couleur d accent et les gestes mobiles.',
        'Libelles et filtres : adaptez le classement automatique a votre maniere de travailler.',
        'Modeles : preparez des messages reutilisables pour les reponses frequentes.',
      ],
    },
    {
      id: 'securite',
      title: 'Securite et confidentialite',
      summary: 'Les reglages qui protegent votre compte, vos sessions et le contenu de vos emails.',
      items: [
        'Activez la double authentification dans Reglages > Securite lorsque l option est disponible.',
        'Ajoutez une cle d acces compatible WebAuthn pour vous connecter plus rapidement et plus surement.',
        'Consultez les sessions actives et revoquez celles que vous ne reconnaissez pas.',
        'Dans Confidentialite, bloquez les pixels de suivi et choisissez le niveau de detail des notifications push.',
        'Configurez le rendu des emails en mode sombre selon vos preferences de lisibilite.',
      ],
    },
    {
      id: 'chiffrement',
      title: 'Chiffrement PGP',
      summary: 'Proteger les messages sensibles avec vos cles PGP.',
      items: [
        'Ouvrez Reglages > Securite pour charger ou gerer les informations PGP proposees par l application.',
        'Conservez vos cles privees et phrases secretes dans un gestionnaire de mots de passe fiable.',
        'Verifiez toujours l identite du destinataire avant d envoyer des informations sensibles.',
        'Si un message chiffre ne s affiche pas comme prevu, controlez que la bonne cle est disponible sur le compte.',
      ],
    },
    {
      id: 'ia',
      title: 'Intelligence artificielle',
      summary: 'Resume, tri et assistance de redaction quand une cle API est configuree.',
      items: [
        'Ajoutez votre fournisseur et votre cle API dans Reglages > Intelligence Artificielle.',
        'Activez uniquement les fonctions souhaitees : redaction, resumes, suggestions, traduction ou tri.',
        'Le tri intelligent classe les messages par categorie, urgence ou risque de phishing quand il est actif.',
        'Les taches detectees depuis les emails peuvent etre consultees depuis le panneau Taches IA.',
        'Vous pouvez masquer les rappels de configuration si vous ne souhaitez pas utiliser l IA.',
      ],
    },
    {
      id: 'hors-ligne',
      title: 'Mode hors-ligne',
      summary: 'Continuer a travailler meme quand la connexion est temporairement indisponible.',
      items: [
        'Un bandeau apparait en haut de l ecran lorsque l application detecte une perte de connexion.',
        'Les actions compatibles sont mises en attente puis synchronisees au retour de la connexion.',
        'Le compteur du bandeau indique le nombre d emails en attente de synchronisation.',
        'Evitez de fermer brutalement l onglet pendant une longue periode hors-ligne si vous venez d effectuer beaucoup d actions.',
      ],
    },
  ];

  readonly shortcuts: readonly ShortcutGroup[] = [
    {
      title: 'General',
      shortcuts: [
        { key: 'c', description: 'Nouveau message' },
        { key: '/', description: 'Rechercher' },
        { key: '?', description: 'Afficher les raccourcis' },
        { key: 'Echap', description: 'Fermer la fenetre active' },
      ],
    },
    {
      title: 'Liste',
      shortcuts: [
        { key: 'j / Fleche bas', description: 'Email suivant' },
        { key: 'k / Fleche haut', description: 'Email precedent' },
        { key: 'Entree / o', description: 'Ouvrir l email selectionne' },
      ],
    },
    {
      title: 'Email',
      shortcuts: [
        { key: 's', description: 'Suivre ou ne plus suivre' },
        { key: 'e / #', description: 'Supprimer' },
        { key: 'r', description: 'Repondre' },
        { key: 'u', description: 'Retour a la liste' },
        { key: 'Shift+i', description: 'Marquer lu ou non lu' },
      ],
    },
  ];
}

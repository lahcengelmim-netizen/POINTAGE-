/**
 * ÉCRAN 3 — RÉCAPITULATIF DU JOUR (Format WhatsApp)
 * Génère le texte dans le format exact demandé, prêt à copier et coller.
 */

import React, { useState } from 'react';
import {
  Copy,
  Share2,
  Check,
  Send,
  MessageSquare,
  Sparkles,
} from 'lucide-react';

interface RecapWhatsAppProps {
  recapText: string;
  selectedDate: string;
  totalPointes: number;
  totalAbsents: number;
  totalSupp?: number;
}

export const RecapWhatsApp: React.FC<RecapWhatsAppProps> = ({
  recapText,
  totalPointes,
  totalAbsents,
  totalSupp = 0,
}) => {
  const [copied, setCopied] = useState(false);
  const [shareStatus, setShareStatus] = useState<string | null>(null);

  // Copier dans le presse-papier
  const handleCopy = async () => {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(recapText);
      } else {
        // Méthode de secours
        const textArea = document.createElement('textarea');
        textArea.value = recapText;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setShareStatus('Impossible de copier automatiquement. Veuillez sélectionner le texte ci-dessous.');
      setTimeout(() => setShareStatus(null), 3000);
    }
  };

  // Partager via Web Share API ou lien direct WhatsApp
  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Lahcen Pointeur',
          text: recapText,
        });
        setShareStatus('Message partagé avec succès !');
        setTimeout(() => setShareStatus(null), 3000);
        return;
      } catch (err: unknown) {
        // L'utilisateur a peut-être annulé le partage
        if (err instanceof Error && err.name === 'AbortError') return;
      }
    }

    // Fallback direct vers WhatsApp Web / Mobile
    const encoded = encodeURIComponent(recapText);
    const whatsappUrl = `https://api.whatsapp.com/send?text=${encoded}`;
    window.open(whatsappUrl, '_blank');
  };

  return (
    <div className="space-y-3 pb-24">
      {/* Barre d'actions principales à gros boutons */}
      <div className="grid grid-cols-2 gap-2">
        {/* Bouton COPIER */}
        <button
          type="button"
          onClick={handleCopy}
          className={`h-14 rounded-2xl font-black text-sm flex items-center justify-center gap-2 shadow-md transition-all active:scale-[0.98] ${
            copied
              ? 'bg-emerald-600 text-white'
              : 'bg-white hover:bg-slate-50 text-slate-800 border-2 border-slate-300'
          }`}
        >
          {copied ? (
            <>
              <Check className="w-5 h-5 text-white" />
              <span>COPIÉ DANS LE PRESSE-PAPIER !</span>
            </>
          ) : (
            <>
              <Copy className="w-5 h-5 text-emerald-600" />
              <span>COPIER LE MESSAGE</span>
            </>
          )}
        </button>

        {/* Bouton PARTAGER WHATSAPP */}
        <button
          type="button"
          onClick={handleShare}
          className="h-14 bg-[#25D366] hover:bg-[#20ba59] active:scale-[0.98] text-white font-black text-sm rounded-2xl shadow-md flex items-center justify-center gap-2 transition"
        >
          <Share2 className="w-5 h-5" />
          <span>PARTAGER WHATSAPP</span>
        </button>
      </div>

      {/* Notification de statut */}
      {shareStatus && (
        <div className="bg-slate-800 text-white text-xs py-2 px-3 rounded-xl text-center font-bold">
          {shareStatus}
        </div>
      )}

      {/* Prévisualisation façon WhatsApp */}
      <div className="bg-white rounded-2xl shadow-xs border border-slate-200 overflow-hidden">
        {/* En-tête style conversation WhatsApp */}
        <div className="bg-[#075E54] text-white px-3 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center">
              <MessageSquare className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="text-xs font-black tracking-wide">
                Groupe Pointage Domaine
              </div>
              <div className="text-[10px] text-emerald-200">
                Aperçu du texte généré (règles strictes)
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 text-[11px] font-bold bg-white/15 px-2 py-0.5 rounded-full">
            <span>{totalPointes} prés.</span>
            <span>•</span>
            <span className="text-amber-300">{totalAbsents} abs.</span>
            {totalSupp > 0 && (
              <>
                <span>•</span>
                <span className="text-amber-400 font-extrabold">{totalSupp} sup.</span>
              </>
            )}
          </div>
        </div>

        {/* Fond de discussion style WhatsApp avec bulle */}
        <div className="p-4 bg-[#ECE5DD] relative min-h-[220px]">
          {/* Bulle verte de message sortant */}
          <div className="bg-[#E7FFDB] text-slate-900 rounded-2xl rounded-tr-xs p-3.5 shadow-sm max-w-[96%] ml-auto border border-[#c4e5b5]">
            {/* Texte formatté respectant scrupuleusement la casse et les séparateurs */}
            <pre className="font-mono text-xs sm:text-sm font-bold whitespace-pre-wrap break-all leading-relaxed tracking-wide select-all">
              {recapText}
            </pre>

            {/* Heure et coches bleues WhatsApp */}
            <div className="flex items-center justify-end gap-1 mt-2 text-[10px] text-slate-500 font-sans">
              <span>
                {new Date().toLocaleTimeString('fr-FR', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
              <span className="text-[#34B7F1] font-bold">✓✓</span>
            </div>
          </div>
        </div>

        {/* Explication des règles de format */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 text-xs text-slate-600 space-y-1">
          <div className="font-bold text-slate-800 flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
            <span>Format conforme garanti :</span>
          </div>
          <ul className="list-disc list-inside text-[11px] text-slate-500 space-y-0.5">
            <li>Numéros séparés par un point, sans espace (ex : <code className="bg-slate-200 px-1 rounded text-slate-800 font-bold">1.2.3.15</code>)</li>
            <li>Tri automatique par ordre croissant</li>
            <li>Nombre d'ouvriers entre parenthèses sur chaque ligne</li>
            <li>Absences calculées automatiquement sans saisie manuelle</li>
          </ul>
        </div>
      </div>

      {/* Bouton secondaire d'envoi SMS */}
      <div className="text-center pt-1">
        <a
          href={`sms:?body=${encodeURIComponent(recapText)}`}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 hover:text-slate-900 bg-white border border-slate-300 py-2 px-4 rounded-xl shadow-2xs hover:bg-slate-50 transition"
        >
          <Send className="w-3.5 h-3.5 text-slate-500" />
          <span>Envoyer par SMS classique</span>
        </a>
      </div>
    </div>
  );
};

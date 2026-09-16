import React, { useState } from 'react';
import {
  X,
  Download,
  Upload,
  Copy,
  Check,
  FileJson,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { db, importUsersFromJson } from '../../db';
import type { UserRecord } from '../../types';

interface ImportExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportComplete?: () => void;
}

export const ImportExportModal: React.FC<ImportExportModalProps> = ({
  isOpen,
  onClose,
  onImportComplete,
}) => {
  const [activeTab, setActiveTab] = useState<'export' | 'import'>('export');
  const [copied, setCopied] = useState(false);
  const [jsonText, setJsonText] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    totalCount: number;
    addedCount: number;
    updatedCount: number;
    errors: string[];
  } | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  if (!isOpen) return null;

  const handleExportDownload = async () => {
    try {
      const allUsers = await db.users.toArray();
      // Format as specified in the prompt
      const exportData = allUsers.map((u) => ({
        username: u.username,
        name: u.name,
        iFollow: Boolean(u.iFollow),
        followsMe: Boolean(u.followsMe),
        everFollowed: Boolean(u.everFollowed),
        protected: Boolean(u.protected),
      }));

      const jsonString = JSON.stringify(exportData, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const dateStr = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `instahub_followers_backup_${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setErrorMessage('Erro ao exportar dados: ' + err.message);
    }
  };

  const handleCopyExport = async () => {
    try {
      const allUsers = await db.users.toArray();
      const exportData = allUsers.map((u) => ({
        username: u.username,
        name: u.name,
        iFollow: Boolean(u.iFollow),
        followsMe: Boolean(u.followsMe),
        everFollowed: Boolean(u.everFollowed),
        protected: Boolean(u.protected),
      }));
      await navigator.clipboard.writeText(JSON.stringify(exportData, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err: any) {
      setErrorMessage('Erro ao copiar para a área de transferência: ' + err.message);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setJsonText(text);
    };
    reader.readAsText(file);
  };

  const handleProcessImport = async () => {
    if (!jsonText.trim()) {
      setErrorMessage('Cole um conteúdo JSON ou selecione um arquivo válido.');
      return;
    }

    setImporting(true);
    setErrorMessage('');
    setImportResult(null);

    try {
      const parsed = JSON.parse(jsonText);
      const result = await importUsersFromJson(parsed);
      setImportResult(result);
      if (onImportComplete) onImportComplete();
    } catch (err: any) {
      setErrorMessage('Falha ao processar JSON: ' + (err.message || 'JSON inválido'));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4">
      <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-lg overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-purple-100 text-purple-600">
              <FileJson className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Backup e Dados (JSON)
              </h2>
              <p className="text-xs text-slate-500">
                Exporte sua base completa ou importe um arquivo JSON
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Buttons */}
        <div className="flex border-b border-slate-100 px-6 pt-3 gap-4">
          <button
            onClick={() => {
              setActiveTab('export');
              setErrorMessage('');
              setImportResult(null);
            }}
            className={`pb-3 text-xs font-semibold border-b-2 flex items-center gap-1.5 transition cursor-pointer ${
              activeTab === 'export'
                ? 'border-purple-600 text-purple-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Download className="w-3.5 h-3.5" />
            <span>Exportar Dados</span>
          </button>

          <button
            onClick={() => {
              setActiveTab('import');
              setErrorMessage('');
              setImportResult(null);
            }}
            className={`pb-3 text-xs font-semibold border-b-2 flex items-center gap-1.5 transition cursor-pointer ${
              activeTab === 'import'
                ? 'border-purple-600 text-purple-600'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Importar Dados</span>
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {errorMessage && (
            <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs rounded-xl flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {activeTab === 'export' ? (
            <div className="space-y-4">
              <p className="text-xs text-slate-600 leading-relaxed">
                A exportação gera um arquivo JSON compatível com o schema do InstaHub,
                preservando os status de <span className="font-semibold">Eu sigo</span>,{' '}
                <span className="font-semibold">Me segue</span>,{' '}
                <span className="font-semibold">Já segui</span> e{' '}
                <span className="font-semibold">Protegido (whitelist)</span>.
              </p>

              <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 font-mono text-[11px] text-slate-700 overflow-x-auto">
                <pre>{`[
  {
    "username": "arthurhenrique",
    "name": "Arthur Henrique",
    "iFollow": true,
    "followsMe": false,
    "everFollowed": true,
    "protected": false
  }
]`}</pre>
              </div>

              <div className="flex items-center gap-2.5 pt-2">
                <button
                  onClick={handleExportDownload}
                  className="flex-1 bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold py-2.5 px-4 rounded-xl shadow-xs transition flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Download className="w-4 h-4" />
                  <span>Baixar Arquivo JSON</span>
                </button>

                <button
                  onClick={handleCopyExport}
                  className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold rounded-xl transition flex items-center gap-1.5 cursor-pointer"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                  <span>{copied ? 'Copiado!' : 'Copiar'}</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Selecione arquivo .json
                </label>
                <input
                  type="file"
                  accept=".json"
                  onChange={handleFileUpload}
                  className="block w-full text-xs text-slate-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-purple-50 file:text-purple-700 hover:file:bg-purple-100 file:cursor-pointer"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Ou cole o JSON diretamente:
                </label>
                <textarea
                  rows={5}
                  placeholder={`[
  {
    "username": "usuario_exemplo",
    "name": "Nome de Exemplo",
    "iFollow": true,
    "followsMe": false,
    "everFollowed": true,
    "protected": false
  }
]`}
                  value={jsonText}
                  onChange={(e) => setJsonText(e.target.value)}
                  className="w-full p-3 font-mono text-[11px] bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 text-slate-800 resize-none"
                />
              </div>

              {importResult && (
                <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl space-y-1">
                  <div className="flex items-center gap-1.5 font-bold">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>Importação concluída com sucesso!</span>
                  </div>
                  <div className="text-[11px] text-emerald-700">
                    • Total lido: {importResult.totalCount} perfis<br />
                    • Novos adicionados: {importResult.addedCount}<br />
                    • Existentes atualizados: {importResult.updatedCount}
                  </div>
                  {importResult.errors.length > 0 && (
                    <div className="mt-2 pt-2 border-t border-emerald-200 text-rose-600 font-normal">
                      Avisos: {importResult.errors.slice(0, 3).join(', ')}
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition cursor-pointer"
                >
                  Fechar
                </button>
                <button
                  onClick={handleProcessImport}
                  disabled={importing || !jsonText.trim()}
                  className="bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-xs font-semibold py-2 px-4 rounded-xl shadow-xs transition flex items-center gap-1.5 cursor-pointer"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>{importing ? 'Importando...' : 'Processar Importação'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

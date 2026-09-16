# InstaHub - Instagram Followers Manager 🚀

Extensão para Google Chrome (Manifest V3) destinada ao gerenciamento pessoal e inteligente de seguidores e perfis no Instagram, com histórico local, flags visuais, whitelist de proteção e navegação por teclado.

---

## 🛠️ Stack Tecnológica

* **Extensão:** Chrome Extension Manifest V3
* **Linguagem:** TypeScript
* **UI:** React 19
* **Build:** Vite 8
* **Estilização:** Tailwind CSS v4 + Lucide Icons
* **Persistência Local:** IndexedDB usando **Dexie.js**
* **Integração com Instagram:** Content Scripts + MutationObserver
* **Configurações rápidas:** `chrome.storage.local`
* **Importação/Exportação:** JSON

---

## 📋 Funcionalidades Principais

### 1. Base de Usuários e Histórico Preservado
* **Eu sigo (`iFollow`):** Indica se você atualmente segue o perfil.
* **Me segue (`followsMe`):** Indica se o perfil segue você.
* **Já segui (`everFollowed`):** Registra se você já seguiu esse perfil no passado. Se você der unfollow, `iFollow` torna-se `false`, mas `everFollowed` **permanece `true`**.
* **Protegido (`protected`):** Indica que o usuário pertence à **Whitelist** de proteção.

| Situação | Eu sigo | Me segue | Já segui |
| :--- | :---: | :---: | :---: |
| Seguimento mútuo | Sim | Sim | Sim |
| Sigo, mas não me segue | Sim | Não | Sim |
| Me segue, mas não sigo | Não | Sim | Não/Sim |
| Já segui e removi | Não | Não | Sim |
| Nunca segui | Não | Não | Não |

### 2. Dashboard Completo (`dashboard.html`)
* **Métricas em tempo real:** Cards dinâmicos com contadores de cada categoria.
* **Filtros rápidos por abas:**
  * 🔍 Todos os perfis
  * 🟢 Quem eu sigo
  * 🔵 Quem me segue
  * ⚠️ Quem não me segue de volta
  * ❤️ Fãs (quem me segue e eu não sigo)
  * 🕒 Quem já segui anteriormente
  * 🛡️ Protegidos (Whitelist)
* **Barra de Whitelist Rápida:** Adicione um ou vários `@usernames` de uma só vez.
* **Pesquisa instantânea:** Busca por username ou nome.
* **Edição de perfis:** Formulário completo para ajustar estados e adicionar anotações pessoais.
* **Ações em massa:** Selecione vários perfis para proteger, desproteger ou excluir.
* **Importação e Exportação JSON:** Backup e restauração com validação de integridade.

### 3. Sincronização Direta via API do Instagram (Novo ⚡)
Sincronize seus seguidores e quem você segue diretamente da sua sessão conectada no Instagram em um clique:
* **Ambos (Seguidores + Seguindo):** Mapeia quem você segue e quem te segue, identificando instantaneamente quem não te segue de volta e fãs.
* **Segurança e Privacidade:** Coleta estritamente o `@username` e o nome para atualizar as relações. Nenhuma informação privada do perfil (como bio, e-mail, telefone ou postagens) é extraída.
* **Proteção de Rate Limit:** Paginação suave com intervalos aleatorizados seguros entre requisições para respeitar a API web do Instagram.
* **Botão Interromper e Salvar:** Permite pausar a qualquer momento e salvar com segurança o progresso já coletado.
* **Preservação de Histórico:** Mantém intactos os contatos da sua Whitelist protegida, anotações pessoais e o registro histórico `everFollowed` (quem já seguiu no passado).

### 4. Flags Visuais no Instagram
Ao visualizar listas de seguidores ou sugestões no Instagram, a extensão injeta automaticamente selos com o status daquele perfil:
* **✓ Segue:** Você segue o perfil atualmente.
* **↺ Já seguiu:** Você já seguiu no passado, mas não segue mais.
* **– Nunca seguiu:** Não há registro de seguimento.
* **🛡️ Protegido:** Selo de whitelist. Clique diretamente no selo para proteger ou desproteger o perfil.

A extensão também monitora os cliques nos botões de Seguir/Seguindo para atualizar automaticamente o banco local!

### 5. Navegação por Teclado em Listas do Instagram
* `↓` (Seta para baixo): Seleciona o próximo perfil da lista.
* `↑` (Seta para cima): Seleciona o perfil anterior.
* `Enter`: Dispara o clique no botão de ação do Instagram daquela linha (ex: **Seguir**, **Seguindo**, **Solicitado**).
* Destaque visual luminoso no perfil ativo com indicação `↵ Enter`.
* Ignora teclas caso você esteja digitando em campos de texto.

### 6. Popup da Extensão (`popup.html`)
* Ativar/desativar flags visuais no Instagram com atualização imediata sem recarregar.
* Ativar/desativar navegação por teclado.
* Resumo rápido de contatos, seguidos e protegidos.
* Botão de acesso direto ao **Dashboard**.

---

## 📦 Como Instalar e Testar no Google Chrome

### 1. Pré-requisitos
Certifique-se de ter o [Node.js](https://nodejs.org/) instalado.

### 2. Compilar a Extensão
No diretório do projeto, execute:
```bash
npm install
npm run build
```
O build criará a pasta `dist/` com todos os arquivos empacotados e prontos para o Chrome (HTMLs, JavaScript compilado, service worker, content script e ícones).

### 3. Carregar a Extensão no Chrome
1. Abra o Google Chrome e acesse: `chrome://extensions/`
2. No canto superior direito, ative o interruptor **"Modo do desenvolvedor"** (Developer mode).
3. No canto superior esquerdo, clique no botão **"Carregar sem compactação"** (Load unpacked).
4. Selecione a pasta `dist` que foi gerada dentro do diretório do projeto:
   ```
   C:\Users\artue\OneDrive\Documentos\GitHub\InstaHub\dist
   ```
5. A extensão **InstaHub - Instagram Followers Manager** aparecerá na sua lista de extensões ativas!
6. Fixe o ícone do InstaHub na barra de ferramentas do Chrome para acesso rápido.

---

## 🧪 Testando a Extensão

1. **Abrir o Popup:**
   * Clique no ícone do InstaHub na barra do Chrome para ver os switches e o resumo.
2. **Abrir o Dashboard:**
   * No popup, clique em **"Abrir Dashboard Completo"** (ou abra `chrome-extension://<id>/dashboard.html`).
   * No Dashboard, clique em **"Backup / JSON"** -> **"Importar Dados"**.
   * Carregue o arquivo de exemplo `examples/sample_followers.json` ou cole o conteúdo JSON.
   * Observe as abas de filtro, pesquisa e edição de usuários funcionando em tempo real.
3. **Testar no Instagram:**
   * Abra o [Instagram](https://www.instagram.com/) e acesse qualquer perfil com lista de seguidores aberta.
   * Veja os selos injetados ao lado dos nomes (`✓ Segue`, `↺ Já seguiu`, `– Nunca seguiu`, `🛡️ Protegido`).
   * Use as setas `↑` e `↓` do teclado para navegar entre os perfis e pressione `Enter` para interagir com o botão!

---

## 📄 Formato de Exportação/Importação JSON

```json
[
  {
    "username": "arthurhenrique",
    "name": "Arthur Henrique",
    "iFollow": true,
    "followsMe": false,
    "everFollowed": true,
    "protected": false
  }
]
```

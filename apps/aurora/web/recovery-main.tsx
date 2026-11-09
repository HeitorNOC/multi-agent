import React from "react";
import { createRoot } from "react-dom/client";
import RecoveryCenter from "./RecoveryCenter.tsx";
import "./aurora.css";
import "./recovery.css";
createRoot(document.getElementById("root")!).render(
  <div className="app">
    <header>
      <div className="brand">AURORA · CENTRAL HUMANA</div>
      <span>Desenvolvimento local</span>
    </header>
    <main>
      <h1>Recuperação operacional</h1>
      <p>
        Este perfil usa processos, PostgreSQL e o protocolo empresarial reais,
        com respostas de provedor controladas. Não chama modelos nem representa
        um novo teste de qualidade semântica.
      </p>
      <RecoveryCenter />
    </main>
  </div>,
);
